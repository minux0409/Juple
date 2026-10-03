/**
 * What the in-app banner shows for a Push that arrived while Juple was in the foreground. Presentation
 * only - the notification itself is durable in the Inbox whether or not its banner was ever seen.
 */
export interface NotificationBanner {
  /** Unique per banner (the notification id, or the FCM message id of an older Push). */
  readonly key: string;
  readonly notificationId: number | null;
  /** The Push data "type" - picks the banner's icon. */
  readonly type: string | null;
  readonly title: string;
  readonly body: string;
  /** The Push data payload, for an older Push without notificationId (see openNotification). */
  readonly data: Readonly<Record<string, unknown>>;
}

/** At most this many waiting behind the one on screen - a burst never stacks up minutes of banners. */
export const BANNER_QUEUE_LIMIT = 5;
/** How many recent keys are remembered to ignore a replayed/duplicated Push - bounded, never persisted. */
export const BANNER_RECENT_KEY_LIMIT = 50;

type Listener = () => void;

export interface BannerQueue {
  /** False when it was a duplicate of a recent banner (nothing is shown again). */
  enqueue(banner: NotificationBanner): boolean;
  /** The banner on screen, if any. */
  current(): NotificationBanner | null;
  /** The banner on screen is gone (timeout, swipe, tap): the next one, if any, takes its place. */
  dismissCurrent(): void;
  /** Every banner still to be seen: the one on screen first, then those waiting. */
  all(): readonly NotificationBanner[];
  /**
   * That ONE notification's banner is withdrawn (the thing it announced no longer exists): the one on screen
   * is replaced by the next, or the waiting one is dropped. Nothing else is touched. False when none was there.
   */
  removeNotification(notificationId: number): boolean;
  /** Signed out: nothing more is shown. */
  clear(): void;
  pendingCount(): number;
  subscribe(listener: Listener): () => void;
}

/**
 * One banner at a time; later ones wait in a bounded FIFO. When it overflows, the OLDEST waiting
 * banner is dropped (the newest is the most relevant to what just happened). A key seen recently -
 * the same notification delivered twice, or replayed - is ignored.
 */
export function createBannerQueue(limit: number = BANNER_QUEUE_LIMIT, recentKeyLimit: number = BANNER_RECENT_KEY_LIMIT): BannerQueue {
  let shown: NotificationBanner | null = null;
  const waiting: NotificationBanner[] = [];
  const recentKeys: string[] = [];
  const listeners = new Set<Listener>();
  const emit = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    enqueue(banner) {
      if (recentKeys.includes(banner.key)) {
        return false;
      }
      recentKeys.push(banner.key);
      if (recentKeys.length > recentKeyLimit) {
        recentKeys.shift();
      }
      if (shown === null) {
        shown = banner;
      } else {
        waiting.push(banner);
        if (waiting.length > limit) {
          waiting.shift();
        }
      }
      emit();
      return true;
    },
    current: () => shown,
    all: () => (shown === null ? [] : [shown, ...waiting]),
    removeNotification(notificationId) {
      if (shown?.notificationId === notificationId) {
        shown = waiting.shift() ?? null;
        emit();
        return true;
      }
      const index = waiting.findIndex(banner => banner.notificationId === notificationId);
      if (index < 0) {
        return false;
      }
      waiting.splice(index, 1);
      emit();
      return true;
    },
    dismissCurrent() {
      if (shown === null) {
        return;
      }
      shown = waiting.shift() ?? null;
      emit();
    },
    clear() {
      shown = null;
      waiting.length = 0;
      emit();
    },
    pendingCount: () => waiting.length,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app's one queue (the FCM listener that fills it has no component of its own). */
export const notificationBannerQueue = createBannerQueue();

/**
 * A foreground Push as a banner - only one with visible text (data-only refresh messages never have
 * any). The text is the Push's own (already in the recipient's app language, never a comment's text).
 */
export function bannerFromRemoteMessage(message: {
  readonly messageId?: string;
  readonly notification?: { readonly title?: string; readonly body?: string } | null;
  readonly data?: Readonly<Record<string, unknown>> | null;
} | null | undefined): NotificationBanner | null {
  const title = message?.notification?.title?.trim();
  const body = message?.notification?.body?.trim();
  if (!title && !body) {
    return null;
  }
  const data = message?.data ?? {};
  const rawId = typeof data.notificationId === 'string' ? Number(data.notificationId) : NaN;
  const notificationId = Number.isSafeInteger(rawId) && rawId > 0 ? rawId : null;
  const key = notificationId !== null ? `n:${notificationId}` : message?.messageId ? `m:${message.messageId}` : null;
  if (key === null) {
    return null;
  }
  return {
    key,
    notificationId,
    type: typeof data.type === 'string' ? data.type : null,
    title: title ?? '',
    body: body ?? '',
    data,
  };
}
