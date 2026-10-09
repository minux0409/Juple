import { parseSocialPushEvent } from '../../push/pushEvents';
import { legacyPushTarget, navigationActionFor, parseNotificationTarget } from '../notificationTarget';

const NOW = 1_700_000_000_000;

describe('join request notification targets', () => {
  it('the Owner\'s request goes through the Collection to the 참가 요청 tab', () => {
    const target = parseNotificationTarget({ kind: 'collectionJoinRequests', collectionId: 42 });

    expect(target).toEqual({ kind: 'collectionJoinRequests', collectionId: 42 });
    // Through the Collection (its lock gate first) - never straight to the share screen.
    expect(navigationActionFor(target, NOW)).toEqual({ name: 'CollectionDetails', params: { collectionId: 42, refreshToken: NOW, openJoinRequests: true } });
  });

  it('without a Collection id there is nothing to open', () => {
    expect(parseNotificationTarget({ kind: 'collectionJoinRequests' })).toEqual({ kind: 'unavailable' });
  });

  it('an approved request opens the normal Collection; a declined one the public link while it is on', () => {
    expect(navigationActionFor(parseNotificationTarget({ kind: 'collection', collectionId: 42 }), NOW)).toEqual({
      name: 'CollectionDetails',
      params: { collectionId: 42, refreshToken: NOW },
    });
    expect(navigationActionFor(parseNotificationTarget({ kind: 'publicCollection', publicId: 'AbCdEfGh12345678' }), NOW)).toEqual({
      name: 'SharedCollection',
      params: { publicId: 'AbCdEfGh12345678' },
    });
  });

  it('all three Push types are recognized and carry ids only', () => {
    expect(parseSocialPushEvent({ type: 'joinRequest', collectionId: '42' })).toEqual({ type: 'joinRequest', collectionId: 42, publicId: null });
    expect(parseSocialPushEvent({ type: 'joinRequestApproved', collectionId: '42' })).toEqual({ type: 'joinRequestApproved', collectionId: 42, publicId: null });
    expect(parseSocialPushEvent({ type: 'joinRequestRejected', publicId: 'AbCdEfGh12345678', name: 'secret' })).toEqual({
      type: 'joinRequestRejected',
      collectionId: null,
      publicId: 'AbCdEfGh12345678',
    });
  });

  it('a Push without the notification lookup still opens the right place', () => {
    expect(legacyPushTarget({ type: 'joinRequest', collectionId: '42' })).toEqual({ kind: 'collectionJoinRequests', collectionId: 42 });
    expect(legacyPushTarget({ type: 'joinRequestApproved', collectionId: '42' })).toEqual({ kind: 'collection', collectionId: 42 });
    expect(legacyPushTarget({ type: 'joinRequestRejected', publicId: 'AbCdEfGh12345678' })).toEqual({ kind: 'publicCollection', publicId: 'AbCdEfGh12345678' });
    expect(legacyPushTarget({ type: 'joinRequest' })).toBeNull();
  });
});
