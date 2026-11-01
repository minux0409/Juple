import { bindMobileAttention, createMobileAttentionStore } from '../mobileAttention';
import { getReceivedCollectionInvitations, acceptCollectionInvitation, declineCollectionInvitation } from '../../collections/api/collaborationApi';
import { getFriendRequests, acceptFriendRequest, declineFriendRequest } from '../../friends/api/friendsApi';
import { markAllNotificationsRead } from '../../notifications/notificationsApi';
import { approveCollectionSubmission, getCollection } from '../../collections/api/collectionsApi';
import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';

it('uses the same source for cards, tabs and nav; answers update immediately and read-all does not answer requests', async () => {
  let invitations = [1, 2];
  let friends = [1, 2];
  let newLinks = 1;
  const calls: string[] = [];
  const request = (async ({ path, method = 'GET' }: { path: string; method?: string }) => {
    calls.push(`${method} ${path}`);
    if (path === '/api/v1/users/me/collection-invitations') return { body: { items: invitations.map(invitationId => ({ invitationId })) } };
    if (path === '/api/v1/friends/requests') return { body: { items: friends.map(requestId => ({ requestId, direction: 'incoming' })) } };
    if (path.startsWith('/api/v1/collections?')) return { body: { items: [{ id: 5, isFavorite: true, attentionCount: 2 + newLinks, unreadNewLinkCount: newLinks }], nextCursor: null } };
    if (path === '/api/v1/notifications/read-all') { newLinks = 0; return { body: { markedCount: 99, unreadCount: 0 } }; }
    if (path.startsWith('/api/v1/collection-invitations/')) invitations = invitations.filter(id => id !== Number(path.split('/')[4]));
    if (path.startsWith('/api/v1/friends/requests/')) friends = friends.filter(id => id !== Number(path.split('/')[5]));
    return { body: { friendshipId: 1 } };
  }) as AuthenticatedApiRequest;
  const store = createMobileAttentionStore(request);
  const unbind = bindMobileAttention(store, request);
  try {
    await Promise.all([store.refresh(), getReceivedCollectionInvitations(request), getFriendRequests(request)]);
    expect(calls.filter(call => call === 'GET /api/v1/users/me/collection-invitations')).toHaveLength(1);
    expect(calls.filter(call => call === 'GET /api/v1/friends/requests')).toHaveLength(1);
    expect(store.getSnapshot().counts.collections).toBe(5);
    await markAllNotificationsRead(request);
    expect(store.getSnapshot().counts.collections).toBe(4);
    expect(store.getSnapshot().counts.myPage).toBe(2);
    await declineCollectionInvitation(request, 1);
    expect(store.getSnapshot().counts.collections).toBe(3);
    await acceptCollectionInvitation(request, 2);
    expect(store.getSnapshot().invitations).toHaveLength(0);
    await acceptFriendRequest(request, 1);
    expect(store.getSnapshot().counts.myPage).toBe(1);
    await declineFriendRequest(request, 2);
    expect(store.getSnapshot().counts.myPage).toBe(0);
  } finally { unbind(); }
  expect(store.getSnapshot().counts.collections).toBe(0);
});

it('shares cached navigation/foreground reads for 60 seconds and performs only one refresh at expiry', async () => {
  jest.useFakeTimers();
  const calls = jest.fn();
  const request: AuthenticatedApiRequest = async <T>(options: Parameters<AuthenticatedApiRequest>[0]) => {
    calls(options);
    return { status: 200, body: { items: [], nextCursor: null } as T };
  };
  const store = createMobileAttentionStore(request);
  const unbind = bindMobileAttention(store, request);
  try {
    await Promise.all([store.refresh(), getReceivedCollectionInvitations(request), getFriendRequests(request)]);
    expect(calls).toHaveBeenCalledTimes(3);
    for (let visit = 0; visit < 4; visit++) {
      await Promise.all([store.refresh(), getReceivedCollectionInvitations(request), getFriendRequests(request)]);
    }
    jest.advanceTimersByTime(59_999);
    await store.refresh();
    expect(calls).toHaveBeenCalledTimes(3);
    jest.advanceTimersByTime(1);
    await Promise.all([store.refresh(), store.refresh(), getReceivedCollectionInvitations(request), getFriendRequests(request)]);
    expect(calls).toHaveBeenCalledTimes(6);
  } finally { unbind(); jest.useRealTimers(); }
});

describe('받은 승인 요청: the same number on the Collections screen and in the Collection', () => {
  function server(waiting: { count: number }) {
    const calls: string[] = [];
    const row = () => ({ id: 5, name: 'C', isFavorite: false, accessRole: 'owner', pendingSubmissionCount: waiting.count, attentionCount: waiting.count });
    const request = (async ({ path, method = 'GET' }: { path: string; method?: string }) => {
      calls.push(`${method} ${path}`);
      if (path.startsWith('/api/v1/collections?')) return { body: { items: [row()], nextCursor: null } };
      if (path === '/api/v1/collections/5') return { body: row() };
      return { body: { items: [] } };
    }) as AuthenticatedApiRequest;
    return { calls, request, store: createMobileAttentionStore(request) };
  }
  const lists = (calls: readonly string[]) => calls.filter(call => call.startsWith('GET /api/v1/collections?')).length;
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

  it('a Collection that shows another count makes the store ask the server; the same count asks nothing', async () => {
    jest.useFakeTimers();
    const waiting = { count: 0 };
    const { calls, request, store } = server(waiting);
    const unbind = bindMobileAttention(store, request);
    try {
      await store.refresh(['collections']);
      await getCollection(request, 5);
      expect(lists(calls)).toBe(1);
      expect(store.getSnapshot().counts.requests.approvals).toBe(0);

      waiting.count = 1;
      jest.advanceTimersByTime(5000);
      await getCollection(request, 5);
      await flush();
      expect(lists(calls)).toBe(2);
      expect(store.getSnapshot().counts.requests.approvals).toBe(1);
    } finally {
      jest.useRealTimers();
      unbind();
    }
  });

  it('approving or declining re-reads at once and the badge goes away at 0', async () => {
    const waiting = { count: 1 };
    const { request, store } = server(waiting);
    const unbind = bindMobileAttention(store, request);
    try {
      await store.refresh(['collections']);
      expect(store.getSnapshot().counts.requests.approvals).toBe(1);
      waiting.count = 0;
      await approveCollectionSubmission(request, 5, 9);
      await flush();
      expect(store.getSnapshot().counts.requests.approvals).toBe(0);
    } finally {
      unbind();
    }
  });
});
