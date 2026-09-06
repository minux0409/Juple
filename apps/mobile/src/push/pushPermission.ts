import { PermissionsAndroid, Platform } from 'react-native';

export type PushPermissionStatus = 'granted' | 'denied' | 'unavailable';

/**
 * Android 13+ (API 33+) requires this exact runtime prompt before Push can ever be delivered -
 * this app's targetSdkVersion is 36 (see android/build.gradle), so it is never optional here. Below
 * API 33, the OS grants notification permission implicitly at install time - this resolves
 * 'granted' immediately without prompting, mirroring the OS's own behavior rather than asking for
 * something the OS never gates.
 *
 * iOS permission (UNUserNotificationCenter) has no React Native core equivalent and needs a native
 * module this stage does not add yet (see this feature's own iOS design notes - unverifiable
 * without Mac/Xcode) - resolves 'unavailable' there rather than silently pretending success.
 *
 * Declining must never break the in-app Notification Center - nothing in this module or its
 * callers gates any other feature on the result.
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
