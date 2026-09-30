import { useCallback, useEffect, useRef } from 'react';
import { getInitialNotification, getMessaging, onMessage, onNotificationOpenedApp } from '@react-native-firebase/messaging';
import { useAuth } from '../auth/AuthContext';
import { navigationRef } from '../navigation/navigationRef';
import { emitSocialPushEvent, parseSocialPushEvent } from './pushEvents';
import { consumePendingPushTarget, setPendingPushTarget } from './pendingPushTarget';
import { resolvePushTapNavigation, type PushTapPayload } from './pushNavigation';

/**
 * Wires FCM to the app, mounted once near the root: a message received in the foreground refreshes
 * whatever is on screen (see useLiveRefresh - Android shows no tray banner for it then), and a tap
 * from any state navigates to the right place. A tap that arrives before it is safe to navigate
 * (cold start, signed out, still bootstrapping) waits in pendingPushTarget until it is.
 */
export function usePushMessageHandling(): void {
  const { isAuthenticated, userBootstrapStatus } = useAuth();
  const isReady = isAuthenticated && userBootstrapStatus === 'ready';
  const isReadyRef = useRef(isReady);
  isReadyRef.current = isReady;

  const tryConsumePendingTarget = useCallback(() => {
    if (!isReadyRef.current || !navigationRef.isReady()) {
      return;
    }
    const target = resolvePushTapNavigation(consumePendingPushTarget());
    if (target?.screen === 'Friends') {
      navigationRef.navigate('Friends');
    } else if (target?.screen === 'CollectionShareRequests') {
      navigationRef.navigate('MainTabs', {
        screen: 'Collections',
        params: { filter: 'shared', openShareRequests: true, refreshToken: Date.now() },
      });
    } else if (target?.screen === 'CollectionDetails') {
      navigationRef.navigate('CollectionDetails', { collectionId: target.collectionId, refreshToken: Date.now() });
    }
  }, []);

  const handleTap = useCallback(
    (payload: PushTapPayload | null | undefined) => {
      if (!payload) {
        return;
      }
      setPendingPushTarget(payload);
      tryConsumePendingTarget();
    },
    [tryConsumePendingTarget],
  );

  useEffect(() => {
    tryConsumePendingTarget();
  }, [isReady, tryConsumePendingTarget]);

  useEffect(
    () =>
      onMessage(getMessaging(), remoteMessage => {
        const event = parseSocialPushEvent(remoteMessage?.data);
        if (event) {
          emitSocialPushEvent(event);
        }
      }),
    [],
  );

  useEffect(
    () => onNotificationOpenedApp(getMessaging(), remoteMessage => handleTap(remoteMessage?.data)),
    [handleTap],
  );

  // Cold start from a tap - one-shot by design.
  useEffect(() => {
    getInitialNotification(getMessaging())
      .then(remoteMessage => handleTap(remoteMessage?.data))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
