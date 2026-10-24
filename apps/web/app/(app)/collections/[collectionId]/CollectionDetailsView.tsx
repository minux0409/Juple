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
  collectionNamePagePath,
  contentGateOf,
  isNameSort,
  isNotFound,
  nextDateSort,
  nextNameSort,
  parseLinkSort,
  type CollectionDetail,
} from '../../../../lib/collectionDetails';
import { canEditCollection } from '../../../../lib/collectionEditor';
import { collectionNotificationPreferencePath, type CollectionNotificationPreference } from '../../../../lib/collectionNotifications';
import { canShareCollection, isCollaborative, isSharedWithMe, participantsWithSelf, type CollectionParticipants } from '../../../../lib/collectionSharing';
import { forgetUnlock, unlockHeaders, unlockTokenFor } from '../../../../lib/collectionUnlock';
import { isCollectionLocked, isCollectionShared } from '../../../../lib/collectionsView';
import { setUnreadCount } from '../../../../lib/notificationState';
import { collectionNewLinksReadPath, type NotificationReadResult } from '../../../../lib/notifications';
import { CollectionTileView } from '../CollectionsView';
import { Modal } from '../../Modal';
import { ParticipantsPanel, ParticipantStack, SharePanel } from './CollectionSharing';
import { CloneResultBanner } from './CloneResultBanner';
import { MergeCollection } from './MergeCollection';
import { MergeUndoBanner } from './MergeUndoBanner';
import { canMergeCollection, peekCloneResult, peekMergeUndo } from '../../../../lib/collectionOperations';
import { useRouter, useSearchParams } from 'next/navigation';
import { ActionMenu, type MenuAction } from '../../Popover';
import { UnlockPanel } from './UnlockPanel';
import { CollectionManagementDialogs, type CollectionManagementMode } from './CollectionManagementDialogs';
import {
  collectionHref,
  collectionLinkView,
  inCollectionContext,
  shouldShowLinkAdders,
  parseRouteId,
  parseViewMode,
  VIEW_MODE_STORAGE_KEYS,
  type CollectionItemEntry,
  type CollectionItemsPage,
  type DateSection,
  type LinkViewMode,
} from '../../../../lib/savedLinks';
import { useSignedInApp } from '../../AppRoot';
import { useAttention } from '../../useAttention';
import { DateSections } from '../../DateSections';
import { Glyph } from '../../Glyph';
import { BackButton, LoadFailed, Notice } from '../../PageStates';
import { CollectionHeaderSkeleton, SavedLinkSkeleton } from '../../Skeletons';
import { SavedLinkList } from '../../SavedLinkList';
import { SortChips } from '../../SortChips';
import { useItemsChanged } from '../../useItemsChanged';
import { affectsList, removesFromList } from '../../../../lib/itemChanges';
import { useStoredChoice } from '../../useStoredChoice';
import { ViewModeToggle } from '../../ViewModeToggle';
import { BackRow } from '../../PageHeader';
import { REQUESTS_PARAM } from '../../../../lib/collectionApprovals';
import { ReceivedRequestsDialog } from '../ReceivedRequestsDialog';
import { RequestRow } from '../RequestRow';
import styles from '../../app.module.css';
import { LoadMore } from '../../InfiniteScroll';
import { appendPage, canLoadMore, failLoadingMore, firstPage, startLoadingMore, type PagedState } from '../../../../lib/paging';

type HeaderState = { readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'notFound' } | { readonly kind: 'loaded'; readonly collection: CollectionDetail };

/**
 * A Collection's page - the mobile CollectionDetailsScreen read side: its tile, name, lock / shared / favorite state and link count,
 * then its links by 시간순 (date sections, ↓ newest / ↑ oldest) or 이름순 (↑ / ↓ over the whole Collection), in List / Grid / Image.
 * A locked Collection shows only its own metadata until its password produces a short-lived server grant. Owner management uses the
 * same delete and lock endpoints as Mobile; member roles never receive those actions.
 */
