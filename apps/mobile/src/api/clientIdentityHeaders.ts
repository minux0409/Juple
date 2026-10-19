import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';

/**
 * Which app is calling: the platform and its own build number (Android versionCode / iOS CFBundleVersion). The backend uses them
 * only for daily active-user analytics (docs/analytics.md) - never for access - and accepts only android / ios and a short build
 * string. Nothing about the person or the device (no device id, model, IP or location) is sent.
 */
export function clientIdentityHeaders(): Readonly<Record<string, string>> {
  const headers: Record<string, string> = { 'X-Juple-Platform': Platform.OS === 'ios' ? 'ios' : 'android' };
  const build = DeviceInfo.getBuildNumber();
  if (build) {
    headers['X-Juple-App-Build'] = build;
  }
  return headers;
}
