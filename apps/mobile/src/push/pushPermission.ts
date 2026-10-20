import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

export type PushPermissionStatus =
  | 'granted'
  | 'denied'
  | 'notDetermined'
  | 'unavailable';
interface NotificationPermissionsBridge {
  getStatus(): Promise<string>;
  request?(): Promise<string>;
}
const statusOf = (value: string): PushPermissionStatus =>
  value === 'granted' || value === 'denied' || value === 'notDetermined'
    ? value
    : 'unavailable';

/** Reads OS state, including Android's Settings switch and iOS provisional authorization. */
export async function getPushPermissionStatus(): Promise<PushPermissionStatus> {
  try {
    const native = NativeModules.JupleNotificationPermissions as
      | NotificationPermissionsBridge
      | undefined;
    if (native) return statusOf(await native.getStatus());
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      return (await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      ))
        ? 'granted'
        : 'denied';
    }
  } catch {
    /* missing OS information is different from a denial */
  }
  return 'unavailable';
}

/** Explicit consent only. An existing grant never triggers another system prompt. */
export async function requestPushPermission(): Promise<PushPermissionStatus> {
  const before = await getPushPermissionStatus();
  if (before === 'granted') return before;
  try {
    if (Platform.OS === 'android') {
      if (Number(Platform.Version) < 33) return before;
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      return result === PermissionsAndroid.RESULTS.GRANTED
        ? getPushPermissionStatus()
        : 'denied';
    }
    const native = NativeModules.JupleNotificationPermissions as
      | NotificationPermissionsBridge
      | undefined;
    if (Platform.OS === 'ios' && native?.request)
      return statusOf(await native.request());
  } catch {
    /* fail open for app use, never claim a grant */
  }
  return 'unavailable';
}
