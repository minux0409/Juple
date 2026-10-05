import { ApiError } from '../../api/ApiError';
import i18n from '../../i18n';
import { FRIEND_REQUEST_NO_LONGER_PENDING, getFriendRequestErrorMessage } from '../AddFriendModal';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

const t = i18n.t.bind(i18n);

describe('getFriendRequestErrorMessage', () => {
  it('a stale accept / decline of a request its sender cancelled says so - never "no such Juple ID"', () => {
    const stale = new ApiError('notFound', 404, FRIEND_REQUEST_NO_LONGER_PENDING);
    expect(getFriendRequestErrorMessage(stale, t, 'answer')).toBe('요청자가 친구 요청을 취소했어요.');
    expect(getFriendRequestErrorMessage(stale, t, 'answer')).not.toBe(t('collaboration.lookupNotFound'));
  });

  it('a stale cancel of my own request (it was answered meanwhile) says it was already handled', () => {
    const stale = new ApiError('notFound', 404, FRIEND_REQUEST_NO_LONGER_PENDING);
    expect(getFriendRequestErrorMessage(stale, t, 'cancel')).toBe(t('friends.requestNoLongerPending'));
  });

  it('a plain not-found while looking someone up is still "no such Juple ID"', () => {
    expect(getFriendRequestErrorMessage(new ApiError('notFound', 404), t)).toBe(t('collaboration.lookupNotFound'));
    expect(getFriendRequestErrorMessage(new ApiError('notFound', 404), t, 'answer')).toBe(t('collaboration.lookupNotFound'));
  });

  it('keeps the other messages', () => {
    expect(getFriendRequestErrorMessage(new ApiError('conflict', 409, 'alreadyFriends'), t)).toBe(t('friends.alreadyFriends'));
    expect(getFriendRequestErrorMessage(new ApiError('tooManyRequests', 429), t)).toBe(t('collaboration.tooManyRequests'));
    expect(getFriendRequestErrorMessage(new Error('x'), t)).toBe(t('friends.actionFallback'));
  });
});
