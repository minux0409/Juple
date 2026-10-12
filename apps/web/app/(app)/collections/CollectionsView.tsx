'use client';

import { useEffect, useState } from 'react';
import { formatMessage, type AppDictionary } from '../../../lib/appI18n';
import { isSessionLost } from '../../../lib/authSession';
import {
  COLLECTION_FILTERS,
  collectionIconImage,
  collectionsPath,
  collectionTile,
  isCollectionLocked,
  isCollectionShared,
  type CollectionFilter,
  type CollectionsPage,
  type CollectionSummary,
} from '../../../lib/collectionsView';
import { useSignedInApp } from '../AppRoot';
import { CollectionGlyph, Glyph } from '../Glyph';
import styles from '../app.module.css';

type ListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'loaded'; readonly items: readonly CollectionSummary[]; readonly nextCursor: string | null; readonly loadingMore: boolean; readonly moreFailed: boolean };

function filterLabel(dictionary: AppDictionary, filter: CollectionFilter): string {
  return { all: dictionary.filterAll, favorites: dictionary.filterFavorites, owned: dictionary.filterOwned, shared: dictionary.filterShared }[filter];
}

/** The mobile screen's empty sentences (FILTER_EMPTY_KEYS): 내 컬렉션 reuses 전체's. */
function emptyLabel(dictionary: AppDictionary, filter: CollectionFilter): string {
  return { all: dictionary.emptyAll, favorites: dictionary.emptyFavorites, owned: dictionary.emptyAll, shared: dictionary.emptyShared }[filter];
}

/**
 * 컬렉션 - read-only: the mobile filters (전체 / 즐겨찾기 / 내 컬렉션 / 공유 컬렉션 = the API's scopes) and a card per Collection with only
 * what the API returns (its icon tile, name, link count, favorite, locked / shared). Creating / editing / opening a Collection is not
 * part of this Web round.
 */
export function CollectionsView() {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const [filter, setFilter] = useState<CollectionFilter>('all');
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let ignore = false;
    api<CollectionsPage>({ path: collectionsPath(filter) }).then(
      page => {
        if (!ignore) {
          setState({ kind: 'loaded', items: page.items, nextCursor: page.nextCursor, loadingMore: false, moreFailed: false });
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
      setFilter(next);
    }
  };

  const retry = () => {
    setState({ kind: 'loading' });
    setReloadToken(token => token + 1);
  };

  const loadMore = () => {
    if (state.kind !== 'loaded' || !state.nextCursor || state.loadingMore) {
      return;
    }
    const requestedFilter = filter;
    setState({ ...state, loadingMore: true, moreFailed: false });
    api<CollectionsPage>({ path: collectionsPath(requestedFilter, state.nextCursor) }).then(
      page =>
        setState(current =>
          current.kind === 'loaded' && requestedFilter === filter
            ? { kind: 'loaded', items: [...current.items, ...page.items.filter(item => !current.items.some(existing => existing.id === item.id))], nextCursor: page.nextCursor, loadingMore: false, moreFailed: false }
            : current,
        ),
      error => {
        if (isSessionLost(error)) {
          onSessionLost();
          return;
        }
        setState(current => (current.kind === 'loaded' ? { ...current, loadingMore: false, moreFailed: true } : current));
      },
    );
  };

  return (
    <section aria-busy={state.kind === 'loading'} className={styles.page}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1 className={styles.pageTitle}>{dictionary.navCollections}</h1>
        </div>
      </div>

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

      {state.kind === 'loading' ? <div aria-hidden className={styles.spinner} /> : null}
      {state.kind === 'failed' ? (
        <div className={styles.inlineState} role="alert">
          <p className={styles.stateTitle}>{dictionary.loadFailedTitle}</p>
          <p className={styles.stateMessage}>{dictionary.loadFailedMessage}</p>
          <button className={styles.secondaryButton} onClick={retry} type="button">
            {dictionary.retry}
          </button>
        </div>
      ) : null}
      {state.kind === 'loaded' && state.items.length === 0 ? <p className={styles.emptyState}>{emptyLabel(dictionary, filter)}</p> : null}
      {state.kind === 'loaded' && state.items.length > 0 ? (
        <>
          <ul className={styles.collectionGrid}>
            {state.items.map(collection => (
              <li className={styles.collectionCard} key={collection.id}>
                <CollectionCard collection={collection} dictionary={dictionary} />
              </li>
            ))}
          </ul>
          {state.nextCursor || state.moreFailed ? (
            <div className={styles.loadMoreRow}>
              {state.moreFailed ? <span className={styles.stateMessage}>{dictionary.loadFailedTitle}</span> : null}
              <button className={styles.secondaryButton} disabled={state.loadingMore} onClick={loadMore} type="button">
                {state.moreFailed ? dictionary.retry : dictionary.loadMore}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function CollectionCard({ collection, dictionary }: { readonly collection: CollectionSummary; readonly dictionary: AppDictionary }) {
  const tile = collectionTile(collection.color, collection.id);
  const image = collectionIconImage(collection);
  const locked = isCollectionLocked(collection);
  const shared = isCollectionShared(collection);
  return (
    <div className={styles.collectionBody}>
      <div aria-hidden className={styles.collectionTile} style={{ background: tile.background, color: tile.icon }}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- the Collection's own icon photo (short-lived read URL)
          <img alt="" loading="lazy" referrerPolicy="no-referrer" src={image} />
        ) : (
          <CollectionGlyph icon={collection.icon} size={28} />
        )}
      </div>
      <div className={styles.collectionText}>
        <span className={styles.collectionName} dir="auto">
          {collection.name}
        </span>
        <span className={styles.linkMeta}>{formatMessage(dictionary.itemCount, { count: collection.itemCount })}</span>
      </div>
      <div className={styles.collectionBadges}>
        {locked ? (
          <span aria-label={dictionary.lockedCollection} className={styles.badge} role="img" title={dictionary.lockedCollection}>
            <Glyph name="Lock" size={13} />
          </span>
        ) : null}
        {shared ? (
          <span aria-label={dictionary.sharedCollection} className={styles.badgeShared} role="img" title={dictionary.sharedCollection}>
            <Glyph name="People" size={13} />
          </span>
        ) : null}
        {collection.isFavorite ? (
          <span aria-label={dictionary.favorite} className={styles.favoriteBadge} role="img" title={dictionary.favorite}>
            <Glyph name="StarFilled" size={18} />
          </span>
        ) : null}
      </div>
    </div>
  );
}
