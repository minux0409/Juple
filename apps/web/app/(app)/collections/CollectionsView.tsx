'use client';

import Link from 'next/link';
import { loadPendingJoins, filterPendingJoins, type PendingJoin } from '../../../lib/pendingJoins';
import { shareEntryTileKey } from '../../../lib/sharedCollectionEntry';
import { PendingJoinDialog } from './PendingJoinDialog';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { formatMessage, type AppDictionary } from '../../../lib/appI18n';
import { isSessionLost } from '../../../lib/authSession';
import {
  COLLECTION_FILTERS,
  COLLECTION_SEARCH_DEBOUNCE_MS,
  COLLECTION_SEARCH_PARAM,
  COLLECTION_VIEW_MODE_STORAGE_KEY,
  COLLECTION_VIEW_MODES,
  collectionIconImage,
  collectionsTabUrl,
  collectionsPath,
  collectionsSearchUrl,
  normalizeCollectionSearch,
  hasGridStatus,
  collectionTile,
  isCollectionLocked,
  isCollectionShared,
  parseCollectionTab,
  parseCollectionViewMode,
  type CollectionFilter,
  type CollectionsPage,
  type CollectionSummary,
  type CollectionViewMode,
} from '../../../lib/collectionsView';
import { formatBadgeCount } from '../../../lib/notifications';
import { appendPage, canLoadMore, failLoadingMore, firstPage, startLoadingMore, type PagedState } from '../../../lib/paging';
import { collectionHref, collectionShareHref } from '../../../lib/savedLinks';
import { canEditCollection } from '../../../lib/collectionEditor';
import { canShareCollection, participantsWithSelf } from '../../../lib/collectionSharing';
import { collectionPath } from '../../../lib/collectionDetails';
import { useSignedInApp } from '../AppRoot';
import { CollectionGlyph, Glyph } from '../Glyph';
import { LoadMore } from '../InfiniteScroll';
import { Avatar } from '../Avatar';
import { LinkImage } from '../LinkImage';
import { LoadFailed } from '../PageStates';
import { CollectionSearchBox } from './CollectionSearchBox';
import { ReceivedInvitations } from './ReceivedInvitations';
import { ReceivedRequestsEntry } from './ReceivedRequestsEntry';
import { SentRequestsEntry } from './SentRequestsEntry';
import { CollectionSkeleton } from '../Skeletons';
import { useToast } from '../Toaster';
import { useStoredChoice } from '../useStoredChoice';
import { TOUR_TARGETS, tourTarget } from '../../../lib/tour';
import { ViewModeToggle } from '../ViewModeToggle';
import { PageHeader } from '../PageHeader';
import styles from '../app.module.css';
import sectionStyles from './CollectionSections.module.css';
import { AttentionBadge } from '../AttentionBadge';
import { useAttention } from '../useAttention';

type ListState = { readonly kind: 'loading' } | { readonly kind: 'failed' } | ({ readonly kind: 'loaded' } & PagedState<CollectionSummary>);

function filterLabel(dictionary: AppDictionary, filter: CollectionFilter): string {
  return { all: dictionary.filterAll, favorites: dictionary.filterFavorites, owned: dictionary.filterOwned, shared: dictionary.filterShared }[filter];
}

/** The mobile screen's empty sentences (FILTER_EMPTY_KEYS): 내 컬렉션 reuses 전체's. */
function emptyLabel(dictionary: AppDictionary, filter: CollectionFilter): string {
  return { all: dictionary.emptyAll, favorites: dictionary.emptyFavorites, owned: dictionary.emptyAll, shared: dictionary.emptyShared }[filter];
}

/**
 * 컬렉션 - the mobile Collections screen: its four filters (즐겨찾기 first and by default; the API's scopes), List / Grid (Grid by
 * default, remembered per browser), "+ 새 컬렉션", and each Collection as only the API returns it (its icon tile, name, link count,
 * favorite, locked / shared). The list continues by itself as it scrolls.
 */
