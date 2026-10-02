import {
  legacyPushTarget,
  navigationActionFor,
  notificationIdOf,
  parseNotificationTarget,
  type NotificationTarget,
} from '../notificationTarget';

const NOW = 1_700_000_000_000;

/**
 * The one canonical mapping, table-driven for every notification Type: what the server's target
 * turns into, and the exact navigator call it makes - the same for an OS Push tap, the banner and
 * an Inbox row (none of them has a switch of its own).
 */
describe('notification targets', () => {
  const table: ReadonlyArray<readonly [string, unknown, NotificationTarget, unknown]> = [
    ['friendRequest', { kind: 'friendRequests' }, { kind: 'friendRequests' }, { name: 'Friends' }],
    [
      'collectionInvitation (waiting)',
      { kind: 'collectionInvitations', collectionId: 3 },
      { kind: 'collectionInvitations' },
      { name: 'MainTabs', params: { screen: 'Collections', params: { filter: 'shared', openShareRequests: true, refreshToken: NOW } } },
    ],
    [
      'collectionItemsAdded / approved / rejected (member)',
      { kind: 'collection', collectionId: 42 },
      { kind: 'collection', collectionId: 42 },
      { name: 'CollectionDetails', params: { collectionId: 42, refreshToken: NOW } },
    ],
    [
      'collectionItemReaction',
      { kind: 'collectionItem', collectionId: 42, itemId: 77, focus: null },
      { kind: 'collectionItem', collectionId: 42, itemId: 77, focus: null },
      { name: 'CollectionDetails', params: { collectionId: 42, refreshToken: NOW, openItem: { itemId: 77, focus: null } } },
    ],
    [
      'collectionItemComment (comments in view)',
      { kind: 'collectionItem', collectionId: 42, itemId: 77, focus: 'comments' },
      { kind: 'collectionItem', collectionId: 42, itemId: 77, focus: 'comments' },
      { name: 'CollectionDetails', params: { collectionId: 42, refreshToken: NOW, openItem: { itemId: 77, focus: 'comments' } } },
    ],
    [
      'collectionLinkSubmission (approval queue)',
      { kind: 'collectionSubmissions', collectionId: 42 },
      { kind: 'collectionSubmissions', collectionId: 42 },
      { name: 'CollectionSubmissions', params: { collectionId: 42 } },
    ],
    [
      'collectionLinkShared / a non-member proposal result',
      { kind: 'publicCollection', publicId: 'AbCdEfGh1234' },
      { kind: 'publicCollection', publicId: 'AbCdEfGh1234' },
      { name: 'SharedCollection', params: { publicId: 'AbCdEfGh1234' } },
    ],
    ['anything no longer reachable', { kind: 'unavailable' }, { kind: 'unavailable' }, null],
  ];

  it.each(table)('%s', (_label, wire, target, action) => {
    expect(parseNotificationTarget(wire as never)).toEqual(target);
    expect(navigationActionFor(target, NOW)).toEqual(action);
  });

  it('malformed or unknown targets never become a half-built navigation', () => {
    expect(parseNotificationTarget(null)).toEqual({ kind: 'unavailable' });
    expect(parseNotificationTarget({ kind: 'somethingNew', collectionId: 1 })).toEqual({ kind: 'unavailable' });
    expect(parseNotificationTarget({ kind: 'collection', collectionId: -1 })).toEqual({ kind: 'unavailable' });
    expect(parseNotificationTarget({ kind: 'collection', collectionId: 1.5 })).toEqual({ kind: 'unavailable' });
    expect(parseNotificationTarget({ kind: 'collectionSubmissions' })).toEqual({ kind: 'unavailable' });
    expect(parseNotificationTarget({ kind: 'publicCollection', publicId: '../evil' })).toEqual({ kind: 'unavailable' });
    // A link without a usable id still opens its Collection rather than nothing.
    expect(parseNotificationTarget({ kind: 'collectionItem', collectionId: 4, itemId: 0 })).toEqual({ kind: 'collection', collectionId: 4 });
    // Only 'comments' is a focus.
    expect(parseNotificationTarget({ kind: 'collectionItem', collectionId: 4, itemId: 5, focus: 'memo' }))
      .toEqual({ kind: 'collectionItem', collectionId: 4, itemId: 5, focus: null });
  });

  it('reads a Push\'s notificationId only when it is a positive integer', () => {
    expect(notificationIdOf({ notificationId: '1234' })).toBe(1234);
    expect(notificationIdOf({ notificationId: 'abc' })).toBeNull();
    expect(notificationIdOf({ notificationId: '-3' })).toBeNull();
    expect(notificationIdOf({})).toBeNull();
    expect(notificationIdOf(null)).toBeNull();
  });

  it('an older Push (no notificationId) still routes by its Type and ids - coarser, never wrong', () => {
    expect(legacyPushTarget({ type: 'friendRequest' })).toEqual({ kind: 'friendRequests' });
    expect(legacyPushTarget({ type: 'collectionInvitation', collectionId: '3' })).toEqual({ kind: 'collectionInvitations' });
    expect(legacyPushTarget({ type: 'collectionItemComment', collectionId: '7' })).toEqual({ kind: 'collection', collectionId: 7 });
    expect(legacyPushTarget({ type: 'collectionLinkSubmission', collectionId: '9' })).toEqual({ kind: 'collectionSubmissions', collectionId: 9 });
    expect(legacyPushTarget({ type: 'collectionLinkSubmissionApproved', publicId: 'AbCdEfGh1234' })).toEqual({ kind: 'publicCollection', publicId: 'AbCdEfGh1234' });
    // Refresh-only, unknown or id-less: nothing to open.
    expect(legacyPushTarget({ type: 'collectionContentChanged', collectionId: '7' })).toBeNull();
    expect(legacyPushTarget({ type: 'collectionItemsAdded', collectionId: 'x' })).toBeNull();
    expect(legacyPushTarget({ type: 'nope' })).toBeNull();
  });
});
