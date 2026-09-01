import { useCallback, useEffect, useRef, useState } from 'react';
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
}

/** Loads and paginates the Item list for a single lifecycle state (Wishlist or Archive). */
export function useItemStateList(state: ItemListState): UseItemStateListResult {
  const authenticatedRequest = useAuthenticatedApi();
  const [items, setItems] = useState<readonly ItemListEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards onEndReached firing multiple times before state updates are visible to new calls.
  const loadingMoreRef = useRef(false);
  // Discards a stale in-flight initial/refresh load's result if a newer one has since started.
  const loadRequestIdRef = useRef(0);

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
        setError(getItemListErrorMessage(caughtError));
      } finally {
        if (loadRequestIdRef.current === requestId) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [authenticatedRequest, state],
  );

  useEffect(() => {
    load('initial');
  }, [load]);

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

    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    (async () => {
      try {
        const page = await getItemsByState(authenticatedRequest, state, {
          limit: PAGE_LIMIT,
          cursor: nextCursor,
        });
        setItems(previousItems => {
          const seenIds = new Set(previousItems.map(item => item.id));
          const additionalItems = page.items.filter(item => !seenIds.has(item.id));
          return [...previousItems, ...additionalItems];
        });
        setNextCursor(page.nextCursor);
      } catch (caughtError) {
        setError(getItemListErrorMessage(caughtError));
      } finally {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    })();
  }, [authenticatedRequest, state, nextCursor, isLoading, isRefreshing]);

  return { items, isLoading, isRefreshing, isLoadingMore, error, refresh, loadMore };
}
