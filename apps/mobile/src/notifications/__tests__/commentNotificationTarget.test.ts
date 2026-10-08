import { parseSocialPushEvent } from '../../push/pushEvents';
import { legacyPushTarget, navigationActionFor, parseNotificationTarget } from '../notificationTarget';

const NOW = 1_700_000_000_000;

describe('reply / heart notification targets', () => {
  it('my own link: the owner\'s link screen, comments in focus, with the thread to open', () => {
    const target = parseNotificationTarget({ kind: 'collectionItem', collectionId: 42, itemId: 77, focus: 'comments', commentId: 500, rootCommentId: 480 });

    expect(target).toEqual({ kind: 'collectionItem', collectionId: 42, itemId: 77, focus: 'comments', commentRootId: 480 });
    expect(navigationActionFor(target, NOW)).toEqual({
      name: 'CollectionDetails',
      params: { collectionId: 42, refreshToken: NOW, openItem: { itemId: 77, focus: 'comments', commentRootId: 480 } },
    });
  });

  it('somebody else\'s link: the shared view, marked so the Collection opens it there', () => {
    const target = parseNotificationTarget({ kind: 'collectionSharedItem', collectionId: 42, itemId: 77, focus: 'comments', commentId: 500, rootCommentId: 500 });

    expect(target).toEqual({ kind: 'collectionSharedItem', collectionId: 42, itemId: 77, focus: 'comments', commentRootId: 500 });
    expect(navigationActionFor(target, NOW)).toEqual({
      name: 'CollectionDetails',
      params: { collectionId: 42, refreshToken: NOW, openItem: { itemId: 77, focus: 'comments', commentRootId: 500, shared: true } },
    });
  });

  it('falls back to the comment id when the server sent no root, and ignores a malformed one', () => {
    expect(parseNotificationTarget({ kind: 'collectionSharedItem', collectionId: 1, itemId: 2, focus: 'comments', commentId: 9 })).toEqual(
      expect.objectContaining({ commentRootId: 9 }),
    );
    const malformed = parseNotificationTarget({ kind: 'collectionSharedItem', collectionId: 1, itemId: 2, focus: 'comments', rootCommentId: -4, commentId: 0 });
    expect(malformed).toEqual({ kind: 'collectionSharedItem', collectionId: 1, itemId: 2, focus: 'comments' });
  });

  it('is unavailable without a Collection id, and only the Collection when the link id is missing - never a half-built navigation', () => {
    expect(parseNotificationTarget({ kind: 'collectionSharedItem', itemId: 2 })).toEqual({ kind: 'unavailable' });
    expect(parseNotificationTarget({ kind: 'collectionSharedItem', collectionId: 42 })).toEqual({ kind: 'collection', collectionId: 42 });
  });

  it('an older Push (no notification lookup) opens the Collection - coarser, never wrong', () => {
    for (const type of ['commentReply', 'commentLike']) {
      expect(legacyPushTarget({ type, collectionId: '42' })).toEqual({ kind: 'collection', collectionId: 42 });
      expect(legacyPushTarget({ type })).toBeNull();
    }
  });

  it('both Push types are recognized, carrying ids only', () => {
    expect(parseSocialPushEvent({ type: 'commentReply', collectionId: '42' })).toEqual({ type: 'commentReply', collectionId: 42, publicId: null });
    expect(parseSocialPushEvent({ type: 'commentLike', collectionId: '42', commentText: 'secret' })).toEqual({ type: 'commentLike', collectionId: 42, publicId: null });
  });
});
