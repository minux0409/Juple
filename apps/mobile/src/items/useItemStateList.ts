import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getItemsByState, type ItemListEntry, type ItemListState } from './api/itemsApi';

const PAGE_LIMIT = 50;

function getItemListErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'forbidden') {
      return '이 목록을 볼 권한을 확인하지 못했습니다.';
    }
    if (error.kind === 'conflict') {
      return 'Juple 계정 준비 상태를 확인할 수 없습니다.';
    }
    if (error.kind === 'unauthorized') {
      return '인증 상태를 다시 확인할 수 없습니다.';
    }
  }

  return '목록을 불러올 수 없습니다.';
}

export interface UseItemStateListResult {
  readonly items: readonly ItemListEntry[];
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly isLoadingMore: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
  readonly loadMore: () => void;
  /** null means no Category filter (all Items in this state). */
  readonly filterCategoryId: number | null;
  readonly setFilterCategoryId: (categoryId: number | null) => void;
}

/**
 * Loads and paginates the Item list for a single lifecycle state (Wishlist or Archive).
 * Loading is driven entirely by focus: the first time the screen is focused (including its
 * initial mount) uses the full-screen loading state, and every later focus (e.g. returning from
 * another tab after an Item moved into this state) replaces the list with a fresh first page -
 * this is the only way an Item that just transitioned into this state appears without the user
 * having to pull-to-refresh. There is no separate mount effect, so exactly one GET fires per
 * focus, never two.
 */
export function useItemStateList(state: ItemListState): UseItemStateListResult {
  const authenticatedRequest = useAuthenticatedApi();
  const [items, setItems] = useState<readonly ItemListEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterCategoryId, setFilterCategoryIdState] = useState<number | null>(null);

  // Guards onEndReached firing multiple times before state updates are visible to new calls.
  const loadingMoreRef = useRef(false);
  // Discards a stale in-flight initial/refresh load's result if a newer one has since started
  // (including one superseded by a Category filter change).
  const loadRequestIdRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);
  // Mirrors filterCategoryId for synchronous reads inside load()/loadMore() without adding it
  // to their dependency arrays (same idiom as the other in-flight refs above).
  const filterCategoryIdRef = useRef<number | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const requestId = ++loadRequestIdRef.current;
      if (mode === 'refresh') {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const page = await getItemsByState(authenticatedRequest, state, {
          limit: PAGE_LIMIT,
          categoryId: filterCategoryIdRef.current,
        });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setItems(page.items);
        setNextCursor(page.nextCursor);
      } catch (caughtError) {
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        // The selected filter Category was deleted (or never belonged to this user) - recover
        // to the unfiltered list instead of surfacing an error.
        if (
          caughtError instanceof ApiError &&
          caughtError.kind === 'notFound' &&
          filterCategoryIdRef.current !== null
        ) {
          filterCategoryIdRef.current = null;
          setFilterCategoryIdState(null);
          await load(mode);
          return;
        }
        setError(getItemListErrorMessage(caughtError));
      } finally {
        if (loadRequestIdRef.current === requestId) {
          hasLoadedOnceRef.current = true;
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [authenticatedRequest, state],
  );

  useFocusEffect(
    useCallback(() => {
      load(hasLoadedOnceRef.current ? 'refresh' : 'initial');
    }, [load]),
  );

  const refresh = useCallback(() => {
    if (isRefreshing) {
      return;
    }
    load('refresh');
  }, [isRefreshing, load]);

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || isLoading || isRefreshing || !nextCursor) {
      return;
    }

    // Snapshots the current load "generation" so a Category filter change that resets the list
    // while this request is in flight can discard its result instead of appending it.
    const requestId = loadRequestIdRef.current;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    (async () => {
      try {
        const page = await getItemsByState(authenticatedRequest, state, {
          limit: PAGE_LIMIT,
          cursor: nextCursor,
          categoryId: filterCategoryIdRef.current,
        });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setItems(previousItems => {
          const seenIds = new Set(previousItems.map(item => item.id));
          const additionalItems = page.items.filter(item => !seenIds.has(item.id));
          return [...previousItems, ...additionalItems];
        });
        setNextCursor(page.nextCursor);
      } catch (caughtError) {
        if (loadRequestIdRef.current === requestId) {
          setError(getItemListErrorMessage(caughtError));
        }
      } finally {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    })();
  }, [authenticatedRequest, state, nextCursor, isLoading, isRefreshing]);

  const setFilterCategoryId = useCallback(
    (categoryId: number | null) => {
      if (filterCategoryIdRef.current === categoryId) {
        return;
      }
      filterCategoryIdRef.current = categoryId;
      setFilterCategoryIdState(categoryId);
      setItems([]);
      setNextCursor(null);
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
      load('initial');
    },
    [load],
  );

  return {
    items,
    isLoading,
    isRefreshing,
    isLoadingMore,
    error,
    refresh,
    loadMore,
    filterCategoryId,
    setFilterCategoryId,
  };
}
