import type { TFunction } from 'i18next';
import type { AppNotification } from './notificationsApi';

export type NotificationGroupKey = 'today' | 'yesterday' | 'last7Days' | 'last30Days' | 'older';

export interface NotificationGroup {
  readonly key: NotificationGroupKey;
  readonly items: readonly AppNotification[];
}

const ORDER: readonly NotificationGroupKey[] = ['today', 'yesterday', 'last7Days', 'last30Days', 'older'];

/** Local midnight `daysBack` calendar days before `now`'s local date - calendar arithmetic, so a DST change never shifts a day. */
function localDayStart(now: Date, daysBack: number): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack).getTime();
}

/**
 * Which time group a notification belongs to, by the DEVICE's local calendar (never "N x 24 hours"):
 * today = since local midnight, yesterday = the local day before, then the 7 and 30 local days before today.
 * A moment slightly in the future (clock drift) counts as today.
 */
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

/** The rows (already newest first) split into their non-empty groups, in display order; row order is kept. */
export function groupNotifications(items: readonly AppNotification[], now: Date = new Date()): readonly NotificationGroup[] {
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
  return ORDER.filter(key => buckets.has(key)).map(key => ({ key, items: buckets.get(key)! }));
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * The compact time of a row under a group heading: 방금 / N분 / N시간 / N일, then a short date in the
 * device's own locale (the exact timestamp is in the row's accessibility label instead).
 */
export function formatNotificationTime(createdAtUtc: string, t: TFunction, now: Date = new Date()): string {
  const created = new Date(createdAtUtc);
  const age = now.getTime() - created.getTime();
  if (age < MINUTE_MS) {
    return t('comments.justNow');
  }
  if (age < HOUR_MS) {
    return t('comments.minutesAgo', { count: Math.floor(age / MINUTE_MS) });
  }
  const dayStart = localDayStart(now, 0);
  if (created.getTime() >= dayStart) {
    return t('comments.hoursAgo', { count: Math.floor(age / HOUR_MS) });
  }
  const daysAgo = Math.round((dayStart - localDayStart(created, 0)) / 86_400_000);
  if (daysAgo <= 7) {
    return t('notifications.daysAgo', { count: Math.max(1, daysAgo) });
  }
  return created.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The full date and time, for assistive technology. */
export function formatNotificationExactTime(createdAtUtc: string): string {
  return new Date(createdAtUtc).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
