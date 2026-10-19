'use client';

import { useCallback, useEffect, useState } from 'react';
import { failureMessage, type Page } from '../../lib/adminModel';
import { useAdmin } from './AdminRoot';

interface ListState<T> {
  /** Which list (key + attempt) these rows belong to; rows of another list are never shown. */
  readonly listId: string;
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * A keyset-paged admin list: the first page for `pathFor(null)`, then "더 보기" appends the next one. Changing `key` (a filter or a
 * search) starts over. Failures that end the admin session go to AdminRoot; others stay on the list with a retry.
 */
export function usePagedList<T>(key: string, pathFor: (cursor: string | null) => string) {
  const { api, reportFailure } = useAdmin();
  const [attempt, setAttempt] = useState(0);
  const listId = `${key}#${attempt}`;
  const [state, setState] = useState<ListState<T>>({ listId: '', items: [], nextCursor: null, loading: true, error: null });

  const fetchPage = useCallback(
    async (id: string, cursor: string | null, isCancelled: () => boolean) => {
      try {
        const page = await api<Page<T>>({ path: pathFor(cursor) });
        if (!isCancelled()) {
          setState(previous => ({
            listId: id,
            items: cursor && previous.listId === id ? [...previous.items, ...page.items] : page.items,
            nextCursor: page.nextCursor,
            loading: false,
            error: null,
          }));
        }
      } catch (failure) {
        if (!isCancelled()) {
          reportFailure(failure);
          setState(previous => ({
            ...(previous.listId === id ? previous : { items: [], nextCursor: null }),
            listId: id,
            loading: false,
            error: failureMessage(failure),
          }));
        }
      }
    },
    // pathFor is rebuilt every render; `key` is what identifies the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, reportFailure, key],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchPage(listId, null, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [fetchPage, listId]);

  const current = state.listId === listId;
  const items = current ? state.items : [];
  const nextCursor = current ? state.nextCursor : null;
  const loading = !current || state.loading;
  const error = current ? state.error : null;

  const loadMore = useCallback(() => {
    if (nextCursor && !loading) {
      setState(previous => ({ ...previous, loading: true, error: null }));
      void fetchPage(listId, nextCursor, () => false);
    }
  }, [fetchPage, listId, loading, nextCursor]);

  const retry = useCallback(() => {
    if (items.length > 0 && nextCursor) {
      loadMore();
    } else {
      setAttempt(value => value + 1);
    }
  }, [items.length, loadMore, nextCursor]);

  return { items, hasMore: nextCursor !== null, loading, error, loadMore, retry };
}