export function CollectionDetailsView({ collectionIdParam }: { readonly collectionIdParam: string }) {
  const { api, dictionary, locale, onSessionLost } = useSignedInApp();
  const { store: attentionStore } = useAttention();
  const collectionId = parseRouteId(collectionIdParam);
  const [header, setHeader] = useState<HeaderState>(collectionId === null ? { kind: 'notFound' } : { kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [storedSort, setStoredSort] = useStoredChoice(COLLECTION_SORT_STORAGE_KEY, parseLinkSort);
  const [viewMode, setViewMode] = useStoredChoice(VIEW_MODE_STORAGE_KEYS.collectionDetails, parseViewMode);
  const [gate, setGate] = useState<'lock' | 'sharePassword' | null>(null);
  // Bumped after an unlock: the links are read again (with the grant), showing skeletons meanwhile.
  const [contentToken, setContentToken] = useState(0);
  // A link was deleted / removed / edited in the Quick Detail sheet over this page. A deletion or this Collection's membership removal
  // is taken out of the lists by the lists themselves (DateSections / CollectionByName); here the header count follows at once and is
  // then read again. An edit reads the header and the links again. A membership removed from ANOTHER Collection changes nothing here.
  useItemsChanged(change => {
    if (collectionId === null) {
      return;
    }
    const scope = { kind: 'collection', collectionId } as const;
    if (!affectsList(change, scope)) {
      return;
    }
    if (removesFromList(change, scope)) {
      setHeader(current =>
        current.kind === 'loaded' ? { kind: 'loaded', collection: { ...current.collection, itemCount: Math.max(0, current.collection.itemCount - 1) } } : current,
      );
      setReloadToken(token => token + 1);
      return;
    }
    setReloadToken(token => token + 1);
    setContentToken(token => token + 1);
  });
  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  // Who is in it (see the participants effect below) and a member's pass-on link - loaded with the Collection, as on mobile.
  const [participants, setParticipants] = useState<CollectionParticipants | null>(null);
  const [participantsFailed, setParticipantsFailed] = useState(false);
  const [participantsToken, setParticipantsToken] = useState(0);
  const [memberShareUrl, setMemberShareUrl] = useState<string | null>(null);
  // A Collections card's 공유 arrives as `?panel=share`: the share screen opens at once (only if this person may share - checked below),
  // and the address is cleaned so a reload or Back does not reopen it.
  const wantsSharePanel = useSearchParams().get('panel') === 'share';
  const [panel, setPanel] = useState<'share' | 'participants' | 'merge' | null>(wantsSharePanel ? 'share' : null);
  // 받은 승인 요청: the Owner's notification arrives as `?requests=1` (opens the answering dialog once the Collection and its gate are open).
  const wantsRequests = useSearchParams().get(REQUESTS_PARAM) === '1';
  const [requestsOpen, setRequestsOpen] = useState(wantsRequests);
  const [managementMode, setManagementMode] = useState<CollectionManagementMode>(null);
  // Arrived here from 다른 컬렉션과 병합: 되돌리기 is offered for a moment (in memory only; see MergeUndoBanner).
  const [mergeUndo, setMergeUndo] = useState(() => (collectionId === null ? null : peekMergeUndo(collectionId)));
  // Arrived here from 내 컬렉션으로 복제: how the copy went (in memory only; see CloneResultBanner).
  const [cloneResult, setCloneResult] = useState(() => (collectionId === null ? null : peekCloneResult(collectionId)));
  const router = useRouter();
  useEffect(() => {
    if ((wantsSharePanel || wantsRequests) && collectionId !== null) {
      router.replace(collectionHref(collectionId), { scroll: false });
    }
  }, [collectionId, router, wantsRequests, wantsSharePanel]);
  const [mergeFailure, setMergeFailure] = useState<string | null>(null);
  // 새 링크 알림 (mobile's header bell / long-press item): the caller's own On / Off for this Collection, offered wherever someone else
  // can add links - a Collection shared with me, or mine with members or a public link. Null until the server has answered (nothing is
  // offered on a guess). Only the latest change counts; a failed save puts the previous state back and says so.
  const [notificationState, setNotificationState] = useState<{ readonly collectionId: number; readonly enabled: boolean } | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const notificationRequest = useRef(0);
  const offersNotifications = header.kind === 'loaded' && isCollaborative(header.collection);
  // The answer belongs to the Collection it was read for: another Collection (or one that stopped being shared) shows nothing.
  const newLinkNotifications = offersNotifications && notificationState?.collectionId === collectionId ? notificationState.enabled : null;
  useEffect(() => {
    if (collectionId === null || !offersNotifications) {
      return undefined;
    }
    let current = true;
    api<CollectionNotificationPreference>({ method: 'GET', path: collectionNotificationPreferencePath(collectionId) }).then(
      preference => {
        if (current) {
          setNotificationState({ collectionId, enabled: preference.newItemNotificationsEnabled });
        }
      },
      caught => {
        if (current && isSessionLost(caught)) {
          onSessionLost();
        }
      },
    );
    return () => {
      current = false;
    };
  }, [api, collectionId, offersNotifications, onSessionLost]);
  const changeNotifications = (enabled: boolean) => {
    if (collectionId === null) {
      return;
    }
    const previous = notificationState;
    const requestId = ++notificationRequest.current;
    setNotificationState({ collectionId, enabled });
    setNotificationError(null);
    api<CollectionNotificationPreference>({ method: 'PUT', path: collectionNotificationPreferencePath(collectionId), body: { newItemNotificationsEnabled: enabled } }).then(
      undefined,
      caught => {
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        if (requestId === notificationRequest.current) {
          setNotificationState(previous);
          setNotificationError(dictionary.newLinkNotificationsError);
        }
      },
    );
  };
  const closeMergeUndo = useCallback(() => setMergeUndo(null), []);

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
      result => { setUnreadCount(result.unreadCount); attentionStore.newLinksRead(collectionId); },
      () => undefined,
    );
  }, [api, attentionStore, collectionId, contentToken]);

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

  // Who is in it: with a collaborative Collection's header (its avatar stack), and - for ANY Collection, mine alone included - whenever
  // the share screen is open, which needs them for its people list and for whether the caller may manage (invite, settings). Mobile's
  // share screen always reads them with the share state; reading them only for collaborative Collections left a solo Owner's share
  // screen waiting forever (no request, no answer, no failure).
  const loadedCollection = header.kind === 'loaded' ? header.collection : null;
  const loadedCollectionId = loadedCollection?.id ?? null;
  const wantsParticipants = loadedCollection !== null && (isCollaborative(loadedCollection) || panel === 'share');
  useEffect(() => {
    if (!wantsParticipants || loadedCollectionId === null) {
      return undefined;
    }
    let ignore = false;
    api<CollectionParticipants>({ path: `${collectionPath(loadedCollectionId)}/participants` }).then(
      loaded => {
        if (!ignore) {
          setParticipants(loaded);
          setParticipantsFailed(false);
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
        setParticipantsFailed(true);
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, loadedCollectionId, onSessionLost, participantsToken, reloadToken, wantsParticipants]);

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
        {/* Shaped like the links about to appear - in the chosen view, whichever sort is chosen. */}
        <SavedLinkSkeleton count={4} mode={viewMode} />
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
  const sort = storedSort;
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

  // Who added each link is shown only in a shared Collection (never repeated avatars of "me" in a personal one).
  const showAdders = shouldShowLinkAdders(collection, []);

  return (
    <section className={styles.page}>
      {back}
      <CollectionHeader
        collection={collection}
        dictionary={dictionary}
        isTogglingFavorite={isTogglingFavorite}
        memberShareUrl={memberShareUrl}
        onOpenParticipants={() => setPanel('participants')}
        menuActions={
          // A Collection shared with me, its content open: 내 컬렉션으로 복제. My own, nobody else in it, its content open: 다른 컬렉션과
          // 병합 (the server refuses anything else too). The two never appear together.
          [
            ...(isSharedWithMe(collection) && !gate
              ? [{ key: 'clone', label: dictionary.cloneToMine, icon: 'Copy' as const, onSelect: () => router.push(`${collectionHref(collection.id)}/clone`) }]
              : canMergeCollection(collection, !gate && (!isCollectionLocked(collection) || unlockTokenFor(collection.id) !== null))
                ? [{ key: 'merge', label: dictionary.mergeWithOther, icon: 'Merge' as const, onSelect: () => setPanel('merge') }]
                : []),
            ...(newLinkNotifications === null
              ? []
              : [
                  {
                    key: 'notifications',
                    label: newLinkNotifications ? dictionary.newLinkNotificationsTurnOff : dictionary.newLinkNotificationsTurnOn,
                    icon: newLinkNotifications ? ('BellOff' as const) : ('Bell' as const),
                    onSelect: () => changeNotifications(!newLinkNotifications),
                  },
                ]),
            ...(isSharedWithMe(collection)
              ? [
                  // Their own personal lock (their password; the Owner and the other members are not affected).
                  {
                    key: 'lock',
                    label: collection.isMemberLocked ? dictionary.lockRemoveAction : dictionary.lockSetTitle,
                    icon: 'Lock' as const,
                    onSelect: () => setManagementMode(collection.isMemberLocked ? 'remove' : 'lock'),
                  },
                  { key: 'leave', label: dictionary.collectionLeaveAction, icon: 'Logout' as const, destructive: true, onSelect: () => setManagementMode('leave') },
                ]
              : [
                  {
                    key: 'lock',
                    label: isCollectionLocked(collection) ? dictionary.lockRemoveAction : dictionary.lockSetTitle,
                    icon: 'Lock' as const,
                    onSelect: () => setManagementMode(isCollectionLocked(collection) ? 'remove' : 'lock'),
                  },
                  ...(!gate
                    ? [{ key: 'delete', label: dictionary.delete, icon: 'Trash' as const, destructive: true, onSelect: () => setManagementMode('delete') }]
                    : []),
                ]),
          ]
        }
        onOpenShare={() => setPanel('share')}
        onToggleFavorite={toggleFavorite}
        participants={participants}
        participantsFailed={participantsFailed}
      />
      {/* The Owner's received requests (links proposed for approval, people asking to join): one row, the red count at its end. */}
      {!isSharedWithMe(collection) && !gate && (collection.pendingSubmissionCount ?? 0) + (collection.pendingJoinRequestCount ?? 0) > 0 ? (
        <RequestRow
          accessibleLabel={formatMessage(dictionary.requestsPendingSubmissionsA11y, { count: (collection.pendingSubmissionCount ?? 0) + (collection.pendingJoinRequestCount ?? 0) })}
          count={(collection.pendingSubmissionCount ?? 0) + (collection.pendingJoinRequestCount ?? 0)}
          expanded={requestsOpen}
          label={dictionary.requestsPendingSubmissions}
          onClick={() => setRequestsOpen(true)}
          testId="collection-received-requests"
        />
      ) : null}
      {!isSharedWithMe(collection) && !gate ? (
        <ReceivedRequestsDialog
          collection={{ id: collection.id, name: collection.name }}
          onChanged={() => {
            setReloadToken(token => token + 1);
            setContentToken(token => token + 1);
          }}
          onClose={() => setRequestsOpen(false)}
          open={requestsOpen}
        />
      ) : null}
      <CollectionManagementDialogs
        collectionId={collection.id}
        forMember={isSharedWithMe(collection)}
        key={managementMode ?? 'closed'}
        mode={managementMode}
        onClose={() => setManagementMode(null)}
        onDeleted={() => {
          setManagementMode(null);
          router.push('/collections');
          router.refresh();
        }}
        onLockChanged={() => {
          setManagementMode(null);
          setGate(null);
          setHeader({ kind: 'loading' });
          setReloadToken(token => token + 1);
          setContentToken(token => token + 1);
        }}
        onOpenLockSettings={() => {
          setManagementMode(null);
          router.push('/me/collection-lock');
        }}
      />
      <Modal closeLabel={dictionary.close} onClose={() => setPanel(null)} open={panel === 'share' && canShareCollection(collection, memberShareUrl)} title={dictionary.shareLinkTitle} wide>
        <SharePanel
          collection={collection}
          onMemberLinkGone={() => setMemberShareUrl(null)}
          onParticipantsChanged={() => setParticipantsToken(token => token + 1)}
          onUnlocked={() => {
            // Unlocked from the share screen: the same grant opens the content behind it.
            setGate(null);
            setContentToken(token => token + 1);
          }}
          participants={participants}
          participantsFailed={participantsFailed}
        />
      </Modal>
      {cloneResult ? <CloneResultBanner onDone={() => setCloneResult(null)} outcome={cloneResult} /> : null}
      {panel === 'merge' ? <MergeCollection collection={collection} onClose={() => setPanel(null)} onFailed={setMergeFailure} /> : null}
      {mergeUndo ? (
        <MergeUndoBanner
          onDone={closeMergeUndo}
          onUndone={() => {
            setReloadToken(token => token + 1);
            setContentToken(token => token + 1);
          }}
          undo={mergeUndo}
        />
      ) : null}
      {mergeFailure ? <p className={styles.fieldError} data-merge-failed role="alert">{mergeFailure}</p> : null}
      <Modal closeLabel={dictionary.close} onClose={() => setPanel(null)} open={panel === 'participants'} title={dictionary.participantsTitle}>
        <ParticipantsPanel data={participants} dictionary={dictionary} failed={participantsFailed} />
      </Modal>
      {favoriteError ? <p className={styles.fieldError} role="alert">{favoriteError}</p> : null}
      {notificationError ? <p className={styles.fieldError} data-notification-failed role="alert">{notificationError}</p> : null}
      {gate ? (
        <UnlockPanel
          collectionId={collection.id}
          isOwner={!isSharedWithMe(collection) || (collection.isMemberLocked === true && gate === 'lock')}
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
              nameDisabled={false}
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
          {isNameSort(sort) ? (
            <CollectionByName
              api={api}
              showAdders={showAdders}
              collectionId={collection.id}
              dictionary={dictionary}
              direction={sort === 'titleDesc' ? 'desc' : 'asc'}
              key={`name-${sort}-${contentToken}`}
              onBlocked={blockedBy}
              onOpened={markContentOpened}
              onSessionLost={onSessionLost}
              viewMode={viewMode}
            />
          ) : (
            <DateSections
              dictionary={dictionary}
              emptyText={dictionary.collectionItemsEmpty}
              key={`${sort}-${contentToken}`}
              loadPage={(section, cursor) =>
                api<CollectionItemsPage>({ path: collectionSectionPagePath(collection.id, section, sort === 'oldest' ? 'oldest' : 'newest', cursor), headers: unlockHeaders(collection.id) }).then(page => ({
                  links: page.items.map(entry => inCollectionContext(collectionLinkView(entry, collection.id, { showAdder: showAdders }), collection.id)),
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
              scope={{ kind: 'collection', collectionId: collection.id }}
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
  menuActions,
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
  readonly menuActions: readonly MenuAction[];
  readonly onOpenParticipants: () => void;
}) {
  // Mobile: the circles exist whenever someone else is in it (the Collection says how many); the full list replaces the
  // placeholders, and if it cannot be loaded the Collection's own preview of people stands in.
  const others = collection.otherParticipantCount ?? collection.participantPreview?.length ?? 0;
  const { profile } = useSignedInApp();
  const stackPeople = participants ? participants.participants : participantsFailed ? participantsWithSelf(collection.participantPreview ?? [], collection.accessRole, profile) : null;
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
            <Glyph name="Share" size={16} />
            {dictionary.shareAction}
          </button>
        ) : null}
        {canEditCollection(collection) && (!isCollectionLocked(collection) || unlockTokenFor(collection.id) !== null) ? (
          <Link className={styles.settingsAction} href={`${collectionHref(collection.id)}/edit`}>
            <Glyph name="Edit" size={16} />
            {dictionary.collectionEdit}
          </Link>
        ) : null}
        <ActionMenu actions={menuActions} label={dictionary.manageAction} />
      </div>
    </div>
  );
}

type NameState = { readonly kind: 'loading' } | { readonly kind: 'failed' } | ({ readonly kind: 'loaded' } & PagedState<CollectionItemEntry>);

/** 이름순: one SQL/keyset page at a time; ties stay newest-added then highest Item id on the server. */
function CollectionByName({
  api,
  collectionId,
  dictionary,
  direction,
  showAdders,
  viewMode,
  onBlocked,
  onOpened,
  onSessionLost,
}: {
  readonly api: AppApi;
  readonly collectionId: number;
  readonly dictionary: AppDictionary;
  readonly direction: 'asc' | 'desc';
  /** A shared Collection: each link shows who added it (never in a personal one). */
  readonly showAdders: boolean;
  readonly viewMode: LinkViewMode;
  readonly onBlocked: (error: unknown) => boolean;
  /** The links were read (the content is open). */
  readonly onOpened: () => void;
  readonly onSessionLost: () => void;
}) {
  const [state, setState] = useState<NameState>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  // A deleted / removed link leaves the loaded list at once (no refetch - the whole Collection is already here).
  useItemsChanged(change => {
    if (removesFromList(change, { kind: 'collection', collectionId })) {
      setState(current => (current.kind === 'loaded' ? { ...current, items: current.items.filter(entry => entry.itemId !== change.itemId) } : current));
    }
  });

  useEffect(() => {
    let ignore = false;
    api<CollectionItemsPage>({ path: collectionNamePagePath(collectionId, direction, null), headers: unlockHeaders(collectionId) }).then(
      page => {
        if (ignore) {
          return;
        }
        onOpened();
        setState({ kind: 'loaded', ...firstPage(page.items, page.nextCursor) });
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
    // Parent callbacks intentionally do not remount a page; collection/sort/retry are the read identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, collectionId, direction, reloadToken]);

  const loadMore = () => {
    if (state.kind !== 'loaded' || !canLoadMore(state)) {
      return;
    }
    const cursor = state.nextCursor;
    setState({ ...state, ...startLoadingMore(state) });
    api<CollectionItemsPage>({ path: collectionNamePagePath(collectionId, direction, cursor), headers: unlockHeaders(collectionId) }).then(
      page => setState(current => current.kind === 'loaded'
        ? { kind: 'loaded', ...appendPage(current, page, entry => entry.itemId) }
        : current),
      error => {
        if (isSessionLost(error)) {
          onSessionLost();
          return;
        }
        if (!onBlocked(error)) {
          setState(current => current.kind === 'loaded' ? { kind: 'loaded', ...failLoadingMore(current) } : current);
        }
      },
    );
  };

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
  const links = state.items.map(entry => inCollectionContext(collectionLinkView(entry, collectionId, { showAdder: showAdders }), collectionId));
  return <>
    <SavedLinkList dictionary={dictionary} links={links} mode={viewMode} />
    <LoadMore dictionary={dictionary} onLoadMore={loadMore} skeleton={<SavedLinkSkeleton count={6} mode={viewMode} />} state={state} />
  </>;
}
