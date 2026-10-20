import { useEffect } from 'react';
import { AppState } from 'react-native';
import { getMessaging, onTokenRefresh } from '@react-native-firebase/messaging';
import { useAuth } from '../auth/AuthContext';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import i18n from '../i18n';
import { isFcmPlatform } from './fcmPlatform';
import { syncPushRegistration } from './pushRegistrationSync';
import { reportPushSync } from './pushRegistrationStatus';

/** Bootstrap, Settings return, language change and token rotation all reconcile actual OS state with server registration. */
export function usePushRegistrationSync(): void {
  const { isAuthenticated, userBootstrapStatus } = useAuth();
  const request = useAuthenticatedApi();
  const isReady = isAuthenticated && userBootstrapStatus === 'ready';
  useEffect(() => {
    if (!isReady) {
      reportPushSync('idle');
      return;
    }
    let current = true;
    let generation = 0;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async (reset = true) => {
      if (reset) attempts = 0;
      clearTimeout(timer);
      const ownGeneration = ++generation;
      const isCurrent = () => current && generation === ownGeneration;
      const status = await syncPushRegistration(request, isCurrent);
      if (!isCurrent()) return;
      if (
        ['tokenUnavailable', 'tokenFailed', 'registrationFailed'].includes(
          status,
        ) &&
        attempts < 3 &&
        AppState.currentState === 'active'
      ) {
        const delay = [15_000, 60_000, 180_000][attempts++];
        timer = setTimeout(() => {
          run(false).catch(() => reportPushSync('registrationFailed'));
        }, delay);
      }
    };
    run().catch(() => reportPushSync('registrationFailed'));
    const languageChanged = () => {
      run().catch(() => reportPushSync('registrationFailed'));
    };
    i18n.on('languageChanged', languageChanged);
    const foreground = AppState.addEventListener('change', state => {
      if (state === 'active')
        run().catch(() => reportPushSync('registrationFailed'));
    });
    let unsubscribe: () => void = () => undefined;
    try {
      if (isFcmPlatform())
        unsubscribe = onTokenRefresh(getMessaging(), () => {
          run().catch(() => reportPushSync('registrationFailed'));
        });
    } catch {
      reportPushSync('tokenFailed');
    }
    return () => {
      current = false;
      generation++;
      clearTimeout(timer);
      foreground.remove();
      i18n.off('languageChanged', languageChanged);
      unsubscribe();
    };
  }, [isReady, request]);
}
