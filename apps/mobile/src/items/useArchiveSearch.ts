import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getItemHistory, type ItemHistoryEntry } from './api/itemsApi';

/** Shorter terms are not searched (a 1-character contains search matches nearly everything; the server refuses them too). */
export const ARCHIVE_SEARCH_MIN_LENGTH = 2;
export const ARCHIVE_SEARCH_DEBOUNCE_MS = 300;
export const ARCHIVE_SEARCH_PAGE_SIZE = 30;

/** The trimmed term when it is long enough to search, else null (the normal Archive shows). */
export function normalizeArchiveQuery(raw: string): string | null {
  const term = raw.trim();
  return term.length >= ARCHIVE_SEARCH_MIN_LENGTH ? term : null;
}

export type ArchiveFlatSort = 'time' | 'name';

export interface ArchiveSearchState {
  /** A query is active (2+ characters). */
  readonly isSearching: boolean;
  /**
   * The Archive is shown as ONE flat server-paged list instead of its date sections: a query is active, or 이름순 is
   * (the whole archive A-Z - an order only the server can give across every page).
   */
  readonly isFlat: boolean;
  readonly items: readonly ItemHistoryEntry[];
  /** The first page of the current term/sort is on its way (the screen keeps showing what it had until then). */
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly error: boolean;
  /** Identifies the query + sort the shown items belong to (null until the first page of it landed). */
  readonly settledTerm: string | null;
  /** More pages exist after the loaded ones. */
  readonly hasMore: boolean;
  /** The NEXT page failed (what is loaded stays): the screen shows the compact retry row; nothing retries by itself. */
  readonly moreError: boolean;
  readonly loadMore: () => void;
  readonly refresh: () => void;
  readonly removeItem: (itemId: number) => void;
}

/**
 * The Archive as a flat, server-paged list - a search over the user's whole archive and/or 이름순 over it (never only
 * the rows already loaded): the typed text is trimmed, debounced, and each request carries a sequence number, so a slow
 * answer for an older query or sort can never overwrite the newer one. Clearing the text under 시간순 cancels any
 * pending request and returns to the date sections at once. Results page by the server's cursor: newest first under
 * 시간순, A-Z under 이름순 (the same query, only the order differs). Changing only how the rows are shown (List / Grid /
 * Image) never reaches this hook, so it never asks again. `enabled` false holds every request back (the screen is still
 * learning which sort the user chose).
 */
export function useArchiveSearch(rawQuery: string, sort: ArchiveFlatSort = 'time', enabled = true): ArchiveSearchState {
  const request = useAuthenticatedApi();
  const term = normalizeArchiveQuery(rawQuery);
  // enabled false (the stored sort is still being read): nothing is requested yet, so no request can go out in the wrong order.
  const isFlat = enabled && (term !== null || sort === 'name');
  const queryKey = `${sort}|${term ?? ''}`;
  const [items, setItems] = useState<readonly ItemHistoryEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const sequenceRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;

  const current = useRef({ term, sort });
  current.current = { term, sort };
  const fetchPage = useCallback(
    (cursor: string | undefined) =>
      getItemHistory(request, {
        limit: ARCHIVE_SEARCH_PAGE_SIZE,
        q: current.current.term ?? undefined,
        sort: current.current.sort === 'name' ? 'name' : undefined,
        cursor,
      }),
    [request],
  );

  const run = useCallback(
    async (key: string) => {
      const sequence = ++sequenceRef.current;
      setIsLoading(true);
      setError(false);
      try {
        const page = await fetchPage(undefined);
        if (sequence !== sequenceRef.current) {
          return;
        }
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setSettledKey(key);
      } catch {
        if (sequence === sequenceRef.current) {
          setError(true);
          setItems([]);
          setNextCursor(null);
          setSettledKey(key);
        }
      } finally {
        if (sequence === sequenceRef.current) {
          setIsLoading(false);
        }
      }
    },
    [fetchPage],
  );

  useEffect(() => {
    // Whatever was loaded belongs to the previous query/sort.
    sequenceRef.current += 1;
    setItems([]);
    setNextCursor(null);
    setSettledKey(null);
    setError(false);
    setMoreError(false);
    if (!isFlat) {
      // Back to the date sections: nothing in flight can land later.
      setIsLoading(false);
      return undefined;
    }
    setIsLoading(true);
    if (term === null) {
      // 이름순 without text: nothing to wait for typing.
      run(queryKey).catch(() => undefined);
      return undefined;
    }
    // Debounced: one request after the typing pauses, not one per keystroke.
    const timer = setTimeout(() => {
      run(queryKey).catch(() => undefined);
    }, ARCHIVE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isFlat, queryKey, run, term]);

  const loadMore = useCallback(() => {
    if (!isFlat || !nextCursor || isLoading || loadingMoreRef.current || settledKey !== queryKeyRef.current) {
      return;
    }
    const sequence = sequenceRef.current;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    setMoreError(false);
    fetchPage(nextCursor)
      .then(page => {
        if (sequence !== sequenceRef.current) {
          return;
        }
        setItems(previous => [...previous, ...page.items.filter(entry => !previous.some(existing => existing.id === entry.id))]);
        setNextCursor(page.nextCursor);
      })
      .catch(() => {
        if (sequence === sequenceRef.current) {
          setMoreError(true);
        }
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      });
  }, [fetchPage, isFlat, isLoading, nextCursor, settledKey]);

  const refresh = useCallback(() => {
    if (isFlat) {
      run(queryKeyRef.current).catch(() => undefined);
    }
  }, [isFlat, run]);

  const removeItem = useCallback((itemId: number) => setItems(previous => previous.filter(entry => entry.id !== itemId)), []);

  return { isSearching: term !== null, isFlat, items, isLoading, isLoadingMore, error, settledTerm: settledKey, hasMore: nextCursor !== null, moreError, loadMore, refresh, removeItem };
}
