import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getItemHistory, type ItemHistoryEntry } from './api/itemsApi';
import { isHandledSubscriptionRefusal } from '../billing/subscriptionRequired';

const PAGE_LIMIT = 50;

function getItemHistoryErrorMessage(error: unknown, t: TFunction): string {
  if (isHandledSubscriptionRefusal(error)) {
    return '';
  }
  if (error instanceof ApiError) {
    if (error.kind === 'conflict') {
      return t('errors.accountNotReady');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('history.errorLoadFallback');
}

export interface UseItemHistoryResult {
  readonly items: readonly ItemHistoryEntry[];
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly isLoadingMore: boolean;
  readonly error: string | null;
  /** More pages exist on the server (a next cursor is held). */
  readonly hasMore: boolean;
  readonly refresh: () => void;
  /** Appends the next page; a no-op while one is in flight, during a first-page load, or at the end. */
  readonly loadMore: () => void;
  /** Removes an already-deleted Item from the in-memory list - the caller owns the actual delete API call. */
  readonly removeItem: (itemId: number) => void;
}

/**
 * Loads and paginates the full History list (every Item the user has ever saved, regardless of
 * current state - see GET /api/v1/items/history) so the page size is never visible to the user:
 * the server's stable (SavedAtUtc, Id) cursor is followed page by page as the list scrolls, and
 * one page is prefetched in the background right after the first one, so reaching the end of
 * the first page never waits. Nothing beyond that one page is fetched ahead - a user with
 * thousands of links only ever loads what they scroll to.
 *
 * Loading is driven by focus (first focus = full-screen spinner, every later focus = a fresh first
 * page, so a newly-saved Item shows up without pull-to-refresh). A monotonic request generation
 * discards stale in-flight results (a refresh or refocus supersedes any page still loading), the
 * same cursor is never requested twice, and results arriving after unmount are dropped.
 * Section/date grouping is a pure display-layer concern (see historyDateGrouping.ts) applied to
 * this hook's flat `items` array, so a page boundary landing mid-day never splits a date section.
 */
export function useItemHistory(): UseItemHistoryResult {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const [items, setItems] = useState<readonly ItemHistoryEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards onEndReached firing multiple times before state updates are visible to new calls.
  const loadingMoreRef = useRef(false);
  // The cursor last requested for this generation - the same page is never fetched twice.
  const requestedCursorRef = useRef<string | null>(null);
  // Discards a stale in-flight load's result if a newer first-page load has since started.
  const loadRequestIdRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      // Anything still in flight belongs to a screen that is gone (see isCurrent).
      isMountedRef.current = false;
    };
  }, []);

  /** A response still belongs on screen: same generation, and the screen is still there. */
  const isCurrent = useCallback((requestId: number) => isMountedRef.current && loadRequestIdRef.current === requestId, []);

  /** Fetches the page after `cursor` for the current generation and appends it (deduplicated). */
  const fetchNextPage = useCallback(
    async (cursor: string) => {
      if (loadingMoreRef.current || requestedCursorRef.current === cursor) {
        return;
      }
      const requestId = loadRequestIdRef.current;
      loadingMoreRef.current = true;
      requestedCursorRef.current = cursor;
      setIsLoadingMore(true);
      try {
        const page = await getItemHistory(authenticatedRequest, { limit: PAGE_LIMIT, cursor });
        if (!isCurrent(requestId)) {
          return;
        }
        setItems(previousItems => {
          const seenIds = new Set(previousItems.map(item => item.id));
          const additionalItems = page.items.filter(item => !seenIds.has(item.id));
          return [...previousItems, ...additionalItems];
        });
        setNextCursor(page.nextCursor);
      } catch (caughtError) {
        if (isCurrent(requestId)) {
          // Allows a retry of this same cursor on the next scroll.
          requestedCursorRef.current = null;
          setError(getItemHistoryErrorMessage(caughtError, t));
        }
      } finally {
        loadingMoreRef.current = false;
        if (isMountedRef.current) {
          setIsLoadingMore(false);
        }
      }
    },
    [authenticatedRequest, isCurrent, t],
  );

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const requestId = ++loadRequestIdRef.current;
      if (mode === 'refresh') {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      // A new first page starts a new generation: any page still loading for the old one is
      // ignored when it lands, and its cursor may be requested again.
      requestedCursorRef.current = null;
      loadingMoreRef.current = false;
      setIsLoadingMore(false);

      let prefetchCursor: string | null = null;
      try {
        const page = await getItemHistory(authenticatedRequest, { limit: PAGE_LIMIT });
        if (!isCurrent(requestId)) {
          return;
        }
        setItems(page.items);
        setNextCursor(page.nextCursor);
        prefetchCursor = page.nextCursor;
      } catch (caughtError) {
        if (!isCurrent(requestId)) {
          return;
        }
        // Failure keeps whatever History is already shown - only the error text changes.
        setError(getItemHistoryErrorMessage(caughtError, t));
      } finally {
        if (isCurrent(requestId)) {
          hasLoadedOnceRef.current = true;
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }

      // Background prefetch of exactly one more page, so the end of the first page never waits.
      if (prefetchCursor !== null && isCurrent(requestId)) {
        await fetchNextPage(prefetchCursor);
      }
    },
    [authenticatedRequest, fetchNextPage, isCurrent, t],
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
    if (isLoading || isRefreshing || !nextCursor) {
      return;
    }
    fetchNextPage(nextCursor);
  }, [fetchNextPage, nextCursor, isLoading, isRefreshing]);

  const removeItem = useCallback((itemId: number) => {
    setItems(previousItems => previousItems.filter(item => item.id !== itemId));
  }, []);

  return { items, isLoading, isRefreshing, isLoadingMore, error, hasMore: nextCursor !== null, refresh, loadMore, removeItem };
}
