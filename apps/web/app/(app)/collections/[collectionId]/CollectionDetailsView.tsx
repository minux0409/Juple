'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatMessage, type AppDictionary } from '../../../../lib/appI18n';
import type { AppApi } from '../../../../lib/appApi';
import { isSessionLost } from '../../../../lib/authSession';
import {
  COLLECTION_SORT_STORAGE_KEY,
  collectionPath,
  collectionSectionPagePath,
  collectionSectionsPath,
  collectionWholePagePath,
  contentGateOf,
  exceedsNameOrderLimit,
  isNameSort,
  isNotFound,
  NAME_ORDER_MAX_LINKS,
  nextDateSort,
  nextNameSort,
  parseLinkSort,
  sortCollectionItemsByName,
  type CollectionDetail,
} from '../../../../lib/collectionDetails';
import { canEditCollection } from '../../../../lib/collectionEditor';
import { canShareCollection, isCollaborative, isSharedWithMe, type CollectionParticipants } from '../../../../lib/collectionSharing';
import { forgetUnlock, unlockHeaders, unlockTokenFor } from '../../../../lib/collectionUnlock';
import { isCollectionLocked, isCollectionShared } from '../../../../lib/collectionsView';
import { setUnreadCount } from '../../../../lib/notificationState';
import { collectionNewLinksReadPath, type NotificationReadResult } from '../../../../lib/notifications';
import { CollectionTileView } from '../CollectionsView';
import { Modal } from '../../Modal';
import { ParticipantsPanel, ParticipantStack, SharePanel } from './CollectionSharing';
import { UnlockPanel } from './UnlockPanel';
import {
  appendUnique,
  collectionHref,
  collectionLinkView,
  inCollectionContext,
  formatLinkTimestamp,
  parseRouteId,
  parseViewMode,
  VIEW_MODE_STORAGE_KEYS,
  type CollectionItemEntry,
  type CollectionItemsPage,
  type DateSection,
  type LinkViewMode,
} from '../../../../lib/savedLinks';
import { useSignedInApp } from '../../AppRoot';
import { DateSections } from '../../DateSections';
import { Glyph } from '../../Glyph';
import { BackButton, LoadFailed, Notice } from '../../PageStates';
import { CollectionHeaderSkeleton, SavedLinkSkeleton } from '../../Skeletons';
import { SavedLinkList } from '../../SavedLinkList';
import { SortChips } from '../../SortChips';
import { useItemsChanged } from '../../useItemsChanged';
import { useStoredChoice } from '../../useStoredChoice';
import { ViewModeToggle } from '../../ViewModeToggle';
import { BackRow } from '../../PageHeader';
import styles from '../../app.module.css';

type HeaderState = { readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'notFound' } | { readonly kind: 'loaded'; readonly collection: CollectionDetail };

/**
 * A Collection's page - the mobile CollectionDetailsScreen read side: its tile, name, lock / shared / favorite state and link count,
 * then its links by 시간순 (date sections, ↓ newest / ↑ oldest) or 이름순 (↑ / ↓ over the whole Collection), in List / Grid / Image.
 * A locked Collection shows that it is locked and nothing of its links (the Web does not unlock in this round). Every write
 * (favorite, edit, share, remove, copy, approvals) stays in the app for now.
 */
