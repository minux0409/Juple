import type { CodegenTypes, TurboModule } from 'react-native';
import { Platform, TurboModuleRegistry } from 'react-native';

/**
 * iOS-only (null elsewhere; the "IOS" name suffix keeps it out of Android codegen): Apple Push (APNs) for the app - see
 * ios/JupleMobile/ApnsBridge.swift and docs/ios-apns-push.md. Android keeps Firebase Cloud Messaging.
 */

export interface ApnsRegistration {
  /** The APNs device token as hex, or null when none could be obtained. Never log it. */
  readonly token: string | null;
  /** "development" or "production": the aps-environment of the provisioning profile the app is signed with. */
  readonly environment: string;
  /** "registrationFailed" / "timeout" when there is no token. */
  readonly failure: string | null;
}

export interface Spec extends TurboModule {
  /** Asks iOS for the device token (registerForRemoteNotifications). Resolves once; never rejects. */
  registerForRemoteNotifications(): Promise<ApnsRegistration>;
  /** The tap that launched the app (JSON of `{ notification, data }`), taken once; null when there is none. */
  consumeInitialNotification(): Promise<string | null>;
  /** iOS handed out a different device token than before in this run (payload always ""). */
  readonly onTokenChanged: CodegenTypes.EventEmitter<string>;
  /** A notification arrived while the app is in front (JSON of `{ notification, data }`); iOS shows no banner for it. */
  readonly onForegroundNotification: CodegenTypes.EventEmitter<string>;
  /** The user tapped a notification while JS was running (JSON of `{ notification, data }`). */
  readonly onNotificationOpened: CodegenTypes.EventEmitter<string>;
}

const nativeApnsIOS = Platform.OS === 'ios' ? TurboModuleRegistry.get<Spec>('NativeApnsIOS') : null;

export default nativeApnsIOS;
