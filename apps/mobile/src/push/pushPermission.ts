import { PermissionsAndroid, Platform } from 'react-native';

export type PushPermissionStatus = 'granted' | 'denied' | 'unavailable';

/**
 * Read-only check - never prompts (no active feature currently triggers the OS runtime prompt
 * itself; see pushRegistrationSync.ts's own remarks). Android 13+ (API 33+) gates Push delivery on
 * this exact runtime permission - this app's targetSdkVersion is 36 (see android/build.gradle), so
 * it is never optional here. Below API 33, the OS grants notification permission implicitly at
 * install time - this resolves 'granted' immediately, mirroring the OS's own behavior.
 *
 * iOS permission (UNUserNotificationCenter) has no React Native core equivalent and needs a native
 * module this stage does not add yet (unverifiable without Mac/Xcode) - resolves 'unavailable'
 * there rather than silently pretending success.
 */
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
