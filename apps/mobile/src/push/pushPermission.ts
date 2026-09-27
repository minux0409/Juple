import { PermissionsAndroid, Platform } from 'react-native';

export type PushPermissionStatus = 'granted' | 'denied' | 'unavailable';

/**
 * Shows the Android 13+ (API 33+) runtime prompt - this app's targetSdkVersion is 36, so Push is
 * never delivered without it; below API 33 the OS grants it at install time. iOS has no React Native
 * core API for this (APNs is not implemented yet) - resolves 'unavailable' rather than pretending.
 * Only ever called through ensurePushPermissionOnce (pushPermissionFlow.ts); declining never gates
 * anything - in-app badges and refreshes work the same without Push.
 */
export async function requestPushPermission(): Promise<PushPermissionStatus> {
  if (Platform.OS !== 'android') {
    return 'unavailable';
  }

  if (Number(Platform.Version) < 33) {
    return 'granted';
  }

  try {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    return result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/** Read-only check - never prompts. Same platform/API-level fallbacks as requestPushPermission. */
export async function getPushPermissionStatus(): Promise<PushPermissionStatus> {
  if (Platform.OS !== 'android') {
    return 'unavailable';
  }

  if (Number(Platform.Version) < 33) {
    return 'granted';
  }

  try {
    const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    return granted ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}
