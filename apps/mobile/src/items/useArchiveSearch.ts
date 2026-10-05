import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getItemHistory, getItemHistoryByDate, type ItemHistoryEntry } from './api/itemsApi';

/** Shorter terms are not searched (a 1-character contains search matches nearly everything; the server refuses them too). */
export const ARCHIVE_SEARCH_MIN_LENGTH = 2;
export const ARCHIVE_SEARCH_DEBOUNCE_MS = 300;
export const ARCHIVE_SEARCH_PAGE_SIZE = 30;

/** The trimmed term when it is long enough to search, else null (the normal Archive shows). */
export function normalizeArchiveQuery(raw: string): string | null {
  const term = raw.trim();
  return term.length >= ARCHIVE_SEARCH_MIN_LENGTH ? term : null;
}

export interface ArchiveSearchState {
  /**
   * A filter is active - the typed text is long enough and/or a date is selected - so flat results, not the date
   * accordion, are shown. Text and date combine (both apply); neither is ever filtered on the device.
   */
  readonly isSearching: boolean;
  readonly items: readonly ItemHistoryEntry[];
  /** The first page of the current term is on its way (the screen keeps showing what it had until then). */
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly error: boolean;
  /** The filter (text + date) the shown items belong to. */
  readonly settledTerm: string | null;
  readonly loadMore: () => void;
  readonly refresh: () => void;
  readonly removeItem: (itemId: number) => void;
}

/**
 * Searches the user's whole archive on the server (never only the rows already loaded): the typed text
 * is trimmed, debounced, and each request carries a sequence number, so a slow answer for an older
 * filter can never overwrite the newer one. Clearing the text (or going under the minimum) AND the date cancels any
 * pending request and returns to the normal Archive at once. Results page by cursor, newest first.
 *
 * date ("YYYY-MM-DD", a local calendar day) is a second condition of the same query: with it the server resolves the
 * day in the user's stored time zone (the rule that counted it in the calendar) and applies the text inside it.
 */
export function useArchiveSearch(rawQuery: string, date: string | null = null): ArchiveSearchState {
  const request = useAuthenticatedApi();
  const text = normalizeArchiveQuery(rawQuery);
  // One identity for "this filter" (also what settledTerm reports): the text, the day, or both.
  const term = text === null && date === null ? null : `${date ?? ''}|${text ?? ''}`;
  const [items, setItems] = useState<readonly ItemHistoryEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [settledTerm, setSettledTerm] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const sequenceRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const termRef = useRef(term);
  termRef.current = term;

  const textRef = useRef(text);
  textRef.current = text;
  const dateRef = useRef(date);
  dateRef.current = date;

  const fetchPage = useCallback(
    (cursor: string | undefined) =>
      dateRef.current !== null
        ? getItemHistoryByDate(request, dateRef.current, { limit: ARCHIVE_SEARCH_PAGE_SIZE, q: textRef.current ?? undefined, cursor })
        : getItemHistory(request, { limit: ARCHIVE_SEARCH_PAGE_SIZE, q: textRef.current ?? undefined, cursor }),
    [request],
  );

  const run = useCallback(
    async (searchTerm: string) => {
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
        setSettledTerm(searchTerm);
      } catch {
        if (sequence === sequenceRef.current) {
          setError(true);
          setItems([]);
          setNextCursor(null);
          setSettledTerm(searchTerm);
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
    if (term === null) {
      // Back to the normal Archive: whatever was in flight is dropped, nothing stale can land later.
      sequenceRef.current += 1;
      setIsLoading(false);
      setItems([]);
      setNextCursor(null);
      setSettledTerm(null);
      setError(false);
      return undefined;
    }
    // Debounced: one request after the typing pauses, not one per keystroke.
    setIsLoading(true);
    // Typing is debounced; picking a day is one deliberate tap - no wait.
    const timer = setTimeout(() => {
      run(term).catch(() => undefined);
    }, text === null ? 0 : ARCHIVE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [run, term, text]);

  const loadMore = useCallback(() => {
    const current = termRef.current;
    if (!current || !nextCursor || isLoading || loadingMoreRef.current || settledTerm !== current) {
      return;
    }
    const sequence = sequenceRef.current;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    fetchPage(nextCursor)
      .then(page => {
        if (sequence !== sequenceRef.current) {
          return;
        }
        setItems(previous => [...previous, ...page.items.filter(entry => !previous.some(existing => existing.id === entry.id))]);
        setNextCursor(page.nextCursor);
      })
      .catch(() => undefined)
      .finally(() => {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      });
  }, [fetchPage, isLoading, nextCursor, settledTerm]);

  const refresh = useCallback(() => {
    if (termRef.current) {
      run(termRef.current).catch(() => undefined);
    }
  }, [run]);

  const removeItem = useCallback((itemId: number) => setItems(previous => previous.filter(entry => entry.id !== itemId)), []);

  return { isSearching: term !== null, items, isLoading, isLoadingMore, error, settledTerm, loadMore, refresh, removeItem };
}
