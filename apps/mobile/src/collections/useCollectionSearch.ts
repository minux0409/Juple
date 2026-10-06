import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getCollectionItems, type CollectionItemEntry } from './api/collectionsApi';
import { getCollectionUnlockToken } from './collectionUnlockGrants';
import { ARCHIVE_SEARCH_DEBOUNCE_MS, normalizeArchiveQuery } from '../items/useArchiveSearch';

const PAGE_SIZE = 30;

/** Server-backed search over one Collection, independent of the currently loaded sections. */
export function useCollectionSearch(collectionId: number, rawQuery: string, sort: 'dateDesc' | 'dateAsc') {
  const request = useAuthenticatedApi();
  const term = normalizeArchiveQuery(rawQuery);
  const [items, setItems] = useState<readonly CollectionItemEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [settledTerm, setSettledTerm] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const sequence = useRef(0);
  const loadingMore = useRef(false);
  const current = useRef({ term, sort, collectionId });
  current.current = { term, sort, collectionId };

  const fetchPage = useCallback((cursor?: string) => {
    const state = current.current;
    return getCollectionItems(request, state.collectionId, {
      cursor,
      limit: PAGE_SIZE,
      q: state.term ?? undefined,
      sort: state.sort,
      unlockToken: getCollectionUnlockToken(state.collectionId),
    });
  }, [request]);

  const run = useCallback(async (searchTerm: string) => {
    const id = ++sequence.current;
    setIsLoading(true);
    setError(null);
    try {
      const page = await fetchPage();
      if (id !== sequence.current) { return; }
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setSettledTerm(searchTerm);
    } catch (caughtError) {
      if (id !== sequence.current) { return; }
      setItems([]);
      setNextCursor(null);
      setSettledTerm(searchTerm);
      setError(caughtError);
    } finally {
      if (id === sequence.current) { setIsLoading(false); }
    }
  }, [fetchPage]);

  useEffect(() => {
    if (term === null) {
      sequence.current++;
      setItems([]);
      setNextCursor(null);
      setSettledTerm(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    // Clear old results immediately so a changed query cannot show the previous Collection's content.
    sequence.current++;
    setItems([]);
    setNextCursor(null);
    setSettledTerm(null);
    setIsLoading(true);
    const timer = setTimeout(() => { run(term).catch(() => undefined); }, ARCHIVE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [collectionId, run, sort, term]);

  const loadMore = useCallback(() => {
    const state = current.current;
    if (!state.term || settledTerm !== state.term || !nextCursor || isLoading || loadingMore.current) { return; }
    const id = sequence.current;
    loadingMore.current = true;
    setIsLoadingMore(true);
    fetchPage(nextCursor)
      .then(page => {
        if (id !== sequence.current) { return; }
        setItems(previous => [...previous, ...page.items.filter(item => !previous.some(old => old.itemId === item.itemId))]);
        setNextCursor(page.nextCursor);
        setError(null);
      })
      .catch(caughtError => { if (id === sequence.current) { setError(caughtError); } })
      .finally(() => { loadingMore.current = false; setIsLoadingMore(false); });
  }, [fetchPage, isLoading, nextCursor, settledTerm]);

  const refresh = useCallback(() => {
    if (current.current.term) { run(current.current.term).catch(() => undefined); }
  }, [run]);
  const removeItem = useCallback((itemId: number) => {
    setItems(previous => previous.filter(item => item.itemId !== itemId));
  }, []);
  return { isSearching: term !== null, items, isLoading, isLoadingMore, error, settledTerm, loadMore, refresh, removeItem };
}
