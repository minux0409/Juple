import { useEffect } from 'react';
import { getMessaging, onTokenRefresh } from '@react-native-firebase/messaging';
import { useAuth } from '../auth/AuthContext';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import i18n from '../i18n';
import { registerRefreshedPushToken, syncPushRegistrationIfPermitted } from './pushRegistrationSync';

/**
 * Keeps this installation's Push registration current for as long as the user stays signed in and
 * bootstrapped - see the three effects below. Mounted once, near the app root (see App.tsx); does
 * nothing (and subscribes to nothing) while signed out or not yet bootstrapped, matching this
 * feature's "authenticated AND userBootstrap ready AND permission granted" gate throughout.
 */
export function usePushRegistrationSync(): void {
  const { isAuthenticated, userBootstrapStatus } = useAuth();
  const authenticatedRequest = useAuthenticatedApi();
  const isReady = isAuthenticated && userBootstrapStatus === 'ready';

  // Bootstrap: a user who already has notification permission granted (see pushPermission.ts -
  // no active feature currently prompts for it) gets re-synced with no prompt of its own here.
  useEffect(() => {
    if (!isReady) {
      return;
    }
    syncPushRegistrationIfPermitted(authenticatedRequest);
  }, [isReady, authenticatedRequest]);

  // Language change: re-sync so PushDeviceRegistration.Locale always matches what the user
  // actually sees (see LanguageSettingsScreen / i18n/languagePreference.ts). i18next only fires
  // this when the resolved language actually changes, so re-selecting the same language is a
  // no-op here. syncPushRegistrationIfPermitted itself no-ops when permission/token are unavailable.
  useEffect(() => {
    if (!isReady) {
      return;
    }

    const handleLanguageChanged = () => {
      syncPushRegistrationIfPermitted(authenticatedRequest);
    };
    i18n.on('languageChanged', handleLanguageChanged);
    return () => {
      i18n.off('languageChanged', handleLanguageChanged);
    };
  }, [isReady, authenticatedRequest]);

  // Token refresh: FCM tokens can rotate at any time over the install's lifetime - re-register
  // with the same InstallationId (see PushDeviceRegistration.Reregister on the Backend) whenever
  // that happens.
  useEffect(() => {
    if (!isReady) {
      return;
    }

    const unsubscribe = onTokenRefresh(getMessaging(), (newToken: string) =>
      registerRefreshedPushToken(authenticatedRequest, newToken),
    );
    return unsubscribe;
  }, [isReady, authenticatedRequest]);
}
