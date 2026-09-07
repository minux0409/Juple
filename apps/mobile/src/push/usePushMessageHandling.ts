import { useCallback, useEffect, useRef } from 'react';
import { getInitialNotification, getMessaging, onMessage, onNotificationOpenedApp } from '@react-native-firebase/messaging';
import { useAuth } from '../auth/AuthContext';
import { useNotificationBadge } from '../notifications/NotificationBadgeContext';
import { navigationRef } from '../navigation/navigationRef';
import { consumePendingPushTarget, setPendingPushTarget } from './pendingPushTarget';
import { resolvePushTapNavigation, type PushTapPayload } from './pushNavigation';

/**
 * Wires actual FCM message/tap handling to the app - foreground receipt, and a tap from any app
 * state (foreground/background/cold start). Mounted once, near the app root alongside
 * usePushRegistrationSync (see App.tsx), for as long as the app is running - unlike
 * usePushRegistrationSync this does not gate on isReady, since a tap can legitimately arrive while
 * signed out (see the isReady effect below, which is what actually gates navigating).
 */
export function usePushMessageHandling(): void {
  const { isAuthenticated, userBootstrapStatus } = useAuth();
  const { refresh } = useNotificationBadge();
  const isReady = isAuthenticated && userBootstrapStatus === 'ready';
  const isReadyRef = useRef(isReady);
  isReadyRef.current = isReady;

  // Consumes whatever is pending the moment both the nav container has mounted AND the user is
  // actually authenticated/bootstrapped - RootStack only registers RepeatPurchaseDetails/
  // Notifications while isReady, so navigating any earlier (e.g. while SignIn/AuthPending is the
  // only registered screen) would fail. Safe to call speculatively any time; a no-op when nothing
  // is pending or when not yet actually ready.
  const tryConsumePendingTarget = useCallback(() => {
    if (!isReadyRef.current || !navigationRef.isReady()) {
      return;
    }

    const payload = consumePendingPushTarget();
    const target = resolvePushTapNavigation(payload);
    if (!target) {
      return;
    }

    if (target.screen === 'RepeatPurchaseDetails') {
      navigationRef.navigate('RepeatPurchaseDetails', target.params);
    } else {
      navigationRef.navigate('Notifications');
    }
  }, []);

  const handleTap = useCallback(
    (payload: PushTapPayload | null) => {
      if (!payload) {
        return;
      }
      setPendingPushTarget(payload);
      tryConsumePendingTarget();
    },
    [tryConsumePendingTarget],
  );

  // Covers: cold-start-before-ready, and logged-out-tap-then-later-signs-in - both leave a payload
  // pending until this fires with isReady actually true.
  useEffect(() => {
    tryConsumePendingTarget();
  }, [isReady, tryConsumePendingTarget]);

  // Foreground: FCM does not show a system-tray banner for a message with a `notification` block
  // while the app is foregrounded (Android's own documented behavior, not a bug here) - refreshing
  // the in-app Notification Center/badge is what this app relies on instead (see
  // PushNotificationPayload/DispatchDuePushNotificationsService on the Backend, which always
  // includes a `notification` block, so background/terminated delivery still gets a real system
  // tray notification with zero extra Mobile code - see index.js's own remarks).
  useEffect(() => {
    const unsubscribe = onMessage(getMessaging(), () => {
      refresh();
    });
    return unsubscribe;
  }, [refresh]);

  // Tapped while backgrounded (not killed).
  useEffect(() => {
    const unsubscribe = onNotificationOpenedApp(getMessaging(), remoteMessage => {
      handleTap((remoteMessage?.data as PushTapPayload | undefined) ?? null);
    });
    return unsubscribe;
  }, [handleTap]);

  // Cold start: the app was launched by tapping a notification. One-shot by design (mirrors
  // getInitialNotification's own semantics), so this intentionally only ever runs once at mount.
  useEffect(() => {
    getInitialNotification(getMessaging()).then(remoteMessage => {
      handleTap((remoteMessage?.data as PushTapPayload | undefined) ?? null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