export function CollectionDetailsView({ collectionIdParam }: { readonly collectionIdParam: string }) {
  const { api, dictionary, locale, onSessionLost } = useSignedInApp();
  const collectionId = parseRouteId(collectionIdParam);
  const [header, setHeader] = useState<HeaderState>(collectionId === null ? { kind: 'notFound' } : { kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [storedSort, setStoredSort] = useStoredChoice(COLLECTION_SORT_STORAGE_KEY, parseLinkSort);
  const [viewMode, setViewMode] = useStoredChoice(VIEW_MODE_STORAGE_KEYS.collectionDetails, parseViewMode);
  const [gate, setGate] = useState<'lock' | 'sharePassword' | null>(null);
  // Bumped after an unlock: the links are read again (with the grant), showing skeletons meanwhile.
  const [contentToken, setContentToken] = useState(0);
  // A link was deleted / removed / edited in the Quick Detail sheet over this page: the header count and the links are read again.
  useItemsChanged(() => {
    setReloadToken(token => token + 1);
    setContentToken(token => token + 1);
  });
  const [tooLargeForName, setTooLargeForName] = useState(false);
  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  // Who is in it (collaborative Collections only) and a member's pass-on link - loaded with the Collection, as on mobile.
  const [participants, setParticipants] = useState<CollectionParticipants | null>(null);
  const [participantsFailed, setParticipantsFailed] = useState(false);
  const [participantsToken, setParticipantsToken] = useState(0);
  const [memberShareUrl, setMemberShareUrl] = useState<string | null>(null);
  const [panel, setPanel] = useState<'share' | 'participants' | null>(null);

  // The content is really open (its links were read, past the lock / share-password gate): that is reading its 새 링크 notifications,
  // as on mobile - once per visit (and again after an unlock), best effort; the bell takes the server's new total. Its 승인 대기 count is
  // a task, not a notification: untouched.
  const openedRef = useRef<string | null>(null);
  const markContentOpened = useCallback(() => {
    if (collectionId === null) {
      return;
    }
    const visit = `${collectionId}:${contentToken}`;
    if (openedRef.current === visit) {
      return;
    }
    openedRef.current = visit;
    api<NotificationReadResult>({ method: 'POST', path: collectionNewLinksReadPath(collectionId) }).then(
      result => setUnreadCount(result.unreadCount),
      () => undefined,
    );
  }, [api, collectionId, contentToken]);

  useEffect(() => {
    if (collectionId === null) {
      return undefined;
    }
    let ignore = false;
    api<CollectionDetail>({ path: collectionPath(collectionId) }).then(
      collection => {
        if (ignore) {
          return;
        }
        setHeader({ kind: 'loaded', collection });
        if (isCollaborative(collection)) {
          api<CollectionParticipants>({ path: `${collectionPath(collection.id)}/participants` }).then(
            loaded => {
              if (!ignore) {
                setParticipants(loaded);
                setParticipantsFailed(false);
              }
            },
            () => {
              if (!ignore) {
                setParticipantsFailed(true);
              }
            },
          );
        }
        if (isSharedWithMe(collection)) {
          api<{ readonly isShared: boolean; readonly shareUrl: string | null }>({ path: `${collectionPath(collection.id)}/share/link` }).then(
            result => {
              if (!ignore) {
                setMemberShareUrl(result.isShared && result.shareUrl ? result.shareUrl : null);
              }
            },
            () => {
              if (!ignore) {
                setMemberShareUrl(null);
              }
            },
          );
        }
      },
      error => {
        if (ignore) {
          return;
        }
        if (isSessionLost(error)) {
          onSessionLost();
          return;
        }
        setHeader(isNotFound(error) ? { kind: 'notFound' } : { kind: 'failed' });
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, collectionId, onSessionLost, reloadToken, participantsToken]);

  const back = (
    <BackRow>
      <BackButton dictionary={dictionary} fallbackHref="/collections" />
    </BackRow>
  );

  if (collectionId === null || header.kind === 'notFound') {
    return (
      <section className={styles.page}>
        {back}
        <Notice message={dictionary.collectionNotFound} />
      </section>
    );
  }
  if (header.kind === 'loading') {
    return (
      <section aria-busy className={styles.page}>
        {back}
        <CollectionHeaderSkeleton />
        <SavedLinkSkeleton count={4} mode="list" />
      </section>
    );
  }
  if (header.kind === 'failed') {
    return (
      <section className={styles.page}>
        {back}
        <LoadFailed
          dictionary={dictionary}
          onRetry={() => {
            setHeader({ kind: 'loading' });
            setReloadToken(token => token + 1);
          }}
        />
      </section>
    );
  }

  const { collection } = header;
  // The caller's own favorite mark, optimistic (mobile toggleFavoriteAction): shown at once, the server's answer kept, the previous
  // state restored if it fails.
  const toggleFavorite = () => {
    if (isTogglingFavorite) {
      return;
    }
    const previous = collection;
    setIsTogglingFavorite(true);
    setFavoriteError(null);
    setHeader({ kind: 'loaded', collection: { ...previous, isFavorite: !previous.isFavorite } });
    api<CollectionDetail>({ method: 'PUT', path: `${collectionPath(previous.id)}/favorite`, body: { isFavorite: !previous.isFavorite } }).then(
      updated => {
        setHeader({ kind: 'loaded', collection: { ...previous, ...updated } });
        setIsTogglingFavorite(false);
      },
      error => {
        setHeader({ kind: 'loaded', collection: previous });
        setIsTogglingFavorite(false);
        if (isSessionLost(error)) {
          onSessionLost();
          return;
        }
        setFavoriteError(dictionary.errorFavorite);
      },
    );
  };
  // 이름순 needs the whole Collection: a larger one - known from its count, or found while loading - stays on 시간순.
  const nameUnavailable = tooLargeForName || collection.itemCount > NAME_ORDER_MAX_LINKS;
  const sort = isNameSort(storedSort) && nameUnavailable ? 'newest' : storedSort;
  const blockedBy = (error: unknown) => {
    const kind = contentGateOf(error);
    if (kind) {
      // Locked with no (longer) valid grant: a stale one is dropped and nothing of the content stays on screen (mobile).
      forgetUnlock(collection.id);
      setGate(kind);
      return true;
    }
    return false;
  };
  const afterUnlock = () => {
    setGate(null);
    setContentToken(token => token + 1);
  };

  return (
    <section className={styles.page}>
      {back}
      <CollectionHeader
        collection={collection}
        dictionary={dictionary}
        isTogglingFavorite={isTogglingFavorite}
        memberShareUrl={memberShareUrl}
        onOpenParticipants={() => setPanel('participants')}
        onOpenShare={() => setPanel('share')}
        onToggleFavorite={toggleFavorite}
        participants={participants}
        participantsFailed={participantsFailed}
      />
      <Modal closeLabel={dictionary.close} onClose={() => setPanel(null)} open={panel === 'share'} title={dictionary.shareLinkTitle} wide>
        <SharePanel
          collection={collection}
          onMemberLinkGone={() => setMemberShareUrl(null)}
          onParticipantsChanged={() => setParticipantsToken(token => token + 1)}
          participants={participants}
          participantsFailed={participantsFailed}
        />
      </Modal>
      <Modal closeLabel={dictionary.close} onClose={() => setPanel(null)} open={panel === 'participants'} title={dictionary.participantsTitle}>
        <ParticipantsPanel data={participants} dictionary={dictionary} failed={participantsFailed} />
      </Modal>
      {favoriteError ? <p className={styles.fieldError} role="alert">{favoriteError}</p> : null}
      {gate ? (
        <UnlockPanel
          collectionId={collection.id}
          isOwner={!isSharedWithMe(collection)}
          kind={gate}
          onStateChanged={() => {
            // The password is gone meanwhile (lock removed / access password off): read the Collection and its links again.
            setGate(null);
            setHeader({ kind: 'loading' });
            setReloadToken(token => token + 1);
            setContentToken(token => token + 1);
          }}
          onUnlocked={afterUnlock}
        />
      ) : (
        <>
          <div className={styles.toolbar}>
            <SortChips
              dictionary={dictionary}
              nameDisabled={nameUnavailable}
              onPressName={() => setStoredSort(nextNameSort(sort))}
              onPressTime={() => setStoredSort(nextDateSort(sort))}
              sort={sort}
            />
            <ViewModeToggle
              groupLabel={dictionary.viewModeLabel}
              labels={{ list: dictionary.viewList, grid: dictionary.viewGrid, image: dictionary.viewImage }}
              onChange={setViewMode}
              value={viewMode}
            />
          </div>
          {tooLargeForName ? <p className={styles.pageSubtitle}>{formatMessage(dictionary.sortNameTooLarge, { max: NAME_ORDER_MAX_LINKS })}</p> : null}
          {isNameSort(sort) ? (
            <CollectionByName
              api={api}
              collectionId={collection.id}
              dictionary={dictionary}
              direction={sort === 'titleDesc' ? 'desc' : 'asc'}
              key={`name-${contentToken}`}
              locale={locale}
              onBlocked={blockedBy}
              onOpened={markContentOpened}
              onSessionLost={onSessionLost}
              onTooLarge={() => setTooLargeForName(true)}
              viewMode={viewMode}
            />
          ) : (
            <DateSections
              dictionary={dictionary}
              emptyText={dictionary.collectionItemsEmpty}
              key={`${sort}-${contentToken}`}
              loadPage={(section, cursor) =>
                api<CollectionItemsPage>({ path: collectionSectionPagePath(collection.id, section, sort === 'oldest' ? 'oldest' : 'newest', cursor), headers: unlockHeaders(collection.id) }).then(page => ({
                  links: page.items.map(entry => inCollectionContext(collectionLinkView(entry, collection.id), collection.id)),
                  nextCursor: page.nextCursor,
                }))
              }
              loadSections={() =>
                api<{ readonly sections: readonly DateSection[] }>({ path: collectionSectionsPath(collection.id), headers: unlockHeaders(collection.id) }).then(result => {
                  markContentOpened();
                  return result.sections;
                })
              }
              locale={locale}
              onBlocked={blockedBy}
              onSessionLost={onSessionLost}
              reversed={sort === 'oldest'}
              viewMode={viewMode}
            />
          )}
        </>
      )}
    </section>
  );
}

/**
 * The compact header (mobile CollectionDetails): tile, name, then 총 N개 with the lock / shared state and - for a Collection other
 * people are in - the participant circles (they open the participant list); on the end the actions the person really has: the own
 * favorite mark (everyone), 공유 (the Owner; a member only while the Owner's link is public) and 편집 (the Owner, unlocked).
 */
function CollectionHeader({
  collection,
  dictionary,
  isTogglingFavorite,
  onToggleFavorite,
  participants,
  participantsFailed,
  memberShareUrl,
  onOpenShare,
  onOpenParticipants,
}: {
  readonly collection: CollectionDetail;
  readonly dictionary: AppDictionary;
  readonly isTogglingFavorite: boolean;
  readonly onToggleFavorite: () => void;
  readonly participants: CollectionParticipants | null;
  readonly participantsFailed: boolean;
  readonly memberShareUrl: string | null;
  readonly onOpenShare: () => void;
  readonly onOpenParticipants: () => void;
}) {
  // Mobile: the circles exist whenever someone else is in it (the Collection says how many); the full list replaces the
  // placeholders, and if it cannot be loaded the Collection's own preview of people stands in.
  const others = collection.otherParticipantCount ?? collection.participantPreview?.length ?? 0;
  const stackPeople = participants ? participants.participants : participantsFailed ? (collection.participantPreview ?? []) : null;
  return (
    <div className={styles.detailHeader}>
      <CollectionTileView collection={collection} size={80} />
      <div className={styles.detailHeading}>
        <h1 className={styles.detailTitle} dir="auto">
          {collection.name}
        </h1>
        <div className={styles.detailMeta}>
          <span>{formatMessage(dictionary.collectionTotal, { count: collection.itemCount })}</span>
          {isCollectionLocked(collection) ? (
            <span aria-label={dictionary.lockedCollection} className={styles.badge} role="img" title={dictionary.lockedCollection}>
              <Glyph name="Lock" size={13} />
            </span>
          ) : null}
          {isCollectionShared(collection) ? (
            <span aria-label={dictionary.sharedCollection} className={styles.badgeShared} role="img" title={dictionary.sharedCollection}>
              <Glyph name="People" size={13} />
            </span>
          ) : null}
          {others > 0 ? <ParticipantStack dictionary={dictionary} onOpen={onOpenParticipants} participants={stackPeople} placeholderCount={Math.min(others + 1, 4)} /> : null}
        </div>
      </div>
      <div className={styles.detailActions}>
        <button
          aria-label={collection.isFavorite ? dictionary.removeFavorite : dictionary.addFavorite}
          aria-pressed={collection.isFavorite}
          className={collection.isFavorite ? styles.iconButtonActive : styles.iconButton}
          disabled={isTogglingFavorite}
          onClick={onToggleFavorite}
          title={collection.isFavorite ? dictionary.removeFavorite : dictionary.addFavorite}
          type="button"
        >
          <Glyph name={collection.isFavorite ? 'StarFilled' : 'Star'} size={20} />
        </button>
        {canShareCollection(collection, memberShareUrl) ? (
          <button
            aria-label={isSharedWithMe(collection) ? dictionary.shareMemberLinkA11y : dictionary.shareAction}
            className={styles.settingsAction}
            onClick={onOpenShare}
            type="button"
          >
            <Glyph name="ExternalLink" size={16} />
            {dictionary.shareAction}
          </button>
        ) : null}
        {canEditCollection(collection) && (!isCollectionLocked(collection) || unlockTokenFor(collection.id) !== null) ? (
          <Link className={styles.settingsAction} href={`${collectionHref(collection.id)}/edit`}>
            <Glyph name="Edit" size={16} />
            {dictionary.collectionEdit}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

type WholeState = { readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'loaded'; readonly items: readonly CollectionItemEntry[] };

/** 이름순: every link of the Collection (at most NAME_ORDER_MAX_LINKS, newest-first pages of 100), then the mobile name order here. */
function CollectionByName({
  api,
  collectionId,
  dictionary,
  locale,
  direction,
  viewMode,
  onBlocked,
  onOpened,
  onTooLarge,
  onSessionLost,
}: {
  readonly api: AppApi;
  readonly collectionId: number;
  readonly dictionary: AppDictionary;
  readonly locale: string;
  readonly direction: 'asc' | 'desc';
  readonly viewMode: LinkViewMode;
  readonly onBlocked: (error: unknown) => boolean;
  /** The links were read (the content is open). */
  readonly onOpened: () => void;
  readonly onTooLarge: () => void;
  readonly onSessionLost: () => void;
}) {
  const [state, setState] = useState<WholeState>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let ignore = false;
    const loadWhole = async (): Promise<readonly CollectionItemEntry[] | null> => {
      let collected: readonly CollectionItemEntry[] = [];
      let cursor: string | null = null;
      do {
        const page: CollectionItemsPage = await api<CollectionItemsPage>({ path: collectionWholePagePath(collectionId, cursor), headers: unlockHeaders(collectionId) });
        if (ignore) {
          return [];
        }
        collected = appendUnique(collected, page.items, entry => entry.itemId);
        cursor = page.nextCursor;
        if (exceedsNameOrderLimit(collected.length, cursor !== null)) {
          return null;
        }
      } while (cursor);
      return collected;
    };
    loadWhole().then(
      items => {
        if (ignore) {
          return;
        }
        if (items === null) {
          onTooLarge();
          return;
        }
        onOpened();
        setState({ kind: 'loaded', items });
      },
      error => {
        if (ignore) {
          return;
        }
        if (isSessionLost(error)) {
          onSessionLost();
          return;
        }
        if (!onBlocked(error)) {
          setState({ kind: 'failed' });
        }
      },
    );
    return () => {
      ignore = true;
    };
    // Loaded once per mount (and per 다시 시도); flipping ↑ / ↓ only re-sorts what is loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, collectionId, reloadToken]);

  if (state.kind === 'loading') {
    return <SavedLinkSkeleton count={6} mode={viewMode} />;
  }
  if (state.kind === 'failed') {
    return (
      <LoadFailed
        dictionary={dictionary}
        onRetry={() => {
          setState({ kind: 'loading' });
          setReloadToken(token => token + 1);
        }}
      />
    );
  }
  if (state.items.length === 0) {
    return <p className={styles.emptyState}>{dictionary.collectionItemsEmpty}</p>;
  }
  const links = sortCollectionItemsByName(state.items, locale, direction).map(entry => inCollectionContext(collectionLinkView(entry, collectionId), collectionId));
  return <SavedLinkList dictionary={dictionary} links={links} mode={viewMode} timestampOf={link => formatLinkTimestamp(link.timestampUtc, locale, true)} />;
}
