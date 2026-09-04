import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getPurchases, type Purchase } from './api/purchasesApi';

const PAGE_LIMIT = 50;

function getPurchaseListErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'conflict') {
      return t('errors.accountNotReady');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('purchase.listErrorFallback');
}

export interface UsePurchaseListResult {
  readonly purchases: readonly Purchase[];
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly isLoadingMore: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
  readonly loadMore: () => void;
}

/**
 * Loads and paginates the Purchase History list. Mirrors useItemStateList exactly: loading is
 * driven entirely by focus (first focus = full-screen spinner, every later focus = a fresh first
 * page), so a Purchase created via PurchaseEditor and popped back to this tab appears without the
 * user having to pull-to-refresh, and there is still only ever one GET in flight per focus.
 */
export function usePurchaseList(): UsePurchaseListResult {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const [purchases, setPurchases] = useState<readonly Purchase[]>([]);
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
        const page = await getPurchases(authenticatedRequest, { limit: PAGE_LIMIT });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setPurchases(page.purchases);
        setNextCursor(page.nextCursor);
      } catch (caughtError) {
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setError(getPurchaseListErrorMessage(caughtError, t));
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
        const page = await getPurchases(authenticatedRequest, {
          limit: PAGE_LIMIT,
          cursor: nextCursor,
        });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setPurchases(previousPurchases => {
          const seenIds = new Set(previousPurchases.map(purchase => purchase.id));
          const additionalPurchases = page.purchases.filter(purchase => !seenIds.has(purchase.id));
          return [...previousPurchases, ...additionalPurchases];
        });
        setNextCursor(page.nextCursor);
      } catch (caughtError) {
        if (loadRequestIdRef.current === requestId) {
          setError(getPurchaseListErrorMessage(caughtError, t));
        }
      } finally {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    })();
  }, [authenticatedRequest, nextCursor, isLoading, isRefreshing, t]);

  return { purchases, isLoading, isRefreshing, isLoadingMore, error, refresh, loadMore };
}
