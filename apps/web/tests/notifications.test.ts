import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { APP_LANGUAGES } from '../lib/appI18n.ts';
import { requiresSignIn } from '../lib/authSession.ts';
import { STATUS_ICON_MARKUP } from '../lib/collectionIconMarkup.ts';
import {
  adjustUnreadCount,
  getUnreadCount,
  refreshUnreadCount,
  resetUnreadCount,
  setUnreadCount,
  shouldAutoRefresh,
  subscribeUnreadCount,
  UNREAD_REFRESH_MIN_INTERVAL_MS,
} from '../lib/notificationState.ts';
import {
  bellLabel,
  collectionLinkHref,
  collectionNewLinksReadPath,
  formatBadgeCount,
  formatNotificationTime,
  groupNotifications,
  markAllRowsRead,
  notificationGroupOf,
  markRowRead,
  notificationGlyphOf,
  notificationLeadingOf,
  notificationReadPath,
  notificationsPagePath,
  parseNotificationTarget,
  POPOVER_NOTIFICATION_LIMIT,
  READ_ALL_PATH,
  rollbackRowRead,
  UNREAD_COUNT_PATH,
  webDestinationOf,
  type AppNotification,
} from '../lib/notifications.ts';
import { appendPage, canLoadMore, firstPage, startLoadingMore } from '../lib/paging.ts';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ko = getAppDictionary('ko');

function row(id: number, overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    type: 'collectionItemsAdded',
    title: null,
    body: `body ${id}`,
    actor: null,
    collectionName: null,
    createdAtUtc: '2026-10-12T00:00:00Z',
    readAtUtc: null,
    target: { kind: 'collection', collectionId: 5 },
    ...overrides,
  };
}

describe('notifications: the existing API only', () => {
  it('the mobile endpoints, keyset cursor and app language - no new endpoint', () => {
    assert.equal(UNREAD_COUNT_PATH, '/api/v1/notifications/unread-count');
    assert.equal(READ_ALL_PATH, '/api/v1/notifications/read-all');
    assert.equal(notificationReadPath(42), '/api/v1/notifications/42/read');
    assert.equal(collectionNewLinksReadPath(7), '/api/v1/notifications/collections/7/new-links/read');
    assert.equal(notificationsPagePath({ limit: 30, locale: 'ko' }), '/api/v1/notifications?limit=30&locale=ko');
    assert.equal(notificationsPagePath({ cursor: '991', limit: POPOVER_NOTIFICATION_LIMIT, locale: 'en' }), `/api/v1/notifications?cursor=991&limit=${POPOVER_NOTIFICATION_LIMIT}&locale=en`);
    const controller = read('../../backend/src/Juple.Api/Controllers/NotificationsController.cs');
    for (const route of ['"unread-count"', '"{notificationId:long}/read"', '"read-all"', '"collections/{collectionId:long}/new-links/read"']) {
      assert.ok(controller.includes(route), route);
    }
  });
});

