import { formatMessage, type AppDictionary } from './appI18n.ts';
import { COLLECTION_INVITATIONS_HREF } from './collectionInvitations.ts';
import type { STATUS_ICON_MARKUP } from './collectionIconMarkup.ts';

/**
 * The signed-in user's Notification Inbox (알림) on the Web - the same Backend API and meaning as the mobile app
 * (apps/mobile/src/notifications: notificationsApi.ts, notificationTarget.ts, notificationGroups.ts, NotificationTypeIcon.tsx).
 * Rows carry the sentence the Push used (already in the app language) and, for where a tap leads, a target the SERVER resolved for
 * what the caller can open right now. The Web never decides a destination from the notification type: it maps the server's target
 * kinds onto its own routes (webDestinationOf) - the mobile navigationActionFor, for the pages the Web has.
 */

export type NotificationTargetKindWire =
  | 'friendRequests'
  | 'friends'
  | 'collectionInvitations'
  | 'collection'
  | 'collectionItem'
  | 'collectionSharedItem'
  | 'collectionSubmissions'
  | 'collectionJoinRequests'
  | 'publicCollection'
  | 'unavailable';

export interface NotificationTargetWire {
  readonly kind: NotificationTargetKindWire | string;
  readonly collectionId?: number | null;
  readonly itemId?: number | null;
  readonly publicId?: string | null;
  readonly focus?: string | null;
  readonly commentId?: number | null;
  readonly rootCommentId?: number | null;
}

export interface NotificationActor {
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly profileImageUrl?: string | null;
}

