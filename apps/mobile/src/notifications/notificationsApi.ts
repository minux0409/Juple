import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';

/**
 * The signed-in user's Notification Inbox (알림) - the Backend's /api/v1/notifications. Rows carry the
 * same sentence the Push used (already in the app language passed as `locale`) and, for where a tap
 * leads, ids only for what the caller can open right now. A row whose target is gone comes back with
 * no title/body/actor/Collection name at all (target kind 'unavailable') - the app shows its own
 * generic line instead. Never a comment's text, a memo, a URL or an email.
 */
export type NotificationTargetKindWire =
  | 'friendRequests'
  | 'friends'
  | 'collectionInvitations'
  | 'collection'
  | 'collectionItem'
  | 'collectionSubmissions'
  | 'publicCollection'
  | 'unavailable';

export interface NotificationTargetWire {
  readonly kind: NotificationTargetKindWire | string;
  readonly collectionId?: number | null;
  readonly itemId?: number | null;
  readonly publicId?: string | null;
  readonly focus?: string | null;
}

export interface NotificationActor {
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly profileImageUrl?: string | null;
  readonly profileImageVersion?: string | null;
}

export interface AppNotification {
  readonly id: number;
  /** The Push data "type" (SocialNotificationPolicy.WireType) - e.g. 'collectionItemComment'. */
  readonly type: string;
  readonly title: string | null;
  readonly body: string | null;
  /** Only where the Type names who caused it, and never for a proposal (승인 요청) or a public-link add. */
  readonly actor: NotificationActor | null;
  readonly collectionName: string | null;
  readonly createdAtUtc: string;
  readonly readAtUtc: string | null;
  readonly target: NotificationTargetWire;
  /** The thumbnail of MY OWN link this row is about (a reaction/comment on it, or the result of its proposal) - already stored, never fetched per row. */
  readonly previewImageUrl?: string | null;
  /** The Collection's icon photo, only where I may see the Collection by name - the folder glyph otherwise. */
  readonly collectionImageUrl?: string | null;
  readonly collectionImageVersion?: string | null;
}

export interface NotificationsPage {
  readonly items: readonly AppNotification[];
  readonly nextCursor: string | null;
  readonly unreadCount: number;
}

export interface NotificationReadResult {
  readonly markedCount: number;
  readonly unreadCount: number;
}

export const NOTIFICATIONS_PAGE_SIZE = 30;

export async function getNotifications(
  request: AuthenticatedApiRequest,
  options: { readonly cursor?: string | null; readonly limit?: number; readonly locale: string },
): Promise<NotificationsPage> {
  const query = new URLSearchParams();
  if (options.cursor) {
    query.set('cursor', options.cursor);
  }
  query.set('limit', String(options.limit ?? NOTIFICATIONS_PAGE_SIZE));
  query.set('locale', options.locale);
  const response = await request<NotificationsPage>({ method: 'GET', path: `/api/v1/notifications?${query.toString()}` });
  return response.body ?? { items: [], nextCursor: null, unreadCount: 0 };
}

/** One of the caller's own notifications with its current target. Rejects with ApiError notFound for anything else. */
export async function getNotification(request: AuthenticatedApiRequest, notificationId: number, locale: string): Promise<AppNotification> {
  const response = await request<AppNotification>({
    method: 'GET',
    path: `/api/v1/notifications/${notificationId}?locale=${encodeURIComponent(locale)}`,
  });
  if (!response.body) {
    throw new Error('Juple API returned no notification.');
  }
  return response.body;
}

export async function getUnreadNotificationCount(request: AuthenticatedApiRequest): Promise<number> {
  const response = await request<{ totalUnread: number }>({ method: 'GET', path: '/api/v1/notifications/unread-count' });
  return response.body?.totalUnread ?? 0;
}

/** Idempotent. Rejects with ApiError notFound when it is not the caller's own notification. */
export async function markNotificationRead(request: AuthenticatedApiRequest, notificationId: number): Promise<NotificationReadResult> {
  return readResult(await request<NotificationReadResult>({ method: 'POST', path: `/api/v1/notifications/${notificationId}/read` }));
}

/** Removes one of MY OWN notifications (swipe-delete). Rejects with ApiError notFound when it is not mine or already gone. */
export async function deleteNotification(request: AuthenticatedApiRequest, notificationId: number): Promise<NotificationReadResult> {
  return readResult(await request<NotificationReadResult>({ method: 'DELETE', path: `/api/v1/notifications/${notificationId}` }));
}

export async function markAllNotificationsRead(request: AuthenticatedApiRequest): Promise<NotificationReadResult> {
  return readResult(await request<NotificationReadResult>({ method: 'POST', path: '/api/v1/notifications/read-all' }));
}

/** Opening a Collection: its unread 새 링크 notifications become read (its 승인 대기 count does not change). */
export async function markCollectionNewLinksRead(request: AuthenticatedApiRequest, collectionId: number): Promise<NotificationReadResult> {
  return readResult(await request<NotificationReadResult>({
    method: 'POST',
    path: `/api/v1/notifications/collections/${collectionId}/new-links/read`,
  }));
}

/** Opening a Collection's 승인 대기 list: its approval-request notifications become read (the requests still wait). */
export async function markCollectionSubmissionRequestsRead(request: AuthenticatedApiRequest, collectionId: number): Promise<NotificationReadResult> {
  return readResult(await request<NotificationReadResult>({
    method: 'POST',
    path: `/api/v1/notifications/collections/${collectionId}/submission-requests/read`,
  }));
}

function readResult(response: { readonly body?: NotificationReadResult | null }): NotificationReadResult {
  if (!response.body) {
    throw new Error('Juple API returned no read result.');
  }
  return response.body;
}