describe('unread count (the bell)', () => {
  it('server answers set it; an optimistic change never goes below zero; sign-out clears it', () => {
    resetUnreadCount();
    let notified = 0;
    const unsubscribe = subscribeUnreadCount(() => notified++);
    adjustUnreadCount(-1);
    assert.equal(getUnreadCount(), null, 'nothing to adjust before the first count');
    setUnreadCount(2);
    adjustUnreadCount(-1);
    adjustUnreadCount(-5);
    assert.equal(getUnreadCount(), 0);
    resetUnreadCount();
    assert.equal(getUnreadCount(), null);
    assert.ok(notified >= 3);
    unsubscribe();
  });

  it('an older refresh never overwrites a newer server answer; a failed refresh keeps what is shown', async () => {
    resetUnreadCount();
    let resolveSlow: (value: number) => void = () => undefined;
    const slow = refreshUnreadCount(() => new Promise<number>(resolve => (resolveSlow = resolve)));
    setUnreadCount(4); // e.g. a read answered meanwhile
    resolveSlow(9);
    await slow;
    assert.equal(getUnreadCount(), 4);
    await refreshUnreadCount(() => Promise.reject(new Error('offline')));
    assert.equal(getUnreadCount(), 4);
    await refreshUnreadCount(() => Promise.resolve(3));
    assert.equal(getUnreadCount(), 3);
  });

  it('focus / navigation refresh is throttled (no polling)', async () => {
    resetUnreadCount();
    assert.equal(shouldAutoRefresh(1_000), true, 'unknown count: always');
    await refreshUnreadCount(() => Promise.resolve(1), 1_000);
    assert.equal(shouldAutoRefresh(1_000 + UNREAD_REFRESH_MIN_INTERVAL_MS - 1), false);
    assert.equal(shouldAutoRefresh(1_000 + UNREAD_REFRESH_MIN_INTERVAL_MS), true);
    const bell = read('app/(app)/notifications/NotificationBell.tsx');
    assert.match(bell, /window\.addEventListener\('focus', refresh\)/);
    assert.match(bell, /document\.addEventListener\('visibilitychange', onVisibility\)/);
    assert.doesNotMatch(bell, /setInterval|setTimeout/);
  });

  it('the badge: 1-99, then 99+ (mobile badgeCount); the button name carries the full count', () => {
    assert.equal(formatBadgeCount(1), '1');
    assert.equal(formatBadgeCount(99), '99');
    assert.equal(formatBadgeCount(100), '99+');
    assert.equal(bellLabel(0, ko), '알림');
    assert.equal(bellLabel(null, ko), '알림');
    assert.equal(bellLabel(120, ko), '알림, 읽지 않은 알림 120개');
  });
});

