'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatMessage, type AppDictionary } from '../../../lib/appI18n';
import { isSessionLost } from '../../../lib/authSession';
import {
  COLLECTION_FILTERS,
  COLLECTION_VIEW_MODE_STORAGE_KEY,
  COLLECTION_VIEW_MODES,
  collectionIconImage,
  collectionsTabUrl,
  collectionsPath,
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
import { collectionHref } from '../../../lib/savedLinks';
import { useSignedInApp } from '../AppRoot';
import { CollectionGlyph, Glyph } from '../Glyph';
import { LoadMore } from '../InfiniteScroll';
import { Avatar } from '../Avatar';
import { LinkImage } from '../LinkImage';
import { LoadFailed } from '../PageStates';
import { CollectionSkeleton } from '../Skeletons';
import { useStoredChoice } from '../useStoredChoice';
import { ViewModeToggle } from '../ViewModeToggle';
import { PageHeader } from '../PageHeader';
import styles from '../app.module.css';

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
  // The tab is the address's (?tab=): Back from a Collection returns to the tab that was open; no / an unknown value = 즐겨찾기.
  const router = useRouter();
  const filter = parseCollectionTab(useSearchParams().get('tab'));
  const [viewMode, setViewMode] = useStoredChoice<CollectionViewMode>(COLLECTION_VIEW_MODE_STORAGE_KEY, parseCollectionViewMode);
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let ignore = false;
    api<CollectionsPage>({ path: collectionsPath(filter) }).then(
      page => {
        if (!ignore) {
          setState({ kind: 'loaded', ...firstPage(page.items, page.nextCursor) });
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
        setState({ kind: 'failed' });
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, filter, onSessionLost, reloadToken]);

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

  const loadMore = () => {
    if (state.kind !== 'loaded' || !canLoadMore(state)) {
      return;
    }
    const requestedFilter = filter;
    const cursor = state.nextCursor;
    setState({ kind: 'loaded', ...startLoadingMore(state) });
    api<CollectionsPage>({ path: collectionsPath(requestedFilter, cursor) }).then(
      page => setState(current => (current.kind === 'loaded' && requestedFilter === filter ? { kind: 'loaded', ...appendPage(current, page, item => item.id) } : current)),
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
    <section aria-busy={state.kind === 'loading'} className={styles.page}>
      <PageHeader icon="Folder" title={dictionary.navCollections} />

      {/* One toolbar: the mobile filters, then how they are shown and 새 컬렉션 (always in reach). It wraps on a narrow window. */}
      <div className={styles.toolbar}>
        <div aria-label={dictionary.collectionsFilterLabel} className={styles.filterTabs} role="group">
          {COLLECTION_FILTERS.map(option => (
            <button
              aria-pressed={filter === option}
              className={filter === option ? styles.filterTabSelected : styles.filterTab}
              key={option}
              onClick={() => selectFilter(option)}
              type="button"
            >
              {filterLabel(dictionary, option)}
            </button>
          ))}
        </div>
        <div className={styles.headerActions}>
          <ViewModeToggle
            groupLabel={dictionary.viewModeLabel}
            labels={{ list: dictionary.viewList, grid: dictionary.viewGrid, image: dictionary.viewImage }}
            modes={COLLECTION_VIEW_MODES}
            onChange={setViewMode}
            value={viewMode}
          />
          <Link className={styles.primaryAction} href="/collections/new">
            <Glyph name="Plus" size={16} />
            {dictionary.collectionCreate}
          </Link>
        </div>
      </div>

      {state.kind === 'loading' ? <CollectionSkeleton count={viewMode === 'grid' ? 10 : 6} mode={viewMode} /> : null}
      {state.kind === 'failed' ? <LoadFailed dictionary={dictionary} onRetry={retry} /> : null}
      {state.kind === 'loaded' && state.items.length === 0 ? <p className={styles.emptyState}>{emptyLabel(dictionary, filter)}</p> : null}
      {state.kind === 'loaded' && state.items.length > 0 ? (
        <>
          <ul className={viewMode === 'grid' ? styles.collectionGrid : styles.collectionList}>
            {state.items.map(collection => (
              <li className={styles.collectionCard} key={collection.id}>
                <CollectionCard collection={collection} dictionary={dictionary} layout={viewMode === 'grid' ? 'grid' : 'list'} />
              </li>
            ))}
          </ul>
          <LoadMore dictionary={dictionary} onLoadMore={loadMore} skeleton={<CollectionSkeleton count={viewMode === 'grid' ? 5 : 3} mode={viewMode} />} state={state} />
        </>
      ) : null}
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

export function CollectionCard({
  collection,
  dictionary,
  layout,
}: {
  readonly collection: CollectionSummary;
  readonly dictionary: AppDictionary;
  readonly layout: 'grid' | 'list';
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
          {collection.isFavorite ? (
            <span aria-label={dictionary.favorite} className={styles.coverStar} role="img" title={dictionary.favorite}>
              <Glyph name="StarFilled" size={18} />
            </span>
          ) : null}
        </div>
        <div className={styles.collectionText}>
          <span className={styles.collectionName} dir="auto">
            {collection.name}
          </span>
          <span className={styles.linkMeta}>{formatMessage(dictionary.itemCount, { count: collection.itemCount })}</span>
        </div>
        {/* A card with nothing to report has no status row at all: the body is as tall as its name and count. */}
        {hasGridStatus(collection) ? (
          <div className={styles.collectionGridStatus}>
            {attention > 0 ? (
              <span aria-hidden className={styles.attentionBadge}>
                {formatBadgeCount(attention)}
              </span>
            ) : null}
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
      <CollectionTileView collection={collection} size={72} />
      <div className={styles.collectionText}>
        <span className={styles.collectionName} dir="auto">
          {collection.name}
        </span>
        <span className={styles.linkMeta}>{formatMessage(dictionary.itemCount, { count: collection.itemCount })}</span>
      </div>
      <div className={styles.cardStatus}>
        {attention > 0 ? (
          <span aria-hidden className={styles.attentionBadge}>
            {formatBadgeCount(attention)}
          </span>
        ) : null}
        <CollectionBadges collection={collection} dictionary={dictionary} />
        <ParticipantPreview collection={collection} />
      </div>
    </Link>
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
  const preview = collection.participantPreview ?? [];
  const others = collection.otherParticipantCount ?? preview.length;
  if (others === 0 || preview.length === 0) {
    return null;
  }
  const more = others - preview.length;
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
