import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getSupportInquiries, type SupportInquiry } from './api/supportInquiryApi';

export const SUPPORT_INQUIRY_PAGE_SIZE = 20;

/**
 * 문의내역: the signed-in user's inquiries, newest first, a page at a time. A failed FIRST load has nothing to show
 * (`loadError`, a full failure state); a failed refresh or next page keeps what is loaded (`noticeError`, a compact
 * retry row). Pages never repeat an inquiry, and one request is in flight at a time.
 */
export function useSupportInquiryHistory(enabled: boolean) {
  const request = useAuthenticatedApi();
  const [items, setItems] = useState<readonly SupportInquiry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [noticeError, setNoticeError] = useState(false);
  const hasLoadedRef = useRef(false);
  const requestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const requestId = ++requestIdRef.current;
      if (mode === 'refresh') {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setLoadError(null);
      setNoticeError(false);
      try {
        const page = await getSupportInquiries(request, { limit: SUPPORT_INQUIRY_PAGE_SIZE });
        if (requestId !== requestIdRef.current) {
          return;
        }
        hasLoadedRef.current = true;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      } catch (caught) {
        if (requestId !== requestIdRef.current) {
          return;
        }
        if (hasLoadedRef.current && itemsRef.current.length > 0) {
          setNoticeError(true);
        } else {
          setLoadError(caught);
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [request],
  );

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMoreRef.current || isLoading || isRefreshing) {
      return;
    }
    const requestId = requestIdRef.current;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    setNoticeError(false);
    try {
      const page = await getSupportInquiries(request, { cursor: nextCursor, limit: SUPPORT_INQUIRY_PAGE_SIZE });
      if (requestId !== requestIdRef.current) {
        return;
      }
      setItems(previous => {
        const seen = new Set(previous.map(entry => entry.inquiryId));
        return [...previous, ...page.items.filter(entry => !seen.has(entry.inquiryId))];
      });
      setNextCursor(page.nextCursor);
    } catch {
      if (requestId === requestIdRef.current) {
        setNoticeError(true);
      }
    } finally {
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [isLoading, isRefreshing, nextCursor, request]);

  // Loads the first time the tab is shown; after that it only refreshes when asked (pull, retry, a new inquiry).
  useEffect(() => {
    if (enabled && !hasLoadedRef.current && requestIdRef.current === 0) {
      load('initial').catch(() => undefined);
    }
  }, [enabled, load]);

  /** A just-created inquiry goes to the top at once (and the list is refreshed behind it). */
  const prepend = useCallback((inquiry: SupportInquiry) => {
    hasLoadedRef.current = true;
    setItems(previous => [inquiry, ...previous.filter(entry => entry.inquiryId !== inquiry.inquiryId)]);
  }, []);

  const refresh = useCallback(() => load(hasLoadedRef.current ? 'refresh' : 'initial'), [load]);

  return { items, isLoading, isRefreshing, isLoadingMore, loadError, noticeError, hasMore: nextCursor !== null, refresh, loadMore, prepend };
}
