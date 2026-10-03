import ReactTestRenderer, { act } from 'react-test-renderer';
import { getInitialNotification, onMessage, onNotificationOpenedApp } from '@react-native-firebase/messaging';
import '../../i18n';
import { ApiError } from '../../api/ApiError';
import { navigationRef } from '../../navigation/navigationRef';
import { notificationBannerQueue } from '../../notifications/bannerQueue';
import { getUnreadCount } from '../../notifications/notificationState';
import { subscribeNotificationUnavailable } from '../../notifications/openNotification';
import { subscribeSocialPushEvents } from '../pushEvents';
import { usePushMessageHandling } from '../usePushMessageHandling';

const mockAuth = { isAuthenticated: true, userBootstrapStatus: 'ready' };
/** What GET /notifications/{id} answers, by id: a target, or an error to throw. */
const mockDetails = new Map<number, unknown>();
const mockRequest = jest.fn(async (request: { method: string; path: string }) => {
  if (request.path === '/api/v1/notifications/unread-count') {
    return { status: 200, body: { totalUnread: 3 } };
  }
  const read = /^\/api\/v1\/notifications\/(\d+)\/read$/.exec(request.path);
  if (read) {
    return { status: 200, body: { markedCount: 1, unreadCount: 2 } };
  }
  const detail = /^\/api\/v1\/notifications\/(\d+)\?/.exec(request.path);
  if (detail) {
    const answer = mockDetails.get(Number(detail[1]));
    if (answer instanceof Error) {
      throw answer;
    }
    return { status: 200, body: { id: Number(detail[1]), type: 'x', title: null, body: null, actor: null, collectionName: null, createdAtUtc: '2026-10-02T00:00:00Z', readAtUtc: null, target: answer } };
  }
  throw new Error(`unexpected request ${request.method} ${request.path}`);
});
const mockSignedInRoutes = { value: true };

jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  onMessage: jest.fn(() => () => undefined),
  onNotificationOpenedApp: jest.fn(() => () => undefined),
  getInitialNotification: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => mockRequest }));
jest.mock('../../navigation/navigationRef', () => ({
  navigationRef: {
    isReady: jest.fn(() => true),
    navigate: jest.fn(),
    getRootState: jest.fn(() => ({ routeNames: mockSignedInRoutes.value ? ['MainTabs', 'CollectionDetails'] : ['AuthPending'] })),
    addListener: jest.fn(() => () => undefined),
  },
}));

function Host() {
  usePushMessageHandling();
  return null;
}

let renderer: ReactTestRenderer.ReactTestRenderer | null = null;

async function mount() {
  await act(async () => {
    renderer = ReactTestRenderer.create(<Host />);
  });
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 5; index++) {
      await Promise.resolve();
    }
  });
}

function tapHandler() {
  return jest.mocked(onNotificationOpenedApp).mock.calls[0][1] as (message: unknown) => void;
}

function foregroundHandler() {
  return jest.mocked(onMessage).mock.calls[0][1] as (message: unknown) => void;
}

function readCalls() {
  return mockRequest.mock.calls.filter(([request]) => request.method === 'POST');
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  jest.clearAllMocks();
  mockDetails.clear();
  mockAuth.isAuthenticated = true;
  mockSignedInRoutes.value = true;
  notificationBannerQueue.clear();
});

