import { Platform } from 'react-native';

/**
 * Whether this platform's Push runs through Firebase Cloud Messaging. Only Android does (see
 * docs/architecture.md "Push 알림 전송"): iOS uses direct APNs (apnsPush.ts, docs/ios-apns-push.md),
 * and the iOS app has no Firebase app configured - any @react-native-firebase/messaging call there
 * throws "No Firebase App '[DEFAULT]' has been created". Every FCM call site checks this first.
 */
export function isFcmPlatform(): boolean {
  return Platform.OS === 'android';
}
