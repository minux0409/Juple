import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getCollectionItems, type CollectionItemEntry, type CollectionItemsSort } from './api/collectionsApi';
import { forgetCollectionUnlock, getCollectionUnlockToken } from './collectionUnlockGrants';
import { isHandledSubscriptionRefusal } from '../billing/subscriptionRequired';

/** The server's "locked and no valid grant" answer - content is withheld until the password is entered. */
export function isCollectionLockedError(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'forbidden' && error.code === 'collectionLocked';
}

/** The server's "this shared Collection needs its share password" answer (never for the Owner). */
export function isSharePasswordRequiredError(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'forbidden' && error.code === 'sharePasswordRequired';
}

/** Which password withheld the content, or null for any other error. */
export function contentGateOfError(error: unknown): 'lock' | 'sharePassword' | null {
  return isCollectionLockedError(error) ? 'lock' : isSharePasswordRequiredError(error) ? 'sharePassword' : null;
}

const PAGE_LIMIT = 50;

/**
 * 이름순 needs every link of the Collection before it can show any order at all (a name order over
 * only the loaded pages would look like the whole Collection's and be wrong), and the server cannot
 * sort by name in each app language's own rules. So a name-ordered Collection is loaded whole, up
 * to this many links (at most five 100-link requests); a larger one is never shown name-ordered -
 * see isTooLargeForNameOrder.
 */
export const NAME_ORDER_MAX_LINKS = 500;
const WHOLE_COLLECTION_PAGE_LIMIT = 100;

/**
 * How the list is loaded: one of the server's own date orders ('dateDesc' newest first, 'dateAsc'
 * oldest first - over the whole Collection, page by page as the list scrolls), or 'whole' - every
 * link at once, for an order only the client can apply (이름순).
 */
export type CollectionItemsLoadMode = CollectionItemsSort | 'whole';

export function getCollectionItemsErrorMessage(error: unknown, t: TFunction): string {
  if (isHandledSubscriptionRefusal(error)) {
    return '';
  }
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
  /**
   * The Collection is locked and this session holds no valid grant for it - no Items were
   * returned (none are ever sent before the password is proven). Cleared by a successful load.
   */
  readonly isLocked: boolean;
  /** Which password withheld the content while isLocked (the Owner's lock, or the share password). */
  readonly lockKind: 'lock' | 'sharePassword' | null;
  /** More pages exist on the server (a next cursor is held). */
  readonly hasMore: boolean;
  readonly refresh: () => void;
  readonly loadMore: () => void;
  /**
   * 'whole' mode only: the Collection has more than NAME_ORDER_MAX_LINKS links, so nothing was kept
   * (items is empty) - the caller must not offer a name order for it.
   */
  readonly isTooLargeForNameOrder: boolean;
  /** Removes an Item from the in-memory list immediately after a successful remove-from-Collection call. */
  readonly removeLocally: (itemId: number) => void;
  /**
   * Moves itemId to immediately after afterItemId (null = front) in the in-memory list - for an
   * optimistic update ahead of a moveCollectionItem API call actually resolving, should a future
   * reorder UI need one (Category Details' own drag-based attempt was removed - see git history -
   * but this helper and the backend's moveCollectionItem endpoint are kept for later reuse). Returns
   * the previous item order so the caller can roll back to it verbatim if that call fails.
   */
  readonly reorderLocally: (itemId: number, afterItemId: number | null) => readonly CollectionItemEntry[];
  /** Restores a previous item order verbatim - used to roll back an optimistic reorderLocally call after a failed API request. */
  readonly restoreOrder: (previousItems: readonly CollectionItemEntry[]) => void;
}

/**
 * Loads and paginates a single Collection's Item list (see GET /api/v1/collections/{id}/items and
 * CollectionItemsLoadMode). Mirrors useItemHistory's verified pattern exactly: loading is driven by
 * focus (first focus = full-screen spinner, every later focus = a fresh first page, so an Item
 * added/removed elsewhere shows up without a manual pull-to-refresh), a monotonic request
 * generation discards stale in-flight results, and loadMore is guarded against firing more than
 * once per page. Changing the mode starts over: the list and cursor are dropped and the new order's
 * first page is loaded - a cursor is never carried from one order into another.
 */
