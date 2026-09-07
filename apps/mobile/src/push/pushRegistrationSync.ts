import { getMessaging, getToken } from '@react-native-firebase/messaging';
import { Platform } from 'react-native';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import i18n from '../i18n';
import { getOrCreatePushInstallationId } from './pushInstallationId';
import { getPushPermissionStatus } from './pushPermission';
import { registerPushDevice, type PushPlatform } from './api/pushDevicesApi';

async function registerCurrentToken(
  authenticatedRequest: AuthenticatedApiRequest,
  pushToken: string,
): Promise<void> {
  const installationId = await getOrCreatePushInstallationId();
  const platform: PushPlatform = Platform.OS === 'android' ? 'android' : 'ios';
  await registerPushDevice(authenticatedRequest, {
    platform,
    installationId,
    pushToken,
    // The app's currently-resolved UI language (e.g. "ko"/"en" - see
    // i18n/languagePreference.ts), never the "system" preference string itself and never the raw
    // device OS locale - Push text must reflect what the user actually sees in the app (see
    // Backend's PushNotificationTextGenerator and RegisterPushDeviceService's own remarks on this
    // same field).
    locale: i18n.language,
  });
}

/**
 * Fetches the current FCM token and (re-)registers this installation with the Backend - a
 * no-op if notification permission is not currently granted (read-only check, never prompts; see
 * pushPermission.ts). Best-effort throughout: called from app bootstrap, a language change, and a
 * fresh permission grant (see usePushRegistrationSync.ts and RepeatPurchaseEditorScreen), none of
 * which may ever fail loudly because of this.
 */
export async function syncPushRegistrationIfPermitted(
  authenticatedRequest: AuthenticatedApiRequest,
): Promise<void> {
  try {
    const status = await getPushPermissionStatus();
    if (status !== 'granted') {
      return;
    }

    const pushToken = await getToken(getMessaging());
    if (!pushToken) {
      return;
    }

    await registerCurrentToken(authenticatedRequest, pushToken);
  } catch {
    // Best-effort - see this function's own doc comment. Push simply stays unregistered/stale
    // until the next successful sync (bootstrap, language change, token refresh, ...).
  }
}

/**
 * Re-registers an FCM token that just rotated (see messaging().onTokenRefresh in
 * usePushRegistrationSync.ts) - skipped if permission is no longer granted, so a token refresh
 * arriving after the user revoked notification permission from OS Settings never silently
 * re-enables Push server-side.
 */
export async function registerRefreshedPushToken(
  authenticatedRequest: AuthenticatedApiRequest,
  pushToken: string,
): Promise<void> {
  try {
    if (!pushToken) {
      return;
    }

    const status = await getPushPermissionStatus();
    if (status !== 'granted') {
      return;
    }

    await registerCurrentToken(authenticatedRequest, pushToken);
  } catch {
    // Best-effort - see syncPushRegistrationIfPermitted's own doc comment.
  }
}