export interface AppNotification {
  readonly id: number;
  /** The Push data "type" (backend SocialNotificationPolicy.WireType), e.g. 'collectionItemComment' - only picks the glyph. */
  readonly type: string;
  readonly title: string | null;
  readonly body: string | null;
  readonly actor: NotificationActor | null;
  readonly collectionName: string | null;
  readonly createdAtUtc: string;
  readonly readAtUtc: string | null;
  readonly target: NotificationTargetWire;
  readonly previewImageUrl?: string | null;
  readonly collectionImageUrl?: string | null;
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

/** The mobile Inbox page size (keyset by id; the cursor is the server's, never parsed). */
export const NOTIFICATIONS_PAGE_SIZE = 30;
/** The bell's panel: the newest few of the same first page - the whole history is /notifications. */
export const POPOVER_NOTIFICATION_LIMIT = 8;

export const UNREAD_COUNT_PATH = '/api/v1/notifications/unread-count';
export const READ_ALL_PATH = '/api/v1/notifications/read-all';

export function notificationsPagePath(options: { readonly cursor?: string | null; readonly limit: number; readonly locale: string }): string {
  const query = new URLSearchParams();
  if (options.cursor) {
    query.set('cursor', options.cursor);
  }
  query.set('limit', String(options.limit));
  query.set('locale', options.locale);
  return `/api/v1/notifications?${query.toString()}`;
}

export function notificationReadPath(notificationId: number): string {
  return `/api/v1/notifications/${notificationId}/read`;
}

/** Opening a Collection's content reads its 새 링크 notifications (mobile CollectionDetailsScreen); its 승인 대기 count is untouched. */
export function collectionNewLinksReadPath(collectionId: number): string {
  return `/api/v1/notifications/collections/${collectionId}/new-links/read`;
}

/** In-app count badges show 1-99, then "99+" (mobile components/badgeCount.ts); nothing for 0. */
export function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

// ---- where a notification leads ---------------------------------------------------------------------------------------------------

export type NotificationTarget =
  | { readonly kind: 'friendRequests' }
  | { readonly kind: 'friends' }
  | { readonly kind: 'collectionInvitations' }
  | { readonly kind: 'collection'; readonly collectionId: number }
  | { readonly kind: 'collectionItem' | 'collectionSharedItem'; readonly collectionId: number; readonly itemId: number }
  | { readonly kind: 'collectionSubmissions'; readonly collectionId: number }
  | { readonly kind: 'collectionJoinRequests'; readonly collectionId: number }
  | { readonly kind: 'publicCollection'; readonly publicId: string }
  | { readonly kind: 'unavailable' };

const UNAVAILABLE: NotificationTarget = { kind: 'unavailable' };

/** A public link id as the server mints it - anything else is ignored rather than navigated to (mobile PUBLIC_ID_PATTERN). */
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function positiveId(value: unknown): number | null {
  const id = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * The server's target (mobile parseNotificationTarget, same rules). Untrusted input: an unknown kind or a malformed id is
 * 'unavailable', never a half-built route; a link target without its link id is its Collection.
 */
export function parseNotificationTarget(wire: NotificationTargetWire | null | undefined): NotificationTarget {
  const collectionId = positiveId(wire?.collectionId);
  switch (wire?.kind) {
    case 'friendRequests':
      return { kind: 'friendRequests' };
    case 'friends':
      return { kind: 'friends' };
    case 'collectionInvitations':
      return { kind: 'collectionInvitations' };
    case 'collection':
      return collectionId !== null ? { kind: 'collection', collectionId } : UNAVAILABLE;
    case 'collectionItem':
    case 'collectionSharedItem': {
      if (collectionId === null) {
        return UNAVAILABLE;
      }
      const itemId = positiveId(wire.itemId);
      return itemId !== null ? { kind: wire.kind, collectionId, itemId } : { kind: 'collection', collectionId };
    }
    case 'collectionSubmissions':
      return collectionId !== null ? { kind: 'collectionSubmissions', collectionId } : UNAVAILABLE;
    case 'collectionJoinRequests':
      return collectionId !== null ? { kind: 'collectionJoinRequests', collectionId } : UNAVAILABLE;
    case 'publicCollection':
      return typeof wire.publicId === 'string' && PUBLIC_ID_PATTERN.test(wire.publicId) ? { kind: 'publicCollection', publicId: wire.publicId } : UNAVAILABLE;
    default:
      return UNAVAILABLE;
  }
}

/**
 * The Web page for a target (mobile navigationActionFor):
 *  - href: a Web page that shows it (친구 → /me/friends; a Collection → its page; a public link → the public page /c/{publicId}).
 *    승인 요청 and 참여 요청 open their Collection (the mobile app opens the list over it; those lists are app-only - the Collection is
 *    the nearest real page).
 *  - collectionLink: a link IN a Collection - opened through the Collection like on mobile: see resolveCollectionLink.
 *  - received Collection invitations lead to the shared tab's received requests.
 *  - unavailable: nothing reachable any more (the mobile "이 알림의 항목을 더 이상 볼 수 없어요.").
 */
export type WebDestination =
  | { readonly kind: 'href'; readonly href: string }
  | { readonly kind: 'collectionLink'; readonly collectionId: number; readonly itemId: number; readonly mine: boolean }
  | { readonly kind: 'appOnly' }
  | { readonly kind: 'unavailable' };

export function webDestinationOf(target: NotificationTarget): WebDestination {
  switch (target.kind) {
    case 'friendRequests':
      return { kind: 'href', href: '/me/friends?requests=incoming' };
    case 'friends':
      return { kind: 'href', href: '/me/friends' };
    case 'collectionInvitations':
      return { kind: 'href', href: COLLECTION_INVITATIONS_HREF };
    case 'collection':
    case 'collectionSubmissions':
    case 'collectionJoinRequests':
      return { kind: 'href', href: `/collections/${target.collectionId}` };
    case 'collectionItem':
    case 'collectionSharedItem':
      return { kind: 'collectionLink', collectionId: target.collectionId, itemId: target.itemId, mine: target.kind === 'collectionItem' };
    case 'publicCollection':
      return { kind: 'href', href: `/c/${encodeURIComponent(target.publicId)}` };
    case 'unavailable':
      return { kind: 'unavailable' };
  }
}

/** What reading the link inside its Collection said (the Collection's own content gate is checked first by the server). */
export type CollectionLinkProbe = 'open' | 'gated' | 'missing' | 'failed';

/**
 * A link in a Collection, through the Collection as on mobile: when its content is open the link itself (mine → my Item page IN that
 * Collection, someone else's → the read-only shared view in the Collection); behind a lock / share password - or gone, or not readable now - the Collection's
 * own page, which asks for the password (or says what is wrong). A notification never skips a Collection's gate.
 */
export function collectionLinkHref(destination: Extract<WebDestination, { kind: 'collectionLink' }>, probe: CollectionLinkProbe): string {
  if (probe === 'open') {
    // My own link keeps its Collection (mobile: ItemDetails with that collectionContext) - so its reactions and comments, the reason
    // for most of these notifications, are there, and 삭제 is that Collection's 컬렉션에서 제거 as anywhere else inside it.
    return destination.mine
      ? `/items/${destination.itemId}?collectionId=${destination.collectionId}`
      : `/collections/${destination.collectionId}/items/${destination.itemId}`;
  }
  return `/collections/${destination.collectionId}`;
}

// ---- read state (local, before / after the server answers) -----------------------------------------------------------------------

/** A row shown as read at once (its first read time is the server's; locally "now" until the next load). */
export function markRowRead(items: readonly AppNotification[], notificationId: number, nowUtc: string): readonly AppNotification[] {
  return items.map(item => (item.id === notificationId && item.readAtUtc === null ? { ...item, readAtUtc: nowUtc } : item));
}

/** The read failed: that row is unread again (only if it was unread before the tap). */
export function rollbackRowRead(items: readonly AppNotification[], notificationId: number): readonly AppNotification[] {
  return items.map(item => (item.id === notificationId ? { ...item, readAtUtc: null } : item));
}

export function markAllRowsRead(items: readonly AppNotification[], nowUtc: string): readonly AppNotification[] {
  return items.map(item => (item.readAtUtc === null ? { ...item, readAtUtc: nowUtc } : item));
}

// ---- presentation ------------------------------------------------------------------------------------------------------------------

export type NotificationGlyph = keyof typeof STATUS_ICON_MARKUP;

/** The neutral, type-specific glyph (mobile NotificationTypeIcon) - shown where no person may be shown; never a made-up avatar. */
export function notificationGlyphOf(type: string | null): NotificationGlyph {
  switch (type) {
    case 'friendRequest':
    case 'friendRequestAccepted':
    case 'friendRequestRejected':
    case 'collectionInvitation':
    case 'joinRequest':
      return 'People';
    case 'collectionItemsAdded':
    case 'collectionLinkShared':
      return 'Link';
    case 'collectionItemReaction':
      return 'SmileyPlus';
    case 'collectionItemComment':
    case 'commentReply':
      return 'Comment';
    case 'commentLike':
      return 'HeartFilled';
    case 'collectionLinkSubmission':
      return 'Folder';
    case 'collectionLinkSubmissionApproved':
    case 'joinRequestApproved':
      return 'Check';
    case 'collectionLinkSubmissionRejected':
    case 'joinRequestRejected':
      return 'Close';
    default:
      return 'Bell';
  }
}

/** Types whose row shows the thumbnail of MY OWN link they are about (mobile PREVIEW_TYPES). */
export const PREVIEW_TYPES: ReadonlySet<string> = new Set(['collectionItemReaction', 'collectionItemComment', 'collectionLinkSubmissionApproved', 'collectionLinkSubmissionRejected']);

/**
 * Who is shown at a row's start (mobile NotificationLeading): an approval request never shows who proposed - the Collection (its
 * photo, else the folder glyph); a row naming who caused it - that person; anything else - the type glyph.
 */
export function notificationLeadingOf(notification: AppNotification): { readonly kind: 'collection'; readonly imageUrl: string | null } | { readonly kind: 'actor'; readonly actor: NotificationActor } | { readonly kind: 'glyph'; readonly glyph: NotificationGlyph } {
  if (notification.type === 'collectionLinkSubmission') {
    return { kind: 'collection', imageUrl: notification.collectionImageUrl ?? null };
  }
  if (notification.actor) {
    return { kind: 'actor', actor: notification.actor };
  }
  return { kind: 'glyph', glyph: notificationGlyphOf(notification.type) };
}

export type NotificationGroupKey = 'today' | 'yesterday' | 'last7Days' | 'last30Days' | 'older';

const GROUP_ORDER: readonly NotificationGroupKey[] = ['today', 'yesterday', 'last7Days', 'last30Days', 'older'];

export const GROUP_LABEL_KEYS = {
  today: 'notificationsGroupToday',
  yesterday: 'notificationsGroupYesterday',
  last7Days: 'notificationsGroupLast7Days',
  last30Days: 'notificationsGroupLast30Days',
  older: 'notificationsGroupOlder',
} as const satisfies Record<NotificationGroupKey, keyof AppDictionary>;

/** Local midnight `daysBack` calendar days before `now`'s local date - calendar arithmetic, so a DST change never shifts a day. */
function localDayStart(now: Date, daysBack: number): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack).getTime();
}

