import { useCallback, useRef, useState } from 'react';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { ApiError } from '../api/ApiError';
import { deleteNotification, getNotifications, markAllNotificationsRead, NOTIFICATIONS_PAGE_SIZE, type AppNotification } from './notificationsApi';
import { refreshUnreadCount, setUnreadCount } from './notificationState';

export interface NotificationInboxState {
  readonly items: readonly AppNotification[];
  /** 'loading' only before the first page ever arrives; a failed first page is 'error' (full-screen retry). */
  readonly status: 'loading' | 'ready' | 'error';
  readonly isRefreshing: boolean;
  readonly isLoadingMore: boolean;
  /** A next page failed - the rows already shown stay; the footer offers a retry. */
  readonly loadMoreFailed: boolean;
  readonly hasMore: boolean;
  readonly hasUnread: boolean;
}

/**
 * The Notifications screen's list: the first page (30), then older pages appended on demand, by the
 * server's keyset cursor - never an offset, and an id already shown is never added twice. A newer
 * load always wins over an older response. Read state is applied locally at once (a tap, 모두 읽음)
 * and reconciled with the server's count; a failed read-all reloads instead of guessing.
 */
export function useNotificationInbox(request: AuthenticatedApiRequest, locale: string) {
  const [items, setItems] = useState<readonly AppNotification[]>([]);
  const [status, setStatus] = useState<NotificationInboxState['status']>('loading');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  /** The first page again - 'refresh' keeps what is shown until it lands (pull-to-refresh, a new Push, coming back). */
  const reload = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const requestId = ++requestIdRef.current;
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
      if (mode === 'refresh' && statusRef.current === 'ready') {
        setIsRefreshing(true);
      } else {
        setStatus('loading');
      }
      try {
        const page = await getNotifications(request, { limit: NOTIFICATIONS_PAGE_SIZE, locale });
        if (requestId !== requestIdRef.current) {
          return;
        }
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setLoadMoreFailed(false);
        setStatus('ready');
        setUnreadCount(page.unreadCount);
      } catch {
        if (requestId === requestIdRef.current && statusRef.current !== 'ready') {
          setStatus('error');
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setIsRefreshing(false);
        }
      }
    },
    [locale, request],
  );

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || nextCursor === null || statusRef.current !== 'ready') {
      return;
    }
    loadingMoreRef.current = true;
    const requestId = requestIdRef.current;
    setIsLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const page = await getNotifications(request, { cursor: nextCursor, limit: NOTIFICATIONS_PAGE_SIZE, locale });
      if (requestId !== requestIdRef.current) {
        return;
      }
      setItems(previous => {
        const seen = new Set(previous.map(item => item.id));
        return [...previous, ...page.items.filter(item => !seen.has(item.id))];
      });
      setNextCursor(page.nextCursor);
      setUnreadCount(page.unreadCount);
    } catch {
      if (requestId === requestIdRef.current) {
        setLoadMoreFailed(true);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    }
  }, [locale, nextCursor, request]);

  /** A row was tapped: shown as read at once (the server read and the bell are openNotification's). */
  const markRowRead = useCallback((notificationId: number) => {
    const nowUtc = new Date().toISOString();
    setItems(previous => previous.map(item => (item.id === notificationId && item.readAtUtc === null ? { ...item, readAtUtc: nowUtc } : item)));
  }, []);

  /**
   * Swipe-delete: the row leaves at once; a failure other than "already gone" puts the truth back
   * (a re-read) and is reported to the caller, so a row never silently reappears or stays wrong.
   */
  const removeRow = useCallback(
    async (notificationId: number): Promise<boolean> => {
      setItems(previous => previous.filter(item => item.id !== notificationId));
      try {
        const result = await deleteNotification(request, notificationId);
        setUnreadCount(result.unreadCount);
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.kind === 'notFound') {
          refreshUnreadCount(request).catch(() => undefined);
          return true;
        }
        reload('refresh').catch(() => undefined);
        return false;
      }
    },
    [reload, request],
  );

  /** 모두 읽음: every row and the bell at once; on failure the truth is re-read instead of kept wrong. */
  const markAllRead = useCallback(async () => {
    const nowUtc = new Date().toISOString();
    setItems(previous => previous.map(item => (item.readAtUtc === null ? { ...item, readAtUtc: nowUtc } : item)));
    setUnreadCount(0);
    try {
      const result = await markAllNotificationsRead(request);
      setUnreadCount(result.unreadCount);
    } catch {
      reload('refresh').catch(() => undefined);
      refreshUnreadCount(request).catch(() => undefined);
    }
  }, [reload, request]);

  const state: NotificationInboxState = {
    items,
    status,
    isRefreshing,
    isLoadingMore,
    loadMoreFailed,
    hasMore: nextCursor !== null,
    hasUnread: items.some(item => item.readAtUtc === null),
  };

  return { state, reload, loadMore, markRowRead, markAllRead, removeRow };
}
