import { getMessaging, getToken } from '@react-native-firebase/messaging';
import { Platform } from 'react-native';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import i18n from '../i18n';
import { getApnsToken, isApnsPlatform, type ApnsEnvironment } from './apnsPush';
import { isFcmPlatform } from './fcmPlatform';
import { getOrCreatePushInstallationId } from './pushInstallationId';
import { getPushPermissionStatus } from './pushPermission';
import { registerPushDevice, type PushPlatform } from './api/pushDevicesApi';
import { reportPushSync, type PushSyncStatus } from './pushRegistrationStatus';
import {
  pushRegistrationEpoch,
  serializePushMutation,
} from './pushMutationQueue';

async function registerCurrentToken(
  authenticatedRequest: AuthenticatedApiRequest,
  pushToken: string,
  isCurrent: () => boolean = () => true,
  apnsEnvironment?: ApnsEnvironment,
): Promise<void> {
  const installationId = await getOrCreatePushInstallationId();
  if (!isCurrent()) return;
  const platform: PushPlatform = Platform.OS === 'android' ? 'android' : 'ios';
  await serializePushMutation(async () => {
    if (!isCurrent()) return;
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
      apnsEnvironment,
    });
  });
}

/**
 * Fetches the current push token (Android FCM, iOS APNs) and (re-)registers this installation with the Backend - a
 * no-op if notification permission is not currently granted (read-only check, never prompts; see
 * pushPermission.ts). Consent is requested explicitly in PermissionsScreen. Best-effort throughout:
 * called from app bootstrap, a language change, and a token
 * refresh (see usePushRegistrationSync.ts), none of which may ever fail loudly because of this.
 */
export async function syncPushRegistrationIfPermitted(
  authenticatedRequest: AuthenticatedApiRequest,
): Promise<void> {
  await syncPushRegistration(authenticatedRequest);
}

/** A grant, a token and a confirmed server registration are separate states. */
export async function syncPushRegistration(
  authenticatedRequest: AuthenticatedApiRequest,
  isCurrent: () => boolean = () => true,
): Promise<PushSyncStatus> {
  const epoch = pushRegistrationEpoch();
  const callerCurrent = isCurrent;
  isCurrent = () => callerCurrent() && epoch === pushRegistrationEpoch();
  // Android: FCM. iOS: APNs through the native module (docs/ios-apns-push.md); without it there is nothing to register.
  if (!isFcmPlatform() && !isApnsPlatform())
    return isCurrent() ? reportPushSync('apnsNotReady') : 'cancelled';
  let permission;
  try {
    permission = await getPushPermissionStatus();
  } catch {
    permission = 'unavailable';
  }
  if (!isCurrent()) return 'cancelled';
  if (permission !== 'granted')
    return reportPushSync(
      permission === 'unavailable'
        ? 'permissionUnavailable'
        : 'permissionDenied',
    );
  let token;
  let apnsEnvironment: ApnsEnvironment | undefined;
  try {
    if (isFcmPlatform()) {
      token = await getToken(getMessaging());
    } else {
      const apns = await getApnsToken();
      if (apns?.failed) return isCurrent() ? reportPushSync('tokenFailed') : 'cancelled';
      token = apns?.token ?? null;
      apnsEnvironment = apns?.environment;
    }
  } catch {
    return isCurrent() ? reportPushSync('tokenFailed') : 'cancelled';
  }
  if (!isCurrent()) return 'cancelled';
  if (!token) return reportPushSync('tokenUnavailable');
  try {
    await registerCurrentToken(authenticatedRequest, token, isCurrent, apnsEnvironment);
    return isCurrent() ? reportPushSync('registered') : 'cancelled';
  } catch (error) {
    const httpStatus =
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof error.status === 'number'
        ? error.status
        : undefined;
    return isCurrent()
      ? reportPushSync('registrationFailed', httpStatus,
        httpStatus === 429 && typeof error === 'object' && error !== null && 'retryAfterSeconds' in error
          && typeof error.retryAfterSeconds === 'number' ? error.retryAfterSeconds : undefined)
      : 'cancelled';
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
  const epoch = pushRegistrationEpoch();
  const isCurrent = () => epoch === pushRegistrationEpoch();
  try {
    if (!isFcmPlatform() || !pushToken) {
      return;
    }

    const status = await getPushPermissionStatus();
    if (status !== 'granted') {
      return;
    }

    await registerCurrentToken(authenticatedRequest, pushToken, isCurrent);
    if (isCurrent()) reportPushSync('registered');
  } catch {
    if (isCurrent()) reportPushSync('registrationFailed');
  }
}
