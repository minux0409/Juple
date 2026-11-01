import { parseSocialPushEvent } from '../../push/pushEvents';
import { parseModerationNotice } from '../../safety/moderationNoticeApi';
import { legacyPushTarget, navigationActionFor, parseNotificationTarget } from '../notificationTarget';

describe('operator messages (이용 안내 / 신고 처리 결과) as a notification target', () => {
  it('the server target opens the notice by id; a malformed id is unavailable', () => {
    expect(parseNotificationTarget({ kind: 'moderationNotice', noticeId: 7 })).toEqual({ kind: 'moderationNotice', noticeId: 7 });
    expect(parseNotificationTarget({ kind: 'moderationNotice', noticeId: 0 })).toEqual({ kind: 'unavailable' });
    expect(parseNotificationTarget({ kind: 'moderationNotice' })).toEqual({ kind: 'unavailable' });
  });

  it('both push types carry only the notice id, and open it even without the notification lookup', () => {
    expect(parseSocialPushEvent({ type: 'adminWarning', noticeId: '12', reason: 'must never be read from a push' })).toEqual({
      type: 'adminWarning',
      collectionId: null,
      publicId: null,
      noticeId: 12,
    });
    expect(legacyPushTarget({ type: 'adminWarning', noticeId: '12' })).toEqual({ kind: 'moderationNotice', noticeId: 12 });
    expect(legacyPushTarget({ type: 'reportResult', noticeId: '13' })).toEqual({ kind: 'moderationNotice', noticeId: 13 });
    expect(legacyPushTarget({ type: 'adminWarning' })).toBeNull();
  });

  it('navigates to the notice screen', () => {
    expect(navigationActionFor({ kind: 'moderationNotice', noticeId: 7 })).toEqual({ name: 'ModerationNotice', params: { noticeId: 7 } });
  });

  it('reads a notice from the server answer and ignores anything else', () => {
    expect(parseModerationNotice({ id: 3, kind: 'warning', reason: 'r', guidance: 'g', createdAtUtc: '2026-11-01T00:00:00Z', acknowledgedAtUtc: null })).toEqual({
      id: 3,
      kind: 'warning',
      reason: 'r',
      guidance: 'g',
      createdAtUtc: '2026-11-01T00:00:00Z',
      acknowledgedAtUtc: null,
    });
    expect(parseModerationNotice({ id: 4, kind: 'reportResult', createdAtUtc: 'x' })?.reason).toBeNull();
    expect(parseModerationNotice({ id: 5, kind: 'other', createdAtUtc: 'x' })).toBeNull();
    expect(parseModerationNotice(null)).toBeNull();
  });
});