describe('usePushMessageHandling', () => {
  it('a foreground refresh-only message refreshes open screens - no banner, no navigation', async () => {
    await mount();
    const received: string[] = [];
    const unsubscribe = subscribeSocialPushEvents(event => received.push(event.type));

    act(() => {
      foregroundHandler()({ data: { type: 'collectionContentChanged', collectionId: '7' } });
      foregroundHandler()({ data: { type: 'somethingElse' } });
    });
    unsubscribe();

    expect(received).toEqual(['collectionContentChanged']);
    expect(notificationBannerQueue.current()).toBeNull();
    expect(navigationRef.navigate).not.toHaveBeenCalled();
  });

  it('a Collection refresh signal withdraws the approval-request banners whose notification no longer exists - exactly those, on screen or queued', async () => {
    mockDetails.set(155, new ApiError('notFound', 404, 'gone')); // cancelled by its requester: deleted on the server
    mockDetails.set(156, { kind: 'collectionSubmissions', collectionId: 7 }); // another request, still there
    mockDetails.set(158, new ApiError('notFound', 404, 'gone')); // a cancelled request of ANOTHER Collection
    await mount();
    const banner = (id: number, type: string, collectionId: string) => ({
      key: `n:${id}`,
      notificationId: id,
      type,
      title: `t${id}`,
      body: 'b',
      data: { type, collectionId, notificationId: String(id) },
    });
    act(() => {
      notificationBannerQueue.enqueue(banner(155, 'collectionLinkSubmission', '7'));
      notificationBannerQueue.enqueue(banner(156, 'collectionLinkSubmission', '7'));
      notificationBannerQueue.enqueue(banner(157, 'collectionItemComment', '7'));
      notificationBannerQueue.enqueue(banner(158, 'collectionLinkSubmission', '8'));
    });
    mockRequest.mockClear();

    act(() => {
      foregroundHandler()({ data: { type: 'collectionContentChanged', collectionId: '7' } });
    });
    await flush();

    expect(notificationBannerQueue.all().map(entry => entry.notificationId)).toEqual([156, 157, 158]);
    // Only the approval-request banners of THAT Collection were asked about - by their own ids.
    const asked = mockRequest.mock.calls.map(([request]) => request.path).filter(path => /^\/api\/v1\/notifications\/\d+\?/.test(path));
    expect(asked.map(path => /notifications\/(\d+)/.exec(path)![1]).sort()).toEqual(['155', '156']);
    expect(navigationRef.navigate).not.toHaveBeenCalled();
  });

  it('a banner is kept when the check itself fails (offline) - it is only a banner, the Inbox is the truth', async () => {
    mockDetails.set(255, new ApiError('unavailable'));
    await mount();
    act(() => {
      notificationBannerQueue.enqueue({ key: 'n:255', notificationId: 255, type: 'collectionLinkSubmission', title: 't', body: 'b', data: { collectionId: '7' } });
    });

    act(() => {
      foregroundHandler()({ data: { type: 'collectionContentChanged', collectionId: '7' } });
    });
    await flush();

    expect(notificationBannerQueue.current()?.notificationId).toBe(255);
  });

  it('a visible foreground Push becomes one in-app banner (a replay of it does not), and nothing is read or opened', async () => {
    await mount();
    const message = {
      messageId: 'm1',
      notification: { title: '새 댓글', body: 'Kim님이 회원님의 링크에 댓글을 남겼어요.' },
      data: { type: 'collectionItemComment', collectionId: '7', notificationId: '55' },
    };

    act(() => {
      foregroundHandler()(message);
      foregroundHandler()({ ...message, messageId: 'm1-replayed' });
    });
    await flush();

    expect(notificationBannerQueue.current()).toEqual(expect.objectContaining({ notificationId: 55, title: '새 댓글' }));
    expect(notificationBannerQueue.pendingCount()).toBe(0);
    expect(navigationRef.navigate).not.toHaveBeenCalled();
    expect(readCalls()).toHaveLength(0);
    expect(getUnreadCount()).toBe(3);
  });

  it('a tap with a notificationId opens its exact current target and marks it read', async () => {
    mockDetails.set(55, { kind: 'collectionItem', collectionId: 7, itemId: 99, focus: 'comments' });
    await mount();

    act(() => tapHandler()({ data: { type: 'collectionItemComment', collectionId: '7', notificationId: '55' } }));
    await flush();

    expect(navigationRef.navigate).toHaveBeenCalledWith('CollectionDetails', expect.objectContaining({
      collectionId: 7,
      openItem: { itemId: 99, focus: 'comments' },
    }));
    expect(readCalls().map(([request]) => request.path)).toEqual(['/api/v1/notifications/55/read']);
  });

  it('a tap whose notification is not this account\'s is dropped silently', async () => {
    mockDetails.set(56, new ApiError('notFound', 404));
    await mount();

    act(() => tapHandler()({ data: { type: 'friendRequest', notificationId: '56' } }));
    await flush();

    expect(navigationRef.navigate).not.toHaveBeenCalled();
    expect(readCalls()).toHaveLength(0);
  });

  it('a target that is gone shows the shared notice instead of navigating', async () => {
    mockDetails.set(57, { kind: 'unavailable' });
    const unavailable = jest.fn();
    const unsubscribe = subscribeNotificationUnavailable(unavailable);
    await mount();

    act(() => tapHandler()({ data: { type: 'collectionItemReaction', collectionId: '7', notificationId: '57' } }));
    await flush();
    unsubscribe();

    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(navigationRef.navigate).not.toHaveBeenCalled();
  });

  it('when the lookup fails (offline), the Push\'s own routing ids still lead somewhere safe', async () => {
    mockDetails.set(58, new ApiError('unavailable'));
    await mount();

    act(() => tapHandler()({ data: { type: 'collectionLinkSubmission', collectionId: '9', notificationId: '58' } }));
    await flush();

    expect(navigationRef.navigate).toHaveBeenCalledWith('CollectionDetails', expect.objectContaining({ collectionId: 9, openApprovals: true }));
  });

  it('an older Push without notificationId routes by its legacy fields', async () => {
    await mount();
    const tap = tapHandler();
    const open = async (data: Record<string, string>, messageId: string) => {
      act(() => tap({ messageId, data }));
      await flush();
    };

    await open({ type: 'friendRequest' }, 'a');
    expect(navigationRef.navigate).toHaveBeenLastCalledWith('Friends');
    await open({ type: 'collectionInvitation', collectionId: '3' }, 'b');
    expect(navigationRef.navigate).toHaveBeenLastCalledWith('MainTabs', {
      screen: 'Collections',
      params: expect.objectContaining({ filter: 'shared', openShareRequests: true }),
    });
    await open({ type: 'collectionItemReaction', collectionId: '7' }, 'c');
    expect(navigationRef.navigate).toHaveBeenLastCalledWith('CollectionDetails', expect.objectContaining({ collectionId: 7 }));
    await open({ type: 'collectionLinkSubmissionRejected', publicId: 'AbCdEfGh1234' }, 'd');
    expect(navigationRef.navigate).toHaveBeenLastCalledWith('SharedCollection', { publicId: 'AbCdEfGh1234' });

    // Nowhere safe to go (public link off, no membership): the app just opens.
    jest.mocked(navigationRef.navigate).mockClear();
    await open({ type: 'collectionLinkSubmissionRejected' }, 'e');
    expect(navigationRef.navigate).not.toHaveBeenCalled();
    expect(readCalls()).toHaveLength(0);
  });

  it('a cold-start tap waits for sign-in and the signed-in screens, then opens once - even if reported twice', async () => {
    mockAuth.isAuthenticated = false;
    mockSignedInRoutes.value = false;
    mockDetails.set(60, { kind: 'friendRequests' });
    const coldStart = { messageId: 'cold', data: { type: 'friendRequest', notificationId: '60' } };
    jest.mocked(getInitialNotification).mockResolvedValueOnce(coldStart as never);
    await mount();
    await flush();
    expect(navigationRef.navigate).not.toHaveBeenCalled();

    // Signed in, but the signed-in screens are not mounted yet: still waiting.
    mockAuth.isAuthenticated = true;
    await act(async () => {
      renderer?.update(<Host />);
    });
    await flush();
    expect(navigationRef.navigate).not.toHaveBeenCalled();

    // RootStack swaps to the signed-in screens: the navigator's state listener retries.
    mockSignedInRoutes.value = true;
    const stateListener = jest.mocked(navigationRef.addListener).mock.calls.at(-1)?.[1] as unknown as () => void;
    act(() => stateListener());
    await flush();
    expect(navigationRef.navigate).toHaveBeenCalledTimes(1);
    expect(navigationRef.navigate).toHaveBeenCalledWith('Friends');

    // The same tap also reported by onNotificationOpenedApp: not opened a second time.
    act(() => tapHandler()(coldStart));
    await flush();
    expect(navigationRef.navigate).toHaveBeenCalledTimes(1);
  });
});
