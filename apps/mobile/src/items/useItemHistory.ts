import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getItemHistory, type ItemHistoryEntry } from './api/itemsApi';

const PAGE_LIMIT = 50;

function getItemHistoryErrorMessage(error: unknown, t: TFunction): string {
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
  readonly refresh: () => void;
  readonly loadMore: () => void;
}

/**
 * Loads and paginates the full History list (every Item the user has ever saved, regardless of
 * current state - see GET /api/v1/items/history). Mirrors usePurchaseList exactly: loading is
 * driven entirely by focus (first focus = full-screen spinner, every later focus = a fresh first
 * page, so a newly-saved Item shows up without the user having to pull-to-refresh), a monotonic
 * request generation discards stale in-flight results, and onEndReached is guarded against firing
 * more than once per page. Section/date grouping is a pure display-layer concern (see
 * historyDateGrouping.ts) applied to this hook's flat `items` array - it is not done here, so a
 * page boundary landing mid-day never fragments a date section on screen.
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
  // Discards a stale in-flight initial/refresh load's result if a newer one has since started.
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
        const page = await getItemHistory(authenticatedRequest, { limit: PAGE_LIMIT });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setItems(page.items);
        setNextCursor(page.nextCursor);
      } catch (caughtError) {
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        // Failure keeps whatever History is already shown - only the error text changes.
        setError(getItemHistoryErrorMessage(caughtError, t));
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
        const page = await getItemHistory(authenticatedRequest, {
          limit: PAGE_LIMIT,
          cursor: nextCursor,
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
          setError(getItemHistoryErrorMessage(caughtError, t));
        }
      } finally {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    })();
  }, [authenticatedRequest, nextCursor, isLoading, isRefreshing, t]);

  return { items, isLoading, isRefreshing, isLoadingMore, error, refresh, loadMore };
}
