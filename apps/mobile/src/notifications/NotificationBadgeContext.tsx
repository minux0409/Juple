import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getUnreadNotificationCount } from './api/notificationsApi';

interface NotificationBadgeContextValue {
  readonly unreadCount: number;
  /** Best-effort - a failed refresh silently leaves the last-known count on screen, never an error UI. */
  readonly refresh: () => void;
}

const NotificationBadgeContext = createContext<NotificationBadgeContextValue | undefined>(undefined);

/**
 * Tracks the Notification Center's unread badge count app-wide - a single shared fetch rather than
 * every NotificationBellButton instance (one per main tab screen) polling independently. The
 * Backend materializes newly-due RepeatPurchase notifications as a side effect of this same
 * GET /unread-count call (see NotificationsController), so simply refreshing here is what keeps the
 * badge caught up - no separate "materialize" call ever needed from Mobile.
 *
 * Refreshes on: userBootstrapStatus reaching 'ready' (mirrors DailyInboxScreen's own
 * AppState-foreground-refetch precedent for the "just came back to the app" case, extended here to
 * also cover "just finished signing in"), and the app returning from background/inactive to active
 * (same AppState pattern DailyInboxScreen already uses, not a new convention). Screens that change
 * server-side read state themselves (NotificationsScreen after read/read-all, RepeatPurchase
 * enable/disable/delete/log-purchase) call refresh() explicitly afterward via useNotificationBadge().
 */
export function NotificationBadgeProvider({ children }: PropsWithChildren) {
  const { isAuthenticated, userBootstrapStatus } = useAuth();
  const authenticatedRequest = useAuthenticatedApi();
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshRequestIdRef = useRef(0);

  const refresh = useCallback(() => {
    if (!isAuthenticated) {
      return;
    }

    const requestId = ++refreshRequestIdRef.current;
    (async () => {
      try {
        const count = await getUnreadNotificationCount(authenticatedRequest);
        if (refreshRequestIdRef.current === requestId) {
          setUnreadCount(count);
        }
      } catch {
        // Best-effort - see this provider's own doc comment. The badge simply keeps whatever count
        // it last successfully loaded.
      }
    })();
  }, [authenticatedRequest, isAuthenticated]);

  useEffect(() => {
    if (userBootstrapStatus === 'ready') {
      refresh();
    }
  }, [userBootstrapStatus, refresh]);

  useEffect(() => {
    if (!isAuthenticated) {
      setUnreadCount(0);
    }
  }, [isAuthenticated]);

  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appStateRef.current?.match(/inactive|background/) && nextAppState === 'active') {
        refresh();
      }
      appStateRef.current = nextAppState;
    });

    return () => subscription.remove();
  }, [refresh]);

  const value = useMemo<NotificationBadgeContextValue>(
    () => ({ unreadCount, refresh }),
    [unreadCount, refresh],
  );

  return (
    <NotificationBadgeContext.Provider value={value}>{children}</NotificationBadgeContext.Provider>
  );
}

export function useNotificationBadge(): NotificationBadgeContextValue {
  const context = useContext(NotificationBadgeContext);
  if (!context) {
    throw new Error('useNotificationBadge must be used within a NotificationBadgeProvider.');
  }
  return context;
}
