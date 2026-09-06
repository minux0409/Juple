import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import { getPublicCollectionItems, type PublicCollectionItem } from './api/publicCollectionsApi';

const PAGE_LIMIT = 50;

export interface UsePublicCollectionItemsResult {
  readonly items: readonly PublicCollectionItem[];
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly loadMore: () => void;
}

/**
 * Loads and paginates a shared Collection's read-only Item list via the anonymous Public API -
 * mirrors useCollectionItems' verified pattern (focus-driven load, a monotonic request generation
 * that discards stale in-flight results, loadMore guarded against firing more than once per page),
 * minus everything that only makes sense for an owner (refresh-to-pull, removeLocally). No
 * itemId/CollectionItemId exists in this DTO to dedupe by (see publicCollectionsApi.ts) - trusts
 * the cursor not to repeat an Item, exactly like the Web Viewer's ItemList.tsx.
 *
 * A load failure here (including a revoked/unknown publicId) is not surfaced as its own error
 * banner - SharedCollectionScreen's own getPublicCollection call already resolves the
 * unavailable state for the whole screen, so this hook just leaves the Item list empty.
 */
export function usePublicCollectionItems(publicId: string): UsePublicCollectionItemsResult {
  const [items, setItems] = useState<readonly PublicCollectionItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const loadingMoreRef = useRef(false);
  const loadRequestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    setIsLoading(true);

    try {
      const page = await getPublicCollectionItems(publicId, { limit: PAGE_LIMIT });
      if (loadRequestIdRef.current !== requestId) {
        return;
      }
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch {
      if (loadRequestIdRef.current !== requestId) {
        return;
      }
      setItems([]);
      setNextCursor(null);
    } finally {
      if (loadRequestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [publicId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || isLoading || !nextCursor) {
      return;
    }

    const requestId = loadRequestIdRef.current;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    (async () => {
      try {
        const page = await getPublicCollectionItems(publicId, { limit: PAGE_LIMIT, cursor: nextCursor });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setItems(previousItems => [...previousItems, ...page.items]);
        setNextCursor(page.nextCursor);
      } catch {
        // Keep whatever Items are already shown - the user can retry by scrolling again.
      } finally {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    })();
  }, [publicId, nextCursor, isLoading]);

  return { items, isLoading, isLoadingMore, loadMore };
}
