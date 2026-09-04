import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getCollectionItems, type CollectionItemEntry } from './api/collectionsApi';

const PAGE_LIMIT = 50;

function getCollectionItemsErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'notFound') {
      return t('collections.errorNotFound');
    }
    if (error.kind === 'conflict') {
      return t('errors.accountNotReady');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('collections.errorItemsLoadFallback');
}

export interface UseCollectionItemsResult {
  readonly items: readonly CollectionItemEntry[];
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly isLoadingMore: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
  readonly loadMore: () => void;
  /** Removes an Item from the in-memory list immediately after a successful remove-from-Collection call. */
  readonly removeLocally: (itemId: number) => void;
}

/**
 * Loads and paginates a single Collection's Item list (newest-added-first - see
 * GET /api/v1/collections/{id}/items). Mirrors useItemHistory's verified pattern exactly: loading
 * is driven by focus (first focus = full-screen spinner, every later focus = a fresh first page,
 * so an Item added/removed elsewhere shows up without a manual pull-to-refresh), a monotonic
 * request generation discards stale in-flight results, and loadMore is guarded against firing more
 * than once per page.
 */
export function useCollectionItems(collectionId: number): UseCollectionItemsResult {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const [items, setItems] = useState<readonly CollectionItemEntry[]>([]);
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
        const page = await getCollectionItems(authenticatedRequest, collectionId, { limit: PAGE_LIMIT });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setItems(page.items);
        setNextCursor(page.nextCursor);
      } catch (caughtError) {
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        // Failure keeps whatever Items are already shown - only the error text changes.
        setError(getCollectionItemsErrorMessage(caughtError, t));
      } finally {
        if (loadRequestIdRef.current === requestId) {
          hasLoadedOnceRef.current = true;
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [authenticatedRequest, collectionId, t],
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
        const page = await getCollectionItems(authenticatedRequest, collectionId, {
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
          setError(getCollectionItemsErrorMessage(caughtError, t));
        }
      } finally {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    })();
  }, [authenticatedRequest, collectionId, nextCursor, isLoading, isRefreshing, t]);

  const removeLocally = useCallback((itemId: number) => {
    setItems(previousItems => previousItems.filter(item => item.itemId !== itemId));
  }, []);

  return { items, isLoading, isRefreshing, isLoadingMore, error, refresh, loadMore, removeLocally };
}
