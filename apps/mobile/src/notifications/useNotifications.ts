import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getNotifications, type Notification } from './api/notificationsApi';

const PAGE_LIMIT = 50;

function getNotificationsErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'conflict') {
      return t('errors.accountNotReady');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('notifications.errorLoadFallback');
}

export interface UseNotificationsResult {
  readonly notifications: readonly Notification[];
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly isLoadingMore: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
  readonly loadMore: () => void;
  /** Applies a successful mark-read locally without a full refetch. */
  readonly markReadLocally: (notificationId: number) => void;
  /** Applies a successful mark-all-read locally without a full refetch. */
  readonly markAllReadLocally: () => void;
}

/** Loads and paginates the Notification Center list - mirrors useRecentlyOpenedLinks.ts's verified pattern. */
export function useNotifications(): UseNotificationsResult {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const [notifications, setNotifications] = useState<readonly Notification[]>([]);
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
        const page = await getNotifications(authenticatedRequest, { limit: PAGE_LIMIT });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setNotifications(page.notifications);
        setNextCursor(page.nextCursor);
      } catch (caughtError) {
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        // Failure keeps whatever is already shown - only the error text changes.
        setError(getNotificationsErrorMessage(caughtError, t));
      } finally {
        if (loadRequestIdRef.current === requestId) {
          hasLoadedOnceRef.current = true;
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [authenticatedRequest, t],
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
        const page = await getNotifications(authenticatedRequest, {
          limit: PAGE_LIMIT,
          cursor: nextCursor,
        });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setNotifications(previous => {
          const seenIds = new Set(previous.map(notification => notification.id));
          const additional = page.notifications.filter(notification => !seenIds.has(notification.id));
          return [...previous, ...additional];
        });
        setNextCursor(page.nextCursor);
      } catch (caughtError) {
        if (loadRequestIdRef.current === requestId) {
          setError(getNotificationsErrorMessage(caughtError, t));
        }
      } finally {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    })();
  }, [authenticatedRequest, nextCursor, isLoading, isRefreshing, t]);

  const markReadLocally = useCallback((notificationId: number) => {
    setNotifications(previous =>
      previous.map(notification =>
        notification.id === notificationId
          ? { ...notification, isRead: true, readAtUtc: notification.readAtUtc ?? new Date().toISOString() }
          : notification,
      ),
    );
  }, []);

  const markAllReadLocally = useCallback(() => {
    setNotifications(previous =>
      previous.map(notification =>
        notification.isRead
          ? notification
          : { ...notification, isRead: true, readAtUtc: notification.readAtUtc ?? new Date().toISOString() },
      ),
    );
  }, []);

  return {
    notifications,
    isLoading,
    isRefreshing,
    isLoadingMore,
    error,
    refresh,
    loadMore,
    markReadLocally,
    markAllReadLocally,
  };
}
