import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getRecentlyOpenedLinks, type RecentlyOpenedLink } from './api/recentlyOpenedLinksApi';

const PAGE_LIMIT = 50;

function getRecentlyOpenedLinksErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'conflict') {
      return t('errors.accountNotReady');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('recentlyOpenedLinks.errorLoadFallback');
}

export interface UseRecentlyOpenedLinksResult {
  readonly items: readonly RecentlyOpenedLink[];
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly isLoadingMore: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
  readonly loadMore: () => void;
  /** Removes an entry from the in-memory list immediately after a successful individual delete. */
  readonly removeLocally: (itemId: number) => void;
  /** Clears the in-memory list immediately after a successful "delete all". */
  readonly clearLocally: () => void;
}

/**
 * Loads and paginates My Page's "최근 본 링크" (Recently opened links) list - mirrors
 * useCollectionItems.ts's verified pattern (focus-driven load, a monotonic request generation that
 * discards stale in-flight results, loadMore guarded against firing more than once per page).
 *
 * Re-opening an Item already on a loaded page changes its LastOpenedAtUtc server-side and moves it
 * to the top - rather than reconciling that reorder client-side (a duplicated-row/cache-consistency
 * risk for little benefit), RecentlyOpenedLinksScreen just calls refresh() after a successful
 * re-open, which reloads the first page fresh. The simplest safe option, per design.
 */
export function useRecentlyOpenedLinks(): UseRecentlyOpenedLinksResult {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const [items, setItems] = useState<readonly RecentlyOpenedLink[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadingMoreRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);

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
        const page = await getRecentlyOpenedLinks(authenticatedRequest, { limit: PAGE_LIMIT });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setItems(page.items);
        setNextCursor(page.nextCursor);
      } catch (caughtError) {
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        // Failure keeps whatever is already shown - only the error text changes.
        setError(getRecentlyOpenedLinksErrorMessage(caughtError, t));
      } finally {
        if (loadRequestIdRef.current === requestId) {
          hasLoadedOnceRef.current = true;
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [authenticatedRequest, t],
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

    const requestId = loadRequestIdRef.current;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    (async () => {
      try {
        const page = await getRecentlyOpenedLinks(authenticatedRequest, {
          limit: PAGE_LIMIT,
          cursor: nextCursor,
        });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setItems(previousItems => {
          const seenIds = new Set(previousItems.map(item => item.itemId));
          const additionalItems = page.items.filter(item => !seenIds.has(item.itemId));
          return [...previousItems, ...additionalItems];
        });
        setNextCursor(page.nextCursor);
      } catch (caughtError) {
        if (loadRequestIdRef.current === requestId) {
          setError(getRecentlyOpenedLinksErrorMessage(caughtError, t));
        }
      } finally {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    })();
  }, [authenticatedRequest, nextCursor, isLoading, isRefreshing, t]);

  const removeLocally = useCallback((itemId: number) => {
    setItems(previousItems => previousItems.filter(item => item.itemId !== itemId));
  }, []);

  const clearLocally = useCallback(() => {
    setItems([]);
    setNextCursor(null);
  }, []);

  return {
    items,
    isLoading,
    isRefreshing,
    isLoadingMore,
    error,
    refresh,
    loadMore,
    removeLocally,
    clearLocally,
  };
}