export function CollectionsView() {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const { store: attentionStore, snapshot: attention } = useAttention();
  useEffect(() => { void attentionStore.refresh(); }, [attentionStore]);
  // The tab is the address's (?tab=): Back from a Collection returns to the tab that was open; no / an unknown value = 즐겨찾기.
  const router = useRouter();
  const searchParams = useSearchParams();
  const filter = parseCollectionTab(searchParams.get('tab'));
  // The search text is the address's too (?q=), like the tab: Back from a Collection returns to the same search. `text` is what is typed;
  // `search` is what the list is read with - it follows the text after a pause (clearing is at once), so typing never asks per keystroke.
  const urlSearch = normalizeCollectionSearch(searchParams.get(COLLECTION_SEARCH_PARAM));
  const [text, setText] = useState(urlSearch);
  const [search, setSearch] = useState(urlSearch);
  // A request that is out for a changed search while the old list stays on screen (no full-page skeleton for a search).
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef(urlSearch);
  const [viewMode, setViewMode] = useStoredChoice<CollectionViewMode>(COLLECTION_VIEW_MODE_STORAGE_KEY, parseCollectionViewMode);
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [pendingJoins, setPendingJoins] = useState<readonly PendingJoin[]>([]);
  const [pendingFailed, setPendingFailed] = useState(false);
  const [openedJoin, setOpenedJoin] = useState<PendingJoin | null>(null);
  const toast = useToast();
  const [togglingId, setTogglingId] = useState<number | null>(null);

  useEffect(() => {
    let ignore = false;
    api<CollectionsPage>({ path: collectionsPath(filter, null, search) }).then(
      async page => {
        let joins: readonly PendingJoin[] | undefined;
        if (filter === 'shared') {
          try { joins = await loadPendingJoins(api); } catch (error) {
            if (ignore) return;
            if (isSessionLost(error)) { onSessionLost(); return; }
            setPendingFailed(true);
          }
        }
        if (!ignore && joins) { setPendingJoins(joins); setPendingFailed(false); }
        if (!ignore) {
          setState({ kind: 'loaded', ...firstPage(page.items, page.nextCursor) });
          setSearching(false);
        }
      },
      error => {
        if (ignore) {
          return;
        }
        setSearching(false);
        if (isSessionLost(error)) {
          onSessionLost();
          return;
        }
        setState({ kind: 'failed' });
      },
    );
    // A later search / tab makes this answer stale: it is dropped, so an old response can never replace a newer list.
    return () => {
      ignore = true;
    };
  }, [api, filter, onSessionLost, reloadToken, search]);

  // Re-read on returning to this tab and while visible: approvals become normal memberships,
  // and rejected/withdrawn/revoked requests disappear. Pending requests never enter attention counts.
  useEffect(() => {
    if (filter !== 'shared') return;
    const refresh = () => { if (document.visibilityState === 'visible') setReloadToken(token => token + 1); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 30000);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [filter]);
  const shownPending = filter === 'shared' ? filterPendingJoins(pendingJoins, search) : [];

  useEffect(
    () => () => {
      if (searchTimer.current !== null) {
        clearTimeout(searchTimer.current);
      }
    },
    [],
  );

  const applySearch = (term: string) => {
    const normalized = normalizeCollectionSearch(term);
    if (searchRef.current !== normalized) {
      searchRef.current = normalized;
      setSearching(true);
      setSearch(normalized);
    }
    const target = collectionsSearchUrl(new URL(window.location.href), normalized);
    router.replace(`${target.pathname}${target.search}`, { scroll: false });
  };

  const changeText = (next: string) => {
    setText(next);
    if (searchTimer.current !== null) {
      clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    if (normalizeCollectionSearch(next) === '') {
      // Clearing is immediate.
      applySearch('');
      return;
    }
    searchTimer.current = setTimeout(() => {
      searchTimer.current = null;
      applySearch(next);
    }, COLLECTION_SEARCH_DEBOUNCE_MS);
  };

  const selectFilter = (next: CollectionFilter) => {
    if (next !== filter) {
      setState({ kind: 'loading' });
      // replace, not push: switching tabs never fills the history - the one entry simply remembers the tab it is on. (The router, not
      // history.replaceState: only the router tells useSearchParams about the new address.)
      const target = collectionsTabUrl(new URL(window.location.href), next);
      router.replace(`${target.pathname}${target.search}`, { scroll: false });
    }
  };

  const retry = () => {
    setState({ kind: 'loading' });
    setReloadToken(token => token + 1);
  };

  // The caller's own favorite mark, optimistic (the Collection page's and mobile's toggle): shown at once, the server's answer kept, the
  // previous state restored when it fails. In 즐겨찾기 a Collection that is no longer a favorite leaves the list, as on mobile.
  const toggleFavorite = (collection: CollectionSummary) => {
    if (togglingId !== null) {
      return;
    }
    const apply = (replacement: CollectionSummary) =>
      setState(current =>
        current.kind !== 'loaded'
          ? current
          : {
              ...current,
              items: current.items.flatMap(item => (item.id !== replacement.id ? [item] : filter === 'favorites' && !replacement.isFavorite ? [] : [replacement])),
            },
      );
    setTogglingId(collection.id);
    apply({ ...collection, isFavorite: !collection.isFavorite });
    api<CollectionSummary>({ method: 'PUT', path: `${collectionPath(collection.id)}/favorite`, body: { isFavorite: !collection.isFavorite } }).then(
      updated => {
        setTogglingId(null);
        apply({ ...collection, ...updated });
        attentionStore.collectionChanged({ ...collection, ...updated });
      },
      error => {
        setTogglingId(null);
        // Roll back: a card the optimistic flip took out of 즐겨찾기 comes back at its place of old (the top is the safe side).
        setState(current => (current.kind === 'loaded' && !current.items.some(item => item.id === collection.id) ? { ...current, items: [collection, ...current.items] } : current));
        apply(collection);
        if (isSessionLost(error)) {
          onSessionLost();
          return;
        }
        toast.showNotice(dictionary.errorFavorite, 'error');
      },
    );
  };

  const loadMore = () => {
    if (state.kind !== 'loaded' || !canLoadMore(state)) {
      return;
    }
    const requestedFilter = filter;
    const requestedSearch = search;
    const cursor = state.nextCursor;
    setState({ kind: 'loaded', ...startLoadingMore(state) });
    api<CollectionsPage>({ path: collectionsPath(requestedFilter, cursor, requestedSearch) }).then(
      // A page of an earlier tab / search never lands in a newer list (its cursor belongs to that query).
      page => setState(current => (current.kind === 'loaded' && requestedFilter === filter && requestedSearch === search ? { kind: 'loaded', ...appendPage(current, page, item => item.id) } : current)),
      error => {
        if (isSessionLost(error)) {
          onSessionLost();
          return;
        }
        setState(current => (current.kind === 'loaded' ? { kind: 'loaded', ...failLoadingMore(current) } : current));
      },
    );
  };

  return (
    <section aria-busy={state.kind === 'loading' || searching} className={styles.page}>
      <PageHeader icon="Folder" title={dictionary.navCollections} />
      <div className={sectionStyles.sections} data-collection-sections>
      {/* One toolbar: the mobile filters, then how they are shown and 새 컬렉션 (always in reach). It wraps on a narrow window. */}
      <div className={styles.toolbar}>
        <div aria-label={dictionary.collectionsFilterLabel} className={styles.filterTabs} role="group">
          {COLLECTION_FILTERS.map(option => (
            <button
              aria-pressed={filter === option}
              data-collection-filter={option}
              className={filter === option ? styles.filterTabSelected : styles.filterTab}
              key={option}
              onClick={() => selectFilter(option)}
              type="button"
            >
              {filterLabel(dictionary, option)}
              <AttentionBadge count={attention.counts.types[option]} />
            </button>
          ))}
        </div>
        <div className={styles.headerActions}>
          <ViewModeToggle
            groupLabel={dictionary.viewModeLabel}
            labels={{ list: dictionary.viewList, grid: dictionary.viewGrid, image: dictionary.viewImage }}
            modes={COLLECTION_VIEW_MODES}
            onChange={setViewMode}
            tourId={TOUR_TARGETS.collectionsViewMode}
            value={viewMode}
          />
          <Link className={styles.primaryAction} href="/collections/new" {...tourTarget(TOUR_TARGETS.collectionsCreate)}>
            <Glyph name="Plus" size={16} />
            {dictionary.collectionCreate}
          </Link>
        </div>
      </div>

      {/* Requests are shared-Collection work: only 공유 컬렉션 carries them - 받은 승인 요청 (links / join requests I answer as Owner), then 받은 초대 요청. */}
      {filter === 'shared' ? <SentRequestsEntry /> : null}
      {filter === 'shared' ? <ReceivedRequestsEntry /> : null}
      {filter === 'shared' ? <ReceivedInvitations onAccepted={() => setReloadToken(token => token + 1)} /> : null}

      {/* Between the tabs and the cards (mobile: the same place, under the header and above the tabs' cards). */}
      <div className={styles.collectionSearch} data-collection-search>
        <CollectionSearchBox
          filter={filter}
          onTextChange={changeText}
          renderCollectionTile={(collection, size) => <CollectionTileView collection={collection} size={size} />}
          text={text}
        />
      </div>
      </div>
      <p aria-live="polite" className={styles.visuallyHidden} role="status">
        {searching ? dictionary.processing : ''}
      </p>

      {state.kind === 'loading' ? <CollectionSkeleton count={viewMode === 'grid' ? 10 : 6} mode={viewMode} /> : null}
      {state.kind === 'failed' ? <LoadFailed dictionary={dictionary} onRetry={retry} /> : null}
      {pendingFailed && filter === 'shared' ? <LoadFailed dictionary={dictionary} onRetry={retry} /> : null}
      {state.kind === 'loaded' && state.items.length === 0 && shownPending.length === 0 && !pendingFailed ? (
        search !== '' ? (
          <p className={styles.emptyState} data-collection-search-empty>
            {dictionary.searchEmpty}
          </p>
        ) : (
          <p className={styles.emptyState}>{emptyLabel(dictionary, filter)}</p>
        )
      ) : null}
      {state.kind === 'loaded' && (state.items.length > 0 || shownPending.length > 0) ? (
        <>
          <ul aria-busy={searching} className={searching ? `${viewMode === 'grid' ? styles.collectionGrid : styles.collectionList} ${styles.listSearching}` : viewMode === 'grid' ? styles.collectionGrid : styles.collectionList}>
            {shownPending.map(join => <li className={styles.collectionCard} key={`join-${join.requestId}`}>
              <button type="button" className={`${styles.pendingJoinCard} ${viewMode === 'grid' ? styles.pendingJoinGrid : ''}`}
                onClick={() => setOpenedJoin(join)} data-pending-join={join.requestId}>
                <span className={styles.pendingJoinTile}>
                  <CollectionTileView collection={{ id: shareEntryTileKey(join.publicId), icon: join.icon, color: join.color, iconImageUrl: join.iconImageUrl ?? null }} size={viewMode === 'grid' ? 72 : 48} />
                  <span className={styles.pendingJoinStatus}><Glyph name="Clock" size={20} /></span>
                </span>
                <span className={styles.pendingJoinText}><strong dir="auto">{join.name}</strong><span>{dictionary.joinPending}</span></span>
              </button>
            </li>)}
            {state.items.map(collection => (
              <li className={styles.collectionCard} key={collection.id}>
                <CollectionCard
                  collection={collection}
                  dictionary={dictionary}
                  favoriteBusy={togglingId === collection.id}
                  layout={viewMode === 'grid' ? 'grid' : 'list'}
                  onToggleFavorite={() => toggleFavorite(collection)}
                />
              </li>
            ))}
          </ul>
          <LoadMore dictionary={dictionary} onLoadMore={loadMore} skeleton={<CollectionSkeleton count={viewMode === 'grid' ? 5 : 3} mode={viewMode} />} state={state} />
        </>
      ) : null}
      {openedJoin ? <PendingJoinDialog publicId={openedJoin.publicId} requestId={openedJoin.requestId}
        onClose={() => setOpenedJoin(null)} onWithdrawn={() => {
          setPendingJoins(items => items.filter(item => item.requestId !== openedJoin.requestId));
          setOpenedJoin(null); setReloadToken(token => token + 1);
        }}><div className={styles.pendingJoinProfile}>
          <CollectionTileView collection={{ id: shareEntryTileKey(openedJoin.publicId), color: openedJoin.color, icon: openedJoin.icon, iconImageUrl: openedJoin.iconImageUrl ?? null }} size={72} />
          <strong dir="auto">{openedJoin.name}</strong>
        </div></PendingJoinDialog> : null}
    </section>
  );
}

export function CollectionTileView({
  collection,
  size,
  fill,
}: {
  readonly collection: Pick<CollectionSummary, 'id' | 'color' | 'icon' | 'iconImageUrl'>;
  readonly size: number;
  /** Fill the width of the parent (a cover); `size` then only sizes the glyph. */
  readonly fill?: boolean;
}) {
  const tile = collectionTile(collection.color, collection.id);
  const image = collectionIconImage(collection);
  return (
    <div aria-hidden className={styles.collectionTile} style={fill ? { background: tile.background, color: tile.icon } : { background: tile.background, color: tile.icon, width: size, height: size }}>
      <LinkImage fallback={<CollectionGlyph icon={collection.icon} size={Math.round(size * 0.52)} />} src={image} />
    </div>
  );
}

/**
 * A Collection card's quick actions - 즐겨찾기 (everyone), 공유 and 편집 (only what the person really has: the Owner, and a locked
 * Collection first needs its password on its own page). Siblings of the card's link, never inside it: a click on an action does not
 * open the Collection, and the card's own hit area stays whole. Share and edit are plain links to the Collection's own screens, so
 * no extra request is made for a card that is only looked at.
 */
function CollectionCardActions({
  collection,
  dictionary,
  layout,
  favoriteBusy,
  onToggleFavorite,
}: {
  readonly collection: CollectionSummary;
  readonly dictionary: AppDictionary;
  readonly layout: 'grid' | 'list';
  readonly favoriteBusy: boolean;
  readonly onToggleFavorite: () => void;
}) {
  const open = !isCollectionLocked(collection);
  const canShare = open && canShareCollection(collection, null);
  const canEdit = open && canEditCollection(collection);
  const favoriteLabel = collection.isFavorite ? dictionary.removeFavorite : dictionary.addFavorite;
  return (
    <div className={layout === 'grid' ? `${styles.collectionActions} ${styles.collectionActionsGrid}` : styles.collectionActions} data-collection-actions>
      <button
        aria-label={favoriteLabel}
        aria-pressed={collection.isFavorite}
        className={collection.isFavorite ? styles.cardActionActive : styles.cardAction}
        data-card-action="favorite"
        disabled={favoriteBusy}
        onClick={onToggleFavorite}
        title={favoriteLabel}
        type="button"
      >
        <Glyph name={collection.isFavorite ? 'StarFilled' : 'Star'} size={18} />
      </button>
      {canShare ? (
        <Link aria-label={dictionary.shareAction} className={styles.cardAction} data-card-action="share" href={collectionShareHref(collection.id)} title={dictionary.shareAction}>
          <Glyph name="Share" size={18} />
        </Link>
      ) : null}
      {canEdit ? (
        <Link aria-label={dictionary.collectionEdit} className={styles.cardAction} data-card-action="edit" href={`${collectionHref(collection.id)}/edit`} title={dictionary.collectionEdit}>
          <Glyph name="Edit" size={18} />
        </Link>
      ) : null}
    </div>
  );
}

export function CollectionCard({
  collection,
  dictionary,
  layout,
  favoriteBusy = false,
  onToggleFavorite,
}: {
  readonly collection: CollectionSummary;
  readonly dictionary: AppDictionary;
  readonly layout: 'grid' | 'list';
  readonly favoriteBusy?: boolean;
  /** Present: the card carries its quick actions (the Collections list). */
  readonly onToggleFavorite?: () => void;
}) {
  const actions = onToggleFavorite ? (
    <CollectionCardActions collection={collection} dictionary={dictionary} favoriteBusy={favoriteBusy} layout={layout} onToggleFavorite={onToggleFavorite} />
  ) : null;
  return (
    <>
      <CollectionCardBody collection={collection} dictionary={dictionary} hasActions={actions !== null} layout={layout} />
      {actions}
    </>
  );
}

function CollectionCardBody({
  collection,
  dictionary,
  layout,
  hasActions,
}: {
  readonly collection: CollectionSummary;
  readonly dictionary: AppDictionary;
  readonly layout: 'grid' | 'list';
  /** The quick actions carry the favorite mark, so the card does not draw a second star. */
  readonly hasActions: boolean;
}) {
  const attention = collection.attentionCount ?? 0;
  if (layout === 'grid') {
    // The picture / icon is the card; the favorite star sits on its corner, the other status under the name.
    return (
      <Link
        aria-label={attention > 0 ? formatMessage(dictionary.collectionAttentionA11y, { name: collection.name, count: attention }) : undefined}
        className={styles.collectionBodyGrid}
        href={collectionHref(collection.id)}
      >
        <div className={styles.collectionCover}>
          <CollectionTileView collection={collection} fill size={96} />
          {/* The attention number sits on the picture's bottom end corner (mobile: on the tile), clear of the status row's avatars. */}
          {attention > 0 ? (
            <span aria-hidden className={`${styles.attentionBadge} ${styles.attentionOnTile}`} data-attention-on-tile>
              {formatBadgeCount(attention)}
            </span>
          ) : null}
          {collection.isFavorite && !hasActions ? (
            <span aria-label={dictionary.favorite} className={styles.coverStar} role="img" title={dictionary.favorite}>
              <Glyph name="StarFilled" size={18} />
            </span>
          ) : null}
        </div>
        <div className={styles.collectionText}>
          <NameWithCount collection={collection} dictionary={dictionary} />
        </div>
        {/* A card with nothing to report has no status row at all: the body is as tall as its name and count. */}
        {hasGridStatus(collection) ? (
          <div className={styles.collectionGridStatus}>
            <CollectionBadges collection={collection} dictionary={dictionary} hideFavorite />
            <ParticipantPreview collection={collection} />
          </div>
        ) : null}
      </Link>
    );
  }
  return (
    // With attention, the card's spoken name carries the full count (the badge caps at 99+ and is not announced by itself).
    <Link
      aria-label={attention > 0 ? formatMessage(dictionary.collectionAttentionA11y, { name: collection.name, count: attention }) : undefined}
      className={styles.collectionBody}
      href={collectionHref(collection.id)}
    >
      <span className={styles.tileWithBadge}>
        <CollectionTileView collection={collection} size={72} />
        {attention > 0 ? (
          <span aria-hidden className={`${styles.attentionBadge} ${styles.attentionOnTile}`} data-attention-on-tile>
            {formatBadgeCount(attention)}
          </span>
        ) : null}
      </span>
      <div className={styles.collectionText}>
        <NameWithCount collection={collection} dictionary={dictionary} />
      </div>
      <div className={styles.cardStatus}>
        <CollectionBadges collection={collection} dictionary={dictionary} hideFavorite={hasActions} />
        <ParticipantPreview collection={collection} />
      </div>
    </Link>
  );
}

/** `카제나 · 2개`: the link count on the name's line (the name ellipsizes first; the count stays). */
function NameWithCount({ collection, dictionary }: { readonly collection: CollectionSummary; readonly dictionary: AppDictionary }) {
  return (
    <span className={styles.collectionNameLine}>
      <span className={styles.collectionNameText} dir="auto">
        {collection.name}
      </span>
      <span className={styles.collectionCountInline}>
        <span aria-hidden>· </span>
        {formatMessage(dictionary.itemCount, { count: collection.itemCount })}
      </span>
    </span>
  );
}

export function CollectionBadges({
  collection,
  dictionary,
  hideFavorite,
}: {
  readonly collection: CollectionSummary;
  readonly dictionary: AppDictionary;
  readonly hideFavorite?: boolean;
}) {
  return (
    <div className={styles.collectionBadges}>
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
      {collection.isFavorite && !hideFavorite ? (
        <span aria-label={dictionary.favorite} className={styles.favoriteBadge} role="img" title={dictionary.favorite}>
          <Glyph name="StarFilled" size={18} />
        </span>
      ) : null}
    </div>
  );
}

/** The people in a shared Collection, as the list row reports them (mobile participantPreview: up to two, then how many more). */
function ParticipantPreview({ collection }: { readonly collection: CollectionSummary }) {
  const { profile } = useSignedInApp();
  const others = collection.otherParticipantCount ?? collection.participantPreview?.length ?? 0;
  const known = collection.participantPreview ?? [];
  if (others === 0 || known.length === 0) {
    return null;
  }
  // The preview names the OTHER people; the signed-in person is one of the circles too (the Owner's, with the crown, first).
  const preview = participantsWithSelf(known, collection.accessRole ?? 'owner', profile);
  const more = others + 1 - preview.length;
  return (
    <span aria-hidden className={styles.miniStack}>
      {preview.map(person => (
        <Avatar key={person.jupleId} person={person} size={22} />
      ))}
      {more > 0 ? (
        <span className={`${styles.avatar} ${styles.avatarMore}`} style={{ width: 22, height: 22 }}>
          +{more}
        </span>
      ) : null}
    </span>
  );
}
