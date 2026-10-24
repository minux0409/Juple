'use client';

import { useEffect, useState } from 'react';
import { isSessionLost } from '../../lib/authSession';
import { COLLECTION_VIEW_MODE_STORAGE_KEY, COLLECTION_VIEW_MODES, parseCollectionViewMode, type CollectionSummary } from '../../lib/collectionsView';
import { HOME_FAVORITES_SORT_STORAGE_KEY, loadAllFavorites, parseFavoritesSort, sortFavorites } from '../../lib/homeFavorites';
import { nextDateSort, nextNameSort } from '../../lib/collectionDetails';
import { useSignedInApp } from './AppRoot';
import { CollectionCard } from './collections/CollectionsView';
import { LoadFailed } from './PageStates';
import { SortChips } from './SortChips';
import { CollectionSkeleton } from './Skeletons';
import { useStoredChoice } from './useStoredChoice';
import { ViewModeToggle } from './ViewModeToggle';
import styles from './app.module.css';

type FavoritesState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'loaded'; readonly items: readonly CollectionSummary[] };

/**
 * Home's 즐겨찾기: every favorite Collection (all pages of the 즐겨찾기 scope), as the same cards the Collections page draws, in List or
 * Grid and in the chosen sort (both kept per browser). About six show at once; the rest are inside the box, which scrolls by itself
 * (mouse, touch and keyboard) so the page does not grow with the number of favorites. A locked or shared Collection keeps its marks
 * and its rules - a card only links to the Collection, whose own gate decides what opens.
 */
export function HomeFavorites() {
  const { api, dictionary, locale, onSessionLost } = useSignedInApp();
  const [state, setState] = useState<FavoritesState>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [viewMode, setViewMode] = useStoredChoice(COLLECTION_VIEW_MODE_STORAGE_KEY, parseCollectionViewMode);
  const [sort, setSort] = useStoredChoice(HOME_FAVORITES_SORT_STORAGE_KEY, parseFavoritesSort);

  useEffect(() => {
    let ignore = false;
    loadAllFavorites(api).then(
      items => {
        if (!ignore) {
          setState({ kind: 'loaded', items });
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
  }, [api, onSessionLost, reloadToken]);

  const retry = () => {
    setState({ kind: 'loading' });
    setReloadToken(token => token + 1);
  };

  const items = state.kind === 'loaded' ? sortFavorites(state.items, sort, locale) : [];
  const layout = viewMode === 'grid' ? 'grid' : 'list';

  return (
    <section aria-labelledby="home-favorites" className={styles.surfaceSection} data-home-favorites>
      <div className={styles.sectionBar}>
        <h2 className={styles.sectionTitle} id="home-favorites">
          {dictionary.filterFavorites}
        </h2>
        <ViewModeToggle
          groupLabel={dictionary.viewModeLabel}
          labels={{ list: dictionary.viewList, grid: dictionary.viewGrid, image: dictionary.viewImage }}
          modes={COLLECTION_VIEW_MODES}
          onChange={setViewMode}
          value={viewMode}
        />
      </div>
      {state.kind === 'loaded' && state.items.length > 1 ? (
        <SortChips
          dictionary={dictionary}
          onPressName={() => setSort(sort === 'title' || sort === 'titleDesc' ? nextNameSort(sort) : 'title')}
          onPressTime={() => setSort(sort === 'newest' || sort === 'oldest' ? nextDateSort(sort) : 'newest')}
          sort={sort}
        />
      ) : null}
      {state.kind === 'loading' ? <CollectionSkeleton count={layout === 'grid' ? 4 : 3} mode={layout} /> : null}
      {state.kind === 'failed' ? <LoadFailed dictionary={dictionary} onRetry={retry} /> : null}
      {state.kind === 'loaded' && items.length === 0 ? <p className={styles.emptyState}>{dictionary.emptyFavorites}</p> : null}
      {state.kind === 'loaded' && items.length > 0 ? (
        // A scrollable region reachable by keyboard (tabIndex) so the arrow / page keys scroll it; it is bounded in height by CSS.
        <div aria-label={dictionary.homeFavoritesRegion} className={layout === 'grid' ? styles.homeFavScrollGrid : styles.homeFavScroll} role="region" tabIndex={0}>
          <ul className={layout === 'grid' ? styles.homeFavGrid : styles.homeFavList}>
            {items.map(collection => (
              <li className={styles.collectionCard} key={collection.id}>
                <CollectionCard collection={collection} dictionary={dictionary} layout={layout} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
