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
   * The Archive is ONE flat server-paged list - always, once enabled (there are no date sections any more): every link,
   * newest first, or a query's results.
   */
  readonly isFlat: boolean;
  readonly items: readonly ItemHistoryEntry[];
  /** The first page of the current term/sort is on its way (the screen keeps showing what it had until then). */
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly error: boolean;
  readonly errorCause?: unknown;
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
 * The Archive as one flat, server-paged list: every link newest first, or a search over the whole archive (never only
 * the rows already loaded). The typed text is trimmed, debounced, and each request carries a sequence number, so a slow
 * answer for an older query can never overwrite the newer one; clearing the text goes straight back to every link. Results
 * page by the server's cursor - newest first (the server's own order: saved time, then id); `sort` 'name' asks for A-Z.
 * Changing only how the rows are shown (List / Grid / Image) never reaches this hook, so it never asks again. `enabled`
 * false holds every request back.
 */
export function useArchiveSearch(rawQuery: string, sort: ArchiveFlatSort = 'time', enabled = true): ArchiveSearchState {
  const request = useAuthenticatedApi();
  const term = normalizeArchiveQuery(rawQuery);
  // enabled false (the stored sort is still being read): nothing is requested yet, so no request can go out in the wrong order.
  const isFlat = enabled;
  const queryKey = `${sort}|${term ?? ''}`;
  const [items, setItems] = useState<readonly ItemHistoryEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [errorCause, setErrorCause] = useState<unknown>(null);
  const [moreError, setMoreError] = useState(false);
  const sequenceRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const firstInFlight = useRef<string | null>(null);
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
      if (firstInFlight.current === key) return;
      const sequence = ++sequenceRef.current;
      firstInFlight.current = key;
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
      setIsLoading(true);
      setError(false);
      setMoreError(false);
      setErrorCause(null);
      try {
        const page = await fetchPage(undefined);
        if (sequence !== sequenceRef.current || key !== queryKeyRef.current) {
          return;
        }
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setSettledKey(key);
      } catch (cause) {
        if (sequence === sequenceRef.current && key === queryKeyRef.current) {
          setError(true);
          setErrorCause(cause);
          // A refresh failure leaves this query's successful pages available. A changed query
          // already cleared its old rows in the effect below; never show another query's data.
          setSettledKey(key);
        }
      } finally {
        if (sequence === sequenceRef.current) {
          firstInFlight.current = null;
          setIsLoading(false);
        }
      }
    },
    [fetchPage],
  );

  useEffect(() => {
    // Whatever was loaded belongs to the previous query/sort.
    sequenceRef.current += 1;
    firstInFlight.current = null;
    loadingMoreRef.current = false;
    setIsLoadingMore(false);
    setItems([]);
    setNextCursor(null);
    setSettledKey(null);
    setError(false);
    setErrorCause(null);
    setMoreError(false);
    if (!isFlat) {
      // Held back: nothing in flight can land later.
      setIsLoading(false);
      return () => { sequenceRef.current++; };
    }
    setIsLoading(true);
    if (term === null) {
      // Every link (no text): nothing to wait for typing.
      run(queryKey).catch(() => undefined);
      return () => { sequenceRef.current++; };
    }
    // Debounced: one request after the typing pauses, not one per keystroke.
    const timer = setTimeout(() => {
      run(queryKey).catch(() => undefined);
    }, ARCHIVE_SEARCH_DEBOUNCE_MS);
    return () => { clearTimeout(timer); sequenceRef.current++; };
  }, [isFlat, queryKey, run, term]);

  const loadMore = useCallback(() => {
    if (!isFlat || !nextCursor || isLoading || firstInFlight.current !== null || loadingMoreRef.current || settledKey !== queryKeyRef.current) {
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
        setItems(previous => {
          const knownIds = new Set(previous.map(existing => existing.id));
          return [...previous, ...page.items.filter(entry => !knownIds.has(entry.id))];
        });
        setNextCursor(page.nextCursor);
      })
      .catch(cause => {
        if (sequence === sequenceRef.current) {
          setMoreError(true);
          setErrorCause(cause);
        }
      })
      .finally(() => {
        if (sequence === sequenceRef.current) {
          loadingMoreRef.current = false;
          setIsLoadingMore(false);
        }
      });
  }, [fetchPage, isFlat, isLoading, nextCursor, settledKey]);

  const refresh = useCallback(() => {
    if (isFlat) {
      run(queryKeyRef.current).catch(() => undefined);
    }
  }, [isFlat, run]);

  const removeItem = useCallback((itemId: number) => setItems(previous => previous.filter(entry => entry.id !== itemId)), []);

  return { isSearching: term !== null, isFlat, items, isLoading, isLoadingMore, error, errorCause, settledTerm: settledKey, hasMore: nextCursor !== null, moreError, loadMore, refresh, removeItem };
}
