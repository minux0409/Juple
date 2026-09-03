import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getRepeatPurchases, type RepeatPurchase } from './api/repeatPurchasesApi';

const PAGE_LIMIT = 50;

function getRepeatPurchaseListErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'conflict') {
      return 'Juple 계정 준비 상태를 확인할 수 없습니다.';
    }
    if (error.kind === 'unauthorized') {
      return '인증 상태를 다시 확인할 수 없습니다.';
    }
  }
  return '반복 구매 목록을 불러올 수 없습니다.';
}

export interface UseRepeatPurchaseListResult {
  readonly repeatPurchases: readonly RepeatPurchase[];
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly isLoadingMore: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
  readonly loadMore: () => void;
}

/**
 * Loads and paginates the enabled RepeatPurchase list (includeDisabled is never set - this first
 * slice only shows enabled ones). Mirrors usePurchaseList/useItemStateList exactly: loading is
 * driven entirely by focus (first focus = full-screen spinner, every later focus = a fresh first
 * page), a monotonic request generation discards stale in-flight results, and onEndReached is
 * guarded against firing more than once per page. Entirely independent state from
 * usePurchaseList - a failure here never touches the Purchase History segment's state.
 */
export function useRepeatPurchaseList(): UseRepeatPurchaseListResult {
  const authenticatedRequest = useAuthenticatedApi();
  const [repeatPurchases, setRepeatPurchases] = useState<readonly RepeatPurchase[]>([]);
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
        const page = await getRepeatPurchases(authenticatedRequest, { limit: PAGE_LIMIT });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setRepeatPurchases(page.repeatPurchases);
        setNextCursor(page.nextCursor);
      } catch (caughtError) {
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setError(getRepeatPurchaseListErrorMessage(caughtError));
      } finally {
        if (loadRequestIdRef.current === requestId) {
          hasLoadedOnceRef.current = true;
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [authenticatedRequest],
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
        const page = await getRepeatPurchases(authenticatedRequest, {
          limit: PAGE_LIMIT,
          cursor: nextCursor,
        });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setRepeatPurchases(previousRepeatPurchases => {
          const seenIds = new Set(previousRepeatPurchases.map(repeatPurchase => repeatPurchase.id));
          const additionalRepeatPurchases = page.repeatPurchases.filter(
            repeatPurchase => !seenIds.has(repeatPurchase.id),
          );
          return [...previousRepeatPurchases, ...additionalRepeatPurchases];
        });
        setNextCursor(page.nextCursor);
      } catch (caughtError) {
        if (loadRequestIdRef.current === requestId) {
          setError(getRepeatPurchaseListErrorMessage(caughtError));
        }
      } finally {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    })();
  }, [authenticatedRequest, nextCursor, isLoading, isRefreshing]);

  return { repeatPurchases, isLoading, isRefreshing, isLoadingMore, error, refresh, loadMore };
}
