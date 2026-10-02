import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { navigationRef } from '../navigation/navigationRef';
import { getNotification, markNotificationRead } from './notificationsApi';
import { adjustUnreadCount, refreshUnreadCount, setUnreadCount } from './notificationState';
import {
  legacyPushTarget,
  navigationActionFor,
  parseNotificationTarget,
  type NotificationNavigationAction,
  type NotificationTarget,
} from './notificationTarget';

export interface OpenNotificationInput {
  /** The canonical reference (a Round 34+ Push, the banner, an Inbox row); null for an older Push. */
  readonly notificationId: number | null;
  /** Already known (an Inbox row) - otherwise it is looked up by notificationId. */
  readonly target?: NotificationTarget | null;
  /** The row is known to be unread - the bell drops by one at once instead of after the server answers. */
  readonly knownUnread?: boolean;
  /** The Push data payload: what an older Push (or a failed lookup) still routes by. */
  readonly legacyData?: Readonly<Record<string, unknown>> | null;
}

export interface OpenNotificationDeps {
  readonly request: AuthenticatedApiRequest;
  /** The app language - the lookup's wording is not shown here, but stays consistent with the Inbox. */
  readonly locale: string;
  readonly navigate?: (action: NotificationNavigationAction) => void;
  readonly onUnavailable?: () => void;
}

/**
 * 'discarded': not the signed-in user's notification (another account's Push on this device) or an
 * older Push with nothing to open - nothing happens and nothing about it is shown.
 */
export type OpenNotificationOutcome = 'navigated' | 'unavailable' | 'discarded';

type UnavailableListener = () => void;
const unavailableListeners = new Set<UnavailableListener>();

/** The shared "이 알림의 항목을 더 이상 볼 수 없어요." notice (rendered by NotificationBannerHost). */
export function showNotificationUnavailable(): void {
  for (const listener of [...unavailableListeners]) {
    listener();
  }
}

export function subscribeNotificationUnavailable(listener: UnavailableListener): () => void {
  unavailableListeners.add(listener);
  return () => {
    unavailableListeners.delete(listener);
  };
}

/** Performs one navigation action on the root navigator - the only place the actions become navigate() calls. */
export function navigateWithRootNavigator(action: NotificationNavigationAction): void {
  switch (action.name) {
    case 'Friends':
      navigationRef.navigate('Friends');
      return;
    case 'MainTabs':
      navigationRef.navigate('MainTabs', action.params);
      return;
    case 'CollectionDetails':
      navigationRef.navigate('CollectionDetails', action.params);
      return;
    case 'CollectionSubmissions':
      navigationRef.navigate('CollectionSubmissions', action.params);
      return;
    case 'SharedCollection':
      navigationRef.navigate('SharedCollection', action.params);
      return;
  }
}

/**
 * Opening a notification, the same way from an OS Push tap, the in-app banner and an Inbox row:
 *  1. its target - known (Inbox row), else looked up by notificationId (the server re-checks access
 *     now), else (an older Push, or the lookup failed offline) the Push's own routing ids;
 *  2. it is marked read (tapping it is the engagement) - best-effort: a failed read receipt never
 *     keeps the person from where they are going; the bell is re-read later instead;
 *  3. the navigation - or, when nothing is reachable any more, the shared "unavailable" notice.
 * A lookup that says 404 means the notification is not this account's: it is dropped silently.
 */
export async function openNotification(input: OpenNotificationInput, deps: OpenNotificationDeps): Promise<OpenNotificationOutcome> {
  let target = input.target ?? null;
  if (target === null && input.notificationId !== null) {
    try {
      target = parseNotificationTarget((await getNotification(deps.request, input.notificationId, deps.locale)).target);
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.kind === 'notFound') {
        return 'discarded';
      }
      target = legacyPushTarget(input.legacyData);
    }
  } else if (target === null) {
    target = legacyPushTarget(input.legacyData);
  }

  if (input.notificationId !== null) {
    markRead(input.notificationId, input.knownUnread === true, deps.request);
  }

  if (target === null) {
    return 'discarded';
  }

  const action = navigationActionFor(target);
  if (action === null) {
    (deps.onUnavailable ?? showNotificationUnavailable)();
    return 'unavailable';
  }
  (deps.navigate ?? navigateWithRootNavigator)(action);
  return 'navigated';
}

function markRead(notificationId: number, knownUnread: boolean, request: AuthenticatedApiRequest): void {
  if (knownUnread) {
    adjustUnreadCount(-1);
  }
  markNotificationRead(request, notificationId)
    .then(result => setUnreadCount(result.unreadCount))
    .catch(() => {
      // The optimistic count may now be off by one - re-read it rather than guess.
      refreshUnreadCount(request).catch(() => undefined);
    });
}