describe('the bell and its panel', () => {
  const shell = read('app/(app)/AppShell.tsx');
  const bell = read('app/(app)/notifications/NotificationBell.tsx');

  it('a global action in every page header row - not a side bar destination, never floating', () => {
    // The shell no longer carries the bell: each primary page's header row does (PageHeader), at the end of the title row.
    assert.doesNotMatch(shell, /NotificationBell|utilityBar/);
    const header = read('app/(app)/PageHeader.tsx');
    assert.match(header, /<div className=\{styles\.pageHeaderActions\}>[\s\S]*?<NotificationBell \/>/);
    assert.doesNotMatch(read('lib/appNavigation.ts'), /notifications/);
    const css = read('app/(app)/app.module.css');
    assert.match(css, /grid-template-areas:\s*'side main';/);
    assert.doesNotMatch(css, /utility/);
    // The bell never floats: the fixed rules are the pill / ⋯ menu panel (it escapes a scrolling list) and the 되돌리기 snackbar.
    const fixedRules = [...css.matchAll(/([^{}]+)\{[^{}]*position: fixed/g)].map(match => match[1].trim().split('\n').pop());
    assert.deepEqual(fixedRules, ['.floatingPanel', '.toastHost', '.tourRoot'], 'never fixed to the window');
  });

  it('the button: named with the count, a badge only when unread, expanded state, a dialog panel', () => {
    assert.match(bell, /aria-label=\{bellLabel\(unread, dictionary\)\}/);
    assert.match(bell, /aria-haspopup="dialog"/);
    assert.match(bell, /aria-expanded=\{isOpen\}/);
    assert.match(bell, /\{unread && unread > 0 \? \(\s*<span aria-hidden className=\{styles\.countBadge\}>\s*\{formatBadgeCount\(unread\)\}/);
    assert.match(bell, /role="dialog" tabIndex=\{-1\}/);
  });

  it('opens with the newest few, closes on Esc (focus back on the bell), a click outside or another page', () => {
    assert.match(bell, /notificationsPagePath\(\{ limit: POPOVER_NOTIFICATION_LIMIT, locale \}\)/);
    assert.ok(POPOVER_NOTIFICATION_LIMIT >= 5 && POPOVER_NOTIFICATION_LIMIT <= 10);
    assert.match(bell, /event\.key === 'Escape'[\s\S]*?close\(true\)/);
    assert.match(bell, /buttonRef\.current\?\.focus\(\)/);
    assert.match(bell, /!wrapperRef\.current\.contains\(event\.target as Node\)[\s\S]*?close\(false\)/);
    assert.match(bell, /const isOpen = openOn === pathname;/, 'moving to another page closes it');
    assert.match(bell, /panelRef\.current\?\.focus\(\)/, 'keyboard focus moves into the panel');
  });

  it('the panel has 모두 읽음 (only while something is unread), 모두 보기 (/notifications), empty and retry states', () => {
    assert.match(bell, /canReadAll \? \(/);
    assert.match(bell, /href="\/notifications"[\s\S]*?\{dictionary\.notificationsSeeAll\}/);
    assert.match(bell, /dictionary\.notificationsEmpty/);
    assert.match(bell, /dictionary\.notificationsRetry/);
  });
});

describe('the 알림 page', () => {
  const view = read('app/(app)/notifications/NotificationsView.tsx');

  it('/notifications is a signed-in page; public pages stay public', () => {
    assert.equal(requiresSignIn('/notifications'), true);
    for (const path of ['/c/AbCdEfGh12345678', '/privacy', '/terms', '/auth/callback']) {
      assert.equal(requiresSignIn(path), false, path);
    }
  });

  it('keyset infinite scroll with skeletons (the shared LoadMore), no 더 보기 button; mobile groups', () => {
    assert.match(view, /<LoadMore dictionary=\{dictionary\} onLoadMore=\{loadMore\} skeleton=\{<NotificationSkeleton count=\{3\} \/>\}/);
    assert.match(view, /notificationsPagePath\(\{ cursor, limit: NOTIFICATIONS_PAGE_SIZE, locale \}\)/);
    assert.match(view, /groupNotifications\(items\)/);
    assert.doesNotMatch(view, /더 보기|loadMoreButton/);
  });

  it('a later page never repeats a row; one page at a time', () => {
    let state = firstPage([row(30), row(29)], '29');
    assert.equal(canLoadMore(state), true);
    state = startLoadingMore(state);
    assert.equal(canLoadMore(state), false, 'no second request while one is on its way');
    state = appendPage(state, { items: [row(29), row(28)], nextCursor: null }, item => item.id);
    assert.deepEqual(state.items.map(item => item.id), [30, 29, 28]);
    assert.equal(canLoadMore(state), false);
  });

  it('groups by the local calendar like mobile (오늘 / 어제 / 최근 7일 / 최근 30일 / 이전 알림)', () => {
    const now = new Date(2026, 9, 12, 15, 0);
    const at = (daysBack: number) => new Date(2026, 9, 12 - daysBack, 10, 0).toISOString();
    const groups = groupNotifications([row(5, { createdAtUtc: at(0) }), row(4, { createdAtUtc: at(1) }), row(3, { createdAtUtc: at(5) }), row(2, { createdAtUtc: at(20) }), row(1, { createdAtUtc: at(60) })], now);
    assert.deepEqual(groups.map(group => group.key), ['today', 'yesterday', 'last7Days', 'last30Days', 'older']);
  });

  it('compact times are the mobile strings', () => {
    const now = new Date('2026-10-12T12:00:00Z');
    assert.equal(formatNotificationTime('2026-10-12T11:59:30Z', ko, 'ko', now), '방금 전');
    assert.equal(formatNotificationTime('2026-10-12T11:15:00Z', ko, 'ko', now), '45분 전');
  });
});

describe('read / read-all', () => {
  it('a row is read at once and unread again when the server refuses; read-all marks every loaded row', () => {
    const rows = [row(3), row(2, { readAtUtc: '2026-10-11T00:00:00Z' })];
    const afterTap = markRowRead(rows, 3, '2026-10-12T01:00:00Z');
    assert.equal(afterTap[0]!.readAtUtc, '2026-10-12T01:00:00Z');
    assert.equal(afterTap[1]!.readAtUtc, '2026-10-11T00:00:00Z', 'an already read row keeps its time');
    assert.equal(rollbackRowRead(afterTap, 3)[0]!.readAtUtc, null);
    assert.ok(markAllRowsRead(rows, 'now').every(item => item.readAtUtc !== null));
  });

  it('the shared actions: optimistic read + bell -1, rollback + server re-read on failure; read-all restores both on failure', () => {
    const actions = read('app/(app)/notifications/useNotificationActions.ts');
    assert.match(actions, /if \(row\.readAtUtc === null\) \{\s*setRows\(previous => markRowRead\(previous, row\.id, [^;]*;\s*adjustUnreadCount\(-1\);/);
    assert.match(actions, /setRows\(previous => rollbackRowRead\(previous, row\.id\)\);\s*void refreshUnreadCount\(fetchUnread\);/);
    assert.match(actions, /setUnreadCount\(0\);\s*try \{\s*const result = await api<NotificationReadResult>\(\{ method: 'POST', path: READ_ALL_PATH \}\);/);
    assert.match(actions, /setRows\(\(\) => restored\);[\s\S]*?setUnreadCount\(countBefore\);/);
    for (const file of ['app/(app)/notifications/NotificationBell.tsx', 'app/(app)/notifications/NotificationsView.tsx']) {
      assert.match(read(file), /dictionary\.notificationsReadAllFailed/, file);
    }
  });
});

describe('where a notification leads (the server\'s target -> a Web page)', () => {
  it('the Web knows exactly the backend\'s target kinds', () => {
    const backend = read('../../backend/src/Juple.Application/Notifications/Inbox/NotificationInbox.cs');
    const kinds = [...backend.slice(backend.indexOf('public static class NotificationTargetKinds')).matchAll(/public const string \w+ = "(\w+)";/g)].map(match => match[1]).slice(0, 10);
    assert.deepEqual(new Set(kinds), new Set(['friendRequests', 'friends', 'collectionInvitations', 'collection', 'collectionItem', 'collectionSharedItem', 'collectionSubmissions', 'collectionJoinRequests', 'publicCollection', 'unavailable']));
    for (const kind of kinds) {
      const target = parseNotificationTarget({ kind: kind!, collectionId: 5, itemId: 9, publicId: 'AbCdEfGh12345678' });
      assert.equal(target.kind, kind, kind);
    }
  });

  it('each kind maps to its Web page (mobile navigationActionFor)', () => {
    const go = (wire: Parameters<typeof parseNotificationTarget>[0]) => webDestinationOf(parseNotificationTarget(wire));
    assert.deepEqual(go({ kind: 'friendRequests' }), { kind: 'href', href: '/me/friends?requests=incoming' });
    assert.deepEqual(go({ kind: 'friends' }), { kind: 'href', href: '/me/friends' });
    assert.deepEqual(go({ kind: 'collection', collectionId: 5 }), { kind: 'href', href: '/collections/5' });
    assert.deepEqual(go({ kind: 'collectionSubmissions', collectionId: 5 }), { kind: 'href', href: '/collections/5' }, '승인 대기 list is app-only: its Collection');
    assert.deepEqual(go({ kind: 'collectionJoinRequests', collectionId: 5 }), { kind: 'href', href: '/collections/5' }, '참여 요청 list is app-only: its Collection');
    assert.deepEqual(go({ kind: 'collectionItem', collectionId: 5, itemId: 9, focus: 'comments' }), { kind: 'collectionLink', collectionId: 5, itemId: 9, mine: true });
    assert.deepEqual(go({ kind: 'collectionSharedItem', collectionId: 5, itemId: 9, rootCommentId: 3 }), { kind: 'collectionLink', collectionId: 5, itemId: 9, mine: false });
    assert.deepEqual(go({ kind: 'collectionItem', collectionId: 5 }), { kind: 'href', href: '/collections/5' }, 'no link id: its Collection');
    assert.deepEqual(go({ kind: 'publicCollection', publicId: 'AbCdEfGh12345678' }), { kind: 'href', href: '/c/AbCdEfGh12345678' });
    assert.deepEqual(go({ kind: 'collectionInvitations' }), { kind: 'href', href: '/collections?tab=shared&invitations=1' });
  });

  it('untrusted targets: unknown kinds and malformed ids are unavailable, never a half-built route', () => {
    for (const wire of [null, { kind: 'somethingNew' }, { kind: 'collection' }, { kind: 'collection', collectionId: -1 }, { kind: 'collectionItem', itemId: 3 }, { kind: 'publicCollection', publicId: '../x' }, { kind: 'unavailable' }]) {
      assert.deepEqual(webDestinationOf(parseNotificationTarget(wire as never)), { kind: 'unavailable' }, JSON.stringify(wire));
    }
  });

  it('a link in a Collection is opened through the Collection: the link only when its content is open, else the Collection (its gate)', () => {
    const mine = { kind: 'collectionLink', collectionId: 5, itemId: 9, mine: true } as const;
    const theirs = { ...mine, mine: false } as const;
    assert.equal(collectionLinkHref(mine, 'open'), '/items/9?collectionId=5', 'my link keeps its Collection: its comments and reactions are there');
    assert.equal(collectionLinkHref(theirs, 'open'), '/collections/5/items/9');
    for (const probe of ['gated', 'missing', 'failed'] as const) {
      assert.equal(collectionLinkHref(mine, probe), '/collections/5', probe);
      assert.equal(collectionLinkHref(theirs, probe), '/collections/5', probe);
    }
    const actions = read('app/(app)/notifications/useNotificationActions.ts');
    assert.match(actions, /path: sharedItemPath\(destination\.collectionId, destination\.itemId\), headers: unlockHeaders\(destination\.collectionId\)/);
  });

  it('what the Web cannot show stays put with a notice (app-only / no longer available), and the row is still read', () => {
    for (const file of ['app/(app)/notifications/NotificationBell.tsx', 'app/(app)/notifications/NotificationsView.tsx']) {
      const source = read(file);
      assert.match(source, /outcome === 'appOnly' \? dictionary\.notificationsAppOnly : dictionary\.notificationsUnavailable/, file);
    }
    const actions = read('app/(app)/notifications/useNotificationActions.ts');
    assert.ok(actions.indexOf('markRowRead(previous, row.id') < actions.indexOf('webDestinationOf('), 'read first, then the destination');
  });
});

describe('notification types: no Web enum, the backend wire types', () => {
  const backend = read('../../backend/src/Juple.Application/Notifications/SocialNotifications.cs');
  const wireTypes = [...backend.matchAll(/NotificationType\.(\w+) => "(\w+)"/g)].map(match => ({ type: match[1]!, wire: match[2]! }));
  /** Data-only refresh signals - never an Inbox row with a glyph of its own (mobile: no banner). */
  const DATA_ONLY = new Set(['collectionInvitationAnswered', 'collectionContentChanged', 'friendRequestAnswered']);

  it('every visible backend type has the mobile glyph (NotificationTypeIcon); anything unknown is the bell', () => {
    assert.ok(wireTypes.length >= 19, 'the backend wire table was read');
    const mobile = read('../mobile/src/notifications/NotificationTypeIcon.tsx');
    const mobileGlyph: Record<string, string> = { PeopleIcon: 'People', LinkIcon: 'Link', SmileyPlusIcon: 'SmileyPlus', CommentIcon: 'Comment', HeartIcon: 'HeartFilled', FolderIcon: 'Folder', CheckIcon: 'Check', CloseIcon: 'Close' };
    for (const { wire } of wireTypes) {
      if (DATA_ONLY.has(wire)) {
        continue;
      }
      const block = mobile.match(new RegExp(`case '${wire}':[\\s\\S]*?return <(\\w+)`));
      assert.ok(block, `mobile glyph for ${wire}`);
      assert.equal(notificationGlyphOf(wire), mobileGlyph[block![1]!], wire);
    }
    assert.equal(notificationGlyphOf('somethingNew'), 'Bell');
    for (const glyph of ['Bell', 'People', 'Link', 'SmileyPlus', 'Comment', 'HeartFilled', 'Folder', 'Check', 'Close'] as const) {
      assert.ok(STATUS_ICON_MARKUP[glyph], glyph);
    }
  });

  it('the row start: an approval request shows its Collection (never who proposed), a named actor their avatar, else the glyph', () => {
    assert.equal(notificationLeadingOf(row(1, { type: 'collectionLinkSubmission', actor: { jupleId: 'a', displayName: 'A' } })).kind, 'collection');
    assert.equal(notificationLeadingOf(row(1, { type: 'collectionItemComment', actor: { jupleId: 'a', displayName: 'A' } })).kind, 'actor');
    assert.deepEqual(notificationLeadingOf(row(1, { type: 'collectionLinkSubmissionApproved' })), { kind: 'glyph', glyph: 'Check' });
  });
});

describe('Collection attention (its own meaning, not the bell)', () => {
  it('a card shows the server\'s attentionCount (99+ cap) and says the full count in its name', () => {
    const view = read('app/(app)/collections/CollectionsView.tsx');
    assert.match(view, /const attention = collection\.attentionCount \?\? 0;/);
    assert.match(view, /formatMessage\(dictionary\.collectionAttentionA11y, \{ name: collection\.name, count: attention \}\)/);
    assert.match(view, /formatBadgeCount\(attention\)/);
    assert.doesNotMatch(view, /UnreadCount|unread-count/, 'never the bell\'s total');
  });

  it('opening a Collection\'s content reads its 새 링크 notifications (after the gate), once per visit', () => {
    const details = read('app/(app)/collections/[collectionId]/CollectionDetailsView.tsx');
    assert.match(details, /path: collectionNewLinksReadPath\(collectionId\)/);
    assert.match(details, /\.then\(result => \{\s*markContentOpened\(\);\s*return result\.sections;/);
    assert.match(details, /onOpened\(\);\s*setState\(\{ kind: 'loaded', \.\.\.firstPage\(page\.items, page\.nextCursor\) \}\);/);
    assert.doesNotMatch(details, /submission-requests\/read/, '승인 대기 is a task: untouched');
  });
});

describe('notification strings and scope', () => {
  it('mobile notification strings in every language; Web-only ones fall back to English', () => {
    for (const language of APP_LANGUAGES) {
      const dictionary = getAppDictionary(language);
      for (const key of ['notificationsTitle', 'notificationsMarkAllRead', 'notificationsEmpty', 'notificationsUnavailable', 'notificationsRetry', 'notificationsBellA11y', 'notificationsSeeAll', 'notificationsAppOnly', 'notificationsReadAllFailed'] as const) {
        assert.ok(dictionary[key]?.trim(), `${language} ${key}`);
      }
    }
    assert.equal(ko.notificationsTitle, '알림');
    assert.equal(ko.notificationsMarkAllRead, '모두 읽음');
  });

  it('no browser push in this round: no service worker, no permission prompt', () => {
    for (const file of ['app/(app)/notifications/NotificationBell.tsx', 'app/(app)/notifications/NotificationsView.tsx', 'app/(app)/notifications/useNotificationActions.ts', 'lib/notifications.ts', 'lib/notificationState.ts', 'app/(app)/AppShell.tsx']) {
      assert.doesNotMatch(read(file), /serviceWorker|Notification\.requestPermission|PushManager/, file);
    }
  });
});

describe('date groups: one helper for the bell panel and the 알림 page (the mobile local-calendar rules)', () => {
  const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
  const keys = (now: Date, ...times: string[]) => times.map(createdAtUtc => notificationGroupOf(createdAtUtc, now));

  it('today / yesterday are calendar dates, not 24 hours', () => {
    const justAfterMidnight = new Date(2026, 9, 13, 0, 30);
    assert.deepEqual(keys(justAfterMidnight, local(2026, 10, 13, 0, 1), local(2026, 10, 12, 23, 50), local(2026, 10, 12, 0, 0)), ['today', 'yesterday', 'yesterday'], '40 minutes ago but before midnight is 어제');
    const evening = new Date(2026, 9, 13, 20, 0);
    assert.equal(notificationGroupOf(local(2026, 10, 13, 0, 1), evening), 'today', '20 hours ago on the same date is 오늘');
    assert.equal(notificationGroupOf(local(2026, 10, 12, 23, 59), evening), 'yesterday');
    assert.equal(notificationGroupOf(local(2026, 10, 11, 23, 59), evening), 'last7Days', 'the day before yesterday is no longer 어제');
  });

  it('최근 7일 / 최근 30일 / 이전 알림 start at local midnights 7 and 30 days back, each row in exactly one group', () => {
    const now = new Date(2026, 9, 13, 9, 0);
    assert.deepEqual(keys(now, local(2026, 10, 6, 0, 0), local(2026, 10, 5, 23, 59)), ['last7Days', 'last30Days']);
    assert.deepEqual(keys(now, local(2026, 9, 13, 0, 0), local(2026, 9, 12, 23, 59)), ['last30Days', 'older']);
  });

  it('month and year boundaries', () => {
    const newYear = new Date(2027, 0, 1, 0, 10);
    assert.deepEqual(
      keys(newYear, local(2027, 1, 1, 0, 0), local(2026, 12, 31, 23, 59), local(2026, 12, 25, 0, 0), local(2026, 12, 24, 23, 59), local(2026, 12, 2, 0, 0), local(2026, 12, 1, 23, 59)),
      ['today', 'yesterday', 'last7Days', 'last30Days', 'last30Days', 'older'],
    );
    const marchFirst = new Date(2027, 2, 1, 8, 0);
    assert.equal(notificationGroupOf(local(2027, 2, 28, 23, 0), marchFirst), 'yesterday', 'February has 28 days');
  });

  it('the browser\'s own time zone decides the date (same instant, different groups; DST never shifts a day)', () => {
    const script = `
      import { notificationGroupOf } from ${JSON.stringify(new URL('../lib/notifications.ts', import.meta.url).href)};
      const now = new Date(process.argv[1]);
      console.log(JSON.stringify(process.argv.slice(2).map(at => notificationGroupOf(at, now))));`;
    const run = (tz: string, now: string, ...at: string[]) => {
      const out = execFileSync(process.execPath, ['--input-type=module', '-e', script, now, ...at], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
      return JSON.parse(out.trim().split('\n').pop()!);
    };
    // 2026-10-12 15:30 UTC is 10-13 00:30 in Seoul but 10-12 08:30 in Los Angeles; the alert came at 10-12 14:50 UTC.
    assert.deepEqual(run('Asia/Seoul', '2026-10-12T15:30:00Z', '2026-10-12T14:50:00Z'), ['yesterday'], 'Seoul: before its midnight');
    assert.deepEqual(run('America/Los_Angeles', '2026-10-12T15:30:00Z', '2026-10-12T14:50:00Z'), ['today'], 'Los Angeles: the same date');
    // New York leaves DST on 2026-11-01: 11-02 00:30 EST; an alert at 11-01 00:10 EDT (more than 24 h before) is still 어제.
    assert.deepEqual(run('America/New_York', '2026-11-02T05:30:00Z', '2026-11-01T04:10:00Z', '2026-10-31T23:00:00Z'), ['yesterday', 'last7Days']);
  });

  it('only groups that have rows, in order; rows keep the newest-first order inside a group', () => {
    const now = new Date(2026, 9, 13, 12, 0);
    const groups = groupNotifications([row(9, { createdAtUtc: local(2026, 10, 13, 11, 0) }), row(8, { createdAtUtc: local(2026, 10, 13, 9, 0) }), row(7, { createdAtUtc: local(2026, 9, 20, 9, 0) }), row(6, { createdAtUtc: local(2026, 8, 1, 9, 0) })], now);
    assert.deepEqual(groups.map(group => group.key), ['today', 'last30Days', 'older'], 'no empty 어제 / 최근 7일 heading');
    assert.deepEqual(groups[0]!.items.map(item => item.id), [9, 8]);
  });

  it('the bell panel groups its own loaded rows with the same helper and labels as the 알림 page - no second date rule', () => {
    const bell = read('app/(app)/notifications/NotificationBell.tsx');
    const page = read('app/(app)/notifications/NotificationsView.tsx');
    for (const source of [bell, page]) {
      assert.match(source, /groupNotifications\(items\)\.map\(group =>/);
      assert.match(source, /dictionary\[GROUP_LABEL_KEYS\[group\.key\]\]/);
      assert.doesNotMatch(source, /getFullYear|getDate\(|86_?400_?000|24 \* 60 \* 60/, 'no date arithmetic outside lib/notifications.ts');
    }
    assert.match(bell, /<h3 className=\{styles\.bellGroupHeading\} id=\{`\$\{headingId\}-\$\{group\.key\}`\}>/);
    assert.match(bell, /notificationsPagePath\(\{ limit: POPOVER_NOTIFICATION_LIMIT, locale \}\)/, 'the panel still loads only its newest few');
    const css = read('app/(app)/app.module.css');
    assert.match(css, /\.bellGroupHeading \{[^}]*font-size: 12px;/);
    assert.match(css, /\.bellGroup > \.notificationList \{\s*border-top: 1px solid var\(--app-divider\);/);
  });
});
