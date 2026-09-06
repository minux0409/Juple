import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';

/**
 * Mirrors NotificationsController.NotificationResponse (Backend, /api/v1/notifications). Currently
 * the only Type is "repeatPurchaseDue" - repeatPurchaseId/itemId/productName/dueDate are always
 * present for it. This is the user's in-app notification inbox, never a Push delivery log.
 */
export interface Notification {
  readonly id: number;
  readonly type: 'repeatPurchaseDue';
  readonly repeatPurchaseId: number | null;
  readonly itemId: number | null;
  readonly productName: string | null;
  /** "YYYY-MM-DD" (DateOnly) - never a timestamp, never parsed as UTC. */
  readonly dueDate: string | null;
  readonly createdAtUtc: string;
  readonly readAtUtc: string | null;
  readonly isRead: boolean;
}

export interface NotificationPage {
  readonly notifications: readonly Notification[];
  readonly nextCursor: string | null;
}

export interface GetNotificationsOptions {
  readonly limit?: number;
  /** Opaque value from a previous NotificationPage.nextCursor; never parsed or modified. */
  readonly cursor?: string;
}

/** Newest-first; the Backend materializes any newly-due RepeatPurchase notifications before returning this page. */
export async function getNotifications(
  request: AuthenticatedApiRequest,
  options: GetNotificationsOptions = {},
): Promise<NotificationPage> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) {
    query.set('limit', String(options.limit));
  }
  if (options.cursor) {
    query.set('cursor', options.cursor);
  }

  const queryString = query.toString();
  const response = await request<NotificationPage>({
    method: 'GET',
    path: queryString ? `/api/v1/notifications?${queryString}` : '/api/v1/notifications',
  });

  if (!response.body) {
    throw new Error('Juple API returned no Notification page body.');
  }

  return response.body;
}

interface UnreadNotificationCountResponse {
  readonly unreadCount: number;
}

/** The Backend materializes any newly-due RepeatPurchase notifications before counting. */
export async function getUnreadNotificationCount(request: AuthenticatedApiRequest): Promise<number> {
  const response = await request<UnreadNotificationCountResponse>({
    method: 'GET',
    path: '/api/v1/notifications/unread-count',
  });

  if (!response.body) {
    throw new Error('Juple API returned no unread Notification count body.');
  }

  return response.body.unreadCount;
}

/** POSTs .../read; resolves on 204. Idempotent - already-read succeeds too. */
export async function markNotificationRead(
  request: AuthenticatedApiRequest,
  notificationId: number,
): Promise<void> {
  await request<void>({
    method: 'POST',
    path: `/api/v1/notifications/${notificationId}/read`,
  });
}

/** POSTs .../read-all; resolves on 204. Idempotent, and only affects the current user's own notifications. */
export async function markAllNotificationsRead(request: AuthenticatedApiRequest): Promise<void> {
  await request<void>({
    method: 'POST',
    path: '/api/v1/notifications/read-all',
  });
}
