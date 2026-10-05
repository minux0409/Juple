import { formatNotificationTime, groupNotifications, notificationGroupOf } from '../notificationGroups';
import type { AppNotification } from '../notificationsApi';

// Local-calendar arithmetic only - the tests build instants from local date parts, so they hold in any time zone.
const NOW = new Date(2026, 9, 5, 14, 30); // Mon 2026-10-05 14:30 local
const at = (daysBack: number, hour: number, minute = 0) => new Date(2026, 9, 5 - daysBack, hour, minute).toISOString();

describe('notificationGroupOf', () => {
  it('uses calendar days for today / yesterday, not 24-hour blocks', () => {
    expect(notificationGroupOf(at(0, 0, 0), NOW)).toBe('today'); // exactly local midnight
    expect(notificationGroupOf(at(0, 14, 29), NOW)).toBe('today');
    expect(notificationGroupOf(at(1, 23, 59), NOW)).toBe('yesterday'); // 14.5 hours ago, but yesterday
    expect(notificationGroupOf(at(1, 0, 0), NOW)).toBe('yesterday');
    expect(notificationGroupOf(at(2, 23, 59), NOW)).toBe('last7Days'); // 2 days ago evening
  });

  it('buckets the older days by local calendar', () => {
    expect(notificationGroupOf(at(7, 0, 0), NOW)).toBe('last7Days');
    expect(notificationGroupOf(at(8, 23, 59), NOW)).toBe('last30Days');
    expect(notificationGroupOf(at(30, 0, 0), NOW)).toBe('last30Days');
    expect(notificationGroupOf(at(31, 23, 59), NOW)).toBe('older');
    expect(notificationGroupOf(at(400, 12), NOW)).toBe('older');
  });

  it('treats a moment slightly in the future (clock drift) as today', () => {
    expect(notificationGroupOf(new Date(NOW.getTime() + 5 * 60_000).toISOString(), NOW)).toBe('today');
  });
});

describe('groupNotifications', () => {
  const row = (id: number, createdAtUtc: string) => ({ id, createdAtUtc }) as AppNotification;

  it('returns only the non-empty groups, in display order, keeping each group\'s own order', () => {
    const groups = groupNotifications([row(5, at(0, 13)), row(4, at(0, 9)), row(3, at(1, 20)), row(2, at(40, 10)), row(1, at(45, 10))], NOW);
    expect(groups.map(group => [group.key, group.items.map(item => item.id)])).toEqual([
      ['today', [5, 4]],
      ['yesterday', [3]],
      ['older', [2, 1]],
    ]);
  });

  it('is empty for no notifications', () => {
    expect(groupNotifications([], NOW)).toEqual([]);
  });
});

describe('formatNotificationTime', () => {
  const t = ((key: string, options?: { count?: number }) => `${key}:${options?.count ?? ''}`) as never;

  it('is compact: just now, minutes, hours today, then days, then a short date', () => {
    expect(formatNotificationTime(new Date(NOW.getTime() - 20_000).toISOString(), t, NOW)).toBe('comments.justNow:');
    expect(formatNotificationTime(new Date(NOW.getTime() - 5 * 60_000).toISOString(), t, NOW)).toBe('comments.minutesAgo:5');
    expect(formatNotificationTime(at(0, 9, 30), t, NOW)).toBe('comments.hoursAgo:5');
    expect(formatNotificationTime(at(1, 23, 0), t, NOW)).toBe('notifications.daysAgo:1');
    expect(formatNotificationTime(at(3, 8), t, NOW)).toBe('notifications.daysAgo:3');
    expect(formatNotificationTime(at(40, 8), t, NOW)).not.toContain('notifications.daysAgo');
  });
});