/** The mobile groups by the viewer's local calendar: 오늘 / 어제 / 최근 7일 / 최근 30일 / 이전 알림 (a future moment is today). */
export function notificationGroupOf(createdAtUtc: string, now: Date = new Date()): NotificationGroupKey {
  const time = new Date(createdAtUtc).getTime();
  if (Number.isNaN(time) || time >= localDayStart(now, 0)) {
    return 'today';
  }
  if (time >= localDayStart(now, 1)) {
    return 'yesterday';
  }
  if (time >= localDayStart(now, 7)) {
    return 'last7Days';
  }
  if (time >= localDayStart(now, 30)) {
    return 'last30Days';
  }
  return 'older';
}

/** The rows (already newest first) in their non-empty groups, in display order; row order is kept. */
export function groupNotifications(items: readonly AppNotification[], now: Date = new Date()): readonly { readonly key: NotificationGroupKey; readonly items: readonly AppNotification[] }[] {
  const buckets = new Map<NotificationGroupKey, AppNotification[]>();
  for (const item of items) {
    const key = notificationGroupOf(item.createdAtUtc, now);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(key, [item]);
    }
  }
  return GROUP_ORDER.filter(key => buckets.has(key)).map(key => ({ key, items: buckets.get(key)! }));
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** The compact time (mobile formatNotificationTime): 방금 전 / N분 전 / N시간 전 / N일, then a short date in the viewer's locale. */
export function formatNotificationTime(createdAtUtc: string, dictionary: AppDictionary, locale: string, now: Date = new Date()): string {
  const created = new Date(createdAtUtc);
  const age = now.getTime() - created.getTime();
  if (Number.isNaN(age) || age < MINUTE_MS) {
    return dictionary.timeJustNow;
  }
  if (age < HOUR_MS) {
    return formatMessage(dictionary.timeMinutesAgo, { count: Math.floor(age / MINUTE_MS) });
  }
  const dayStart = localDayStart(now, 0);
  if (created.getTime() >= dayStart) {
    return formatMessage(dictionary.timeHoursAgo, { count: Math.floor(age / HOUR_MS) });
  }
  const daysAgo = Math.round((dayStart - localDayStart(created, 0)) / 86_400_000);
  if (daysAgo <= 7) {
    return formatMessage(dictionary.notificationsDaysAgo, { count: Math.max(1, daysAgo) });
  }
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(created);
}

/** The full date and time, for the row's tooltip and assistive technology. */
export function formatNotificationExactTime(createdAtUtc: string, locale: string): string {
  const created = new Date(createdAtUtc);
  return Number.isNaN(created.getTime()) ? '' : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(created);
}

/** The bell's accessible name: the full count (the visible badge caps at 99+). */
export function bellLabel(unread: number | null, dictionary: AppDictionary): string {
  return unread && unread > 0 ? formatMessage(dictionary.notificationsBellUnreadA11y, { count: unread }) : dictionary.notificationsBellA11y;
}
