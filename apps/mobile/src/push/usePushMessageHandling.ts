import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useTranslation } from 'react-i18next';
import { getInitialNotification, getMessaging, onMessage, onNotificationOpenedApp } from '@react-native-firebase/messaging';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAuth } from '../auth/AuthContext';
import { navigationRef } from '../navigation/navigationRef';
import { bannerFromRemoteMessage, notificationBannerQueue } from '../notifications/bannerQueue';
import { refreshUnreadCount, resetNotificationState } from '../notifications/notificationState';
import { notificationIdOf } from '../notifications/notificationTarget';
import { openNotification } from '../notifications/openNotification';
import { emitSocialPushEvent, parseSocialPushEvent } from './pushEvents';
import { consumePendingPushTarget, setPendingPushTarget } from './pendingPushTarget';

/** A tapped Push's data payload as it arrives (untyped, possibly stale or malformed). */
export type PushTapPayload = Readonly<Record<string, unknown>>;

/** How many recent taps are remembered so one tap reported twice (initial + opened) opens once. */
const RECENT_TAP_LIMIT = 20;

/**
 * The signed-in screens exist (RootStack renders them only after auth + bootstrap, and a moment
 * later) - navigationRef.isReady() alone only means the container mounted.
 */
function isSignedInNavigatorReady(): boolean {
  return navigationRef.isReady() && (navigationRef.getRootState()?.routeNames ?? []).includes('CollectionDetails');
}

/**
 * Wires FCM to the app, mounted once near the root:
 *  - a Push received in the foreground refreshes what is on screen (see useLiveRefresh), re-reads the
 *    bell's count and - when it has visible text - shows the in-app banner (the OS shows nothing for
 *    it then: Android hands a foreground message to onMessage only, and iOS presents nothing because
 *    no foreground presentation options are configured - so the person never sees both);
 *  - a tap from any state (foreground, background, terminated) opens it through openNotification,
 *    the same path as the banner and the Inbox. A tap that arrives before it is safe to navigate
 *    (cold start, still bootstrapping, signed out) waits in pendingPushTarget and runs once - after
 *    sign-in too; the lookup then drops it if it belongs to a different account.
 */
export function usePushMessageHandling(): void {
  const { isAuthenticated, userBootstrapStatus } = useAuth();
  const { i18n } = useTranslation();
  const request = useAuthenticatedApi();
  const isReady = isAuthenticated && userBootstrapStatus === 'ready';
  const isReadyRef = useRef(isReady);
  isReadyRef.current = isReady;
  const localeRef = useRef(i18n.language);
  localeRef.current = i18n.language;
  const recentTapsRef = useRef<string[]>([]);

  const tryConsumePendingTarget = useCallback(() => {
    if (!isReadyRef.current || !isSignedInNavigatorReady()) {
      return;
    }
    const payload = consumePendingPushTarget();
    if (!payload) {
      return;
    }
    openNotification(
      { notificationId: notificationIdOf(payload), legacyData: payload },
      { request, locale: localeRef.current },
    ).catch(() => undefined);
  }, [request]);

  const handleTap = useCallback(
    (remoteMessage: { readonly messageId?: string; readonly data?: PushTapPayload } | null | undefined) => {
      const payload = remoteMessage?.data;
      if (!payload) {
        return;
      }
      const notificationId = notificationIdOf(payload);
      const key = notificationId !== null ? `n:${notificationId}` : remoteMessage?.messageId ? `m:${remoteMessage.messageId}` : null;
      if (key !== null) {
        if (recentTapsRef.current.includes(key)) {
          return;
        }
        recentTapsRef.current = [...recentTapsRef.current, key].slice(-RECENT_TAP_LIMIT);
      }
      setPendingPushTarget(payload);
      tryConsumePendingTarget();
    },
    [tryConsumePendingTarget],
  );

  // Signed in: the bell's count; signed out: nobody's count and no leftover banners.
  useEffect(() => {
    if (isReady) {
      refreshUnreadCount(request).catch(() => undefined);
    } else {
      resetNotificationState();
      notificationBannerQueue.clear();
    }
    tryConsumePendingTarget();
  }, [isReady, request, tryConsumePendingTarget]);

  // The signed-in screens appear a moment after isReady (see RootStack) - retry then.
  useEffect(() => navigationRef.addListener('state', tryConsumePendingTarget), [tryConsumePendingTarget]);

  // Back in the foreground: only the cheap count, never the list.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && isReadyRef.current) {
        refreshUnreadCount(request).catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [request]);

  useEffect(
    () =>
      onMessage(getMessaging(), remoteMessage => {
        const event = parseSocialPushEvent(remoteMessage?.data);
        if (event) {
          emitSocialPushEvent(event);
        }
        if (!isReadyRef.current) {
          return;
        }
        const banner = bannerFromRemoteMessage(remoteMessage);
        if (banner) {
          notificationBannerQueue.enqueue(banner);
          refreshUnreadCount(request).catch(() => undefined);
        }
      }),
    [request],
  );

  useEffect(() => onNotificationOpenedApp(getMessaging(), handleTap), [handleTap]);

  // Cold start from a tap - one-shot by design.
  useEffect(() => {
    getInitialNotification(getMessaging())
      .then(handleTap)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