export function useCollectionItems(
  collectionId: number,
  loadMode: CollectionItemsLoadMode = 'dateDesc',
  /** False: nothing is requested (a screen showing this Collection another way, e.g. by date section). */
  enabled = true,
): UseCollectionItemsResult {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const [items, setItems] = useState<readonly CollectionItemEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockKind, setLockKind] = useState<'lock' | 'sharePassword' | null>(null);
  const isLocked = lockKind !== null;
  const [isTooLargeForNameOrder, setIsTooLargeForNameOrder] = useState(false);

  const loadingMoreRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);
  // The mode the shown list was loaded in - a different one must never extend or show it.
  const loadedModeRef = useRef<CollectionItemsLoadMode | null>(null);

  /** Every link of the Collection (newest first), or null when it is over NAME_ORDER_MAX_LINKS. */
  const fetchWholeCollection = useCallback(
    async (isCurrent: () => boolean): Promise<readonly CollectionItemEntry[] | null> => {
      const collected: CollectionItemEntry[] = [];
      const seenIds = new Set<number>();
      let cursor: string | undefined;
      do {
        const page = await getCollectionItems(authenticatedRequest, collectionId, {
          limit: WHOLE_COLLECTION_PAGE_LIMIT,
          cursor,
          sort: 'dateDesc',
          unlockToken: getCollectionUnlockToken(collectionId),
        });
        if (!isCurrent()) {
          return [];
        }
        for (const item of page.items) {
          if (!seenIds.has(item.itemId)) {
            seenIds.add(item.itemId);
            collected.push(item);
          }
        }
        if (collected.length > NAME_ORDER_MAX_LINKS || (page.nextCursor !== null && collected.length >= NAME_ORDER_MAX_LINKS)) {
          return null;
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return collected;
    },
    [authenticatedRequest, collectionId],
  );

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const requestId = ++loadRequestIdRef.current;
      const isCurrent = () => loadRequestIdRef.current === requestId;
      const isModeChange = loadedModeRef.current !== null && loadedModeRef.current !== loadMode;
      if (isModeChange) {
        // A new order starts from nothing: no link or cursor of the previous order stays.
        loadedModeRef.current = null;
        setItems([]);
        setNextCursor(null);
        setIsTooLargeForNameOrder(false);
      }
      if (mode === 'refresh' && !isModeChange) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        if (loadMode === 'whole') {
          const whole = await fetchWholeCollection(isCurrent);
          if (!isCurrent()) {
            return;
          }
          setLockKind(null);
          loadedModeRef.current = loadMode;
          setItems(whole ?? []);
          setNextCursor(null);
          setIsTooLargeForNameOrder(whole === null);
          return;
        }

        const page = await getCollectionItems(authenticatedRequest, collectionId, {
          limit: PAGE_LIMIT,
          sort: loadMode,
          unlockToken: getCollectionUnlockToken(collectionId),
        });
        if (!isCurrent()) {
          return;
        }
        setLockKind(null);
        loadedModeRef.current = loadMode;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      } catch (caughtError) {
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        const gate = contentGateOfError(caughtError);
        if (gate) {
          // A stale/invalidated grant (password changed, lock re-set) is dropped, and nothing
          // previously shown stays on screen.
          forgetCollectionUnlock(collectionId);
          setItems([]);
          setNextCursor(null);
          setLockKind(gate);
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
    [authenticatedRequest, collectionId, fetchWholeCollection, loadMode, t],
  );

  useFocusEffect(
    useCallback(() => {
      if (enabled) {
        load(hasLoadedOnceRef.current ? 'refresh' : 'initial');
      }
    }, [enabled, load]),
  );

  const refresh = useCallback(() => {
    if (isRefreshing) {
      return;
    }
    load('refresh');
  }, [isRefreshing, load]);

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || isLoading || isRefreshing || !nextCursor || loadMode === 'whole' || loadedModeRef.current !== loadMode) {
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
          sort: loadMode,
          unlockToken: getCollectionUnlockToken(collectionId),
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
          const gate = contentGateOfError(caughtError);
          if (gate) {
            forgetCollectionUnlock(collectionId);
            setItems([]);
            setNextCursor(null);
            setLockKind(gate);
          } else {
            setError(getCollectionItemsErrorMessage(caughtError, t));
          }
        }
      } finally {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    })();
  }, [authenticatedRequest, collectionId, nextCursor, isLoading, isRefreshing, loadMode, t]);

  const removeLocally = useCallback((itemId: number) => {
    setItems(previousItems => previousItems.filter(item => item.itemId !== itemId));
  }, []);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const reorderLocally = useCallback((itemId: number, afterItemId: number | null) => {
    const previousItems = itemsRef.current;
    const moving = previousItems.find(item => item.itemId === itemId);
    if (!moving) {
      return previousItems;
    }

    const withoutMoving = previousItems.filter(item => item.itemId !== itemId);
    const insertIndex =
      afterItemId === null ? 0 : withoutMoving.findIndex(item => item.itemId === afterItemId) + 1;
    const reordered = [...withoutMoving];
    reordered.splice(insertIndex, 0, moving);

    setItems(reordered);
    return previousItems;
  }, []);

  const restoreOrder = useCallback((previousItems: readonly CollectionItemEntry[]) => {
    setItems(previousItems);
  }, []);

  return {
    items,
    isLoading,
    isRefreshing,
    isLoadingMore,
    error,
    isLocked,
    lockKind,
    hasMore: nextCursor !== null,
    isTooLargeForNameOrder,
    refresh,
    loadMore,
    removeLocally,
    reorderLocally,
    restoreOrder,
  };
}
