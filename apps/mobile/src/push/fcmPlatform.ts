import { Platform } from 'react-native';

/**
 * Whether this platform's Push runs through Firebase Cloud Messaging. Only Android does (see
 * docs/architecture.md "Push 알림 전송"): iOS Push is planned as direct APNs, is not implemented yet,
 * and the iOS app has no Firebase app configured - any @react-native-firebase/messaging call there
 * throws "No Firebase App '[DEFAULT]' has been created". Every FCM call site checks this first, so
 * on iOS Push simply stays unregistered (never reported as registered) until APNs exists.
 */
export function isFcmPlatform(): boolean {
  return Platform.OS === 'android';
}
