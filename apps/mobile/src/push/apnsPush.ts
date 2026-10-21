import NativeApnsIOS from '../share/specs/NativeApnsIOS';

/** A received or tapped notification, in the same shape as an Android FCM message so banners and taps share one path. */
export interface PushMessage {
  readonly messageId?: string;
  readonly notification?: { readonly title?: string; readonly body?: string } | null;
  readonly data?: Readonly<Record<string, unknown>>;
}

export type ApnsEnvironment = 'development' | 'production';

export interface ApnsTokenResult {
  readonly token: string | null;
  readonly environment: ApnsEnvironment;
  readonly failed: boolean;
}

/** iOS with the native APNs module present. Android uses FCM (see fcmPlatform.ts). */
export function isApnsPlatform(): boolean {
  return NativeApnsIOS !== null;
}

/** The current APNs device token and the environment it belongs to; null where APNs is not available. Never log the token. */
export async function getApnsToken(): Promise<ApnsTokenResult | null> {
  if (!NativeApnsIOS) {
    return null;
  }
  const result = await NativeApnsIOS.registerForRemoteNotifications();
  return {
    token: typeof result.token === 'string' && result.token.length > 0 ? result.token : null,
    environment: result.environment === 'development' ? 'development' : 'production',
    failed: result.failure !== null,
  };
}

/** Parses the native `{ notification, data }` JSON; anything malformed is null (never thrown). */
export function parseApnsMessage(json: string | null | undefined): PushMessage | null {
  if (!json) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const { notification, data } = parsed as { notification?: unknown; data?: unknown };
    const strings: Record<string, string> = {};
    if (typeof data === 'object' && data !== null) {
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string') {
          strings[key] = value;
        }
      }
    }
    const alert = typeof notification === 'object' && notification !== null ? (notification as { title?: unknown; body?: unknown }) : null;
    return {
      notification: alert ? { title: typeof alert.title === 'string' ? alert.title : undefined, body: typeof alert.body === 'string' ? alert.body : undefined } : null,
      data: strings,
    };
  } catch {
    return null;
  }
}

/** iOS handed out a new device token: re-register. Returns the unsubscribe. */
export function subscribeApnsTokenChanged(listener: () => void): () => void {
  if (!NativeApnsIOS) {
    return () => undefined;
  }
  const subscription = NativeApnsIOS.onTokenChanged(() => listener());
  return () => subscription.remove();
}

/** A notification while the app is in front (iOS shows no system banner for it). */
export function subscribeApnsForegroundMessages(listener: (message: PushMessage) => void): () => void {
  if (!NativeApnsIOS) {
    return () => undefined;
  }
  const subscription = NativeApnsIOS.onForegroundNotification(json => {
    const message = parseApnsMessage(json);
    if (message) {
      listener(message);
    }
  });
  return () => subscription.remove();
}

/** A notification tapped while JS is running. */
export function subscribeApnsOpenedMessages(listener: (message: PushMessage) => void): () => void {
  if (!NativeApnsIOS) {
    return () => undefined;
  }
  const subscription = NativeApnsIOS.onNotificationOpened(json => {
    const message = parseApnsMessage(json);
    if (message) {
      listener(message);
    }
  });
  return () => subscription.remove();
}

/** The tap that launched the app, taken once. */
export async function consumeInitialApnsMessage(): Promise<PushMessage | null> {
  if (!NativeApnsIOS) {
    return null;
  }
  return parseApnsMessage(await NativeApnsIOS.consumeInitialNotification());
}
