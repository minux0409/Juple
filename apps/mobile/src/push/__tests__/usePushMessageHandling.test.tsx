import ReactTestRenderer, { act } from 'react-test-renderer';
import { getInitialNotification, onMessage, onNotificationOpenedApp } from '@react-native-firebase/messaging';
import { usePushMessageHandling } from '../usePushMessageHandling';
import { subscribeSocialPushEvents } from '../pushEvents';
import { navigationRef } from '../../navigation/navigationRef';

const mockAuth = { isAuthenticated: true, userBootstrapStatus: 'ready' };

jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  onMessage: jest.fn(() => () => undefined),
  onNotificationOpenedApp: jest.fn(() => () => undefined),
  getInitialNotification: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../../navigation/navigationRef', () => ({
  navigationRef: { isReady: jest.fn(() => true), navigate: jest.fn() },
}));

function Host() {
  usePushMessageHandling();
  return null;
}

async function mount() {
  await act(async () => {
    ReactTestRenderer.create(<Host />);
  });
}

afterEach(() => {
  jest.clearAllMocks();
  mockAuth.isAuthenticated = true;
});

describe('usePushMessageHandling', () => {
  it('a foreground message only refreshes open screens (no navigation)', async () => {
    await mount();
    const received: string[] = [];
    const unsubscribe = subscribeSocialPushEvents(event => received.push(event.type));

    const handler = jest.mocked(onMessage).mock.calls[0][1] as (message: unknown) => void;
    act(() => {
      handler({ data: { type: 'collectionContentChanged', collectionId: '7' } });
      handler({ data: { type: 'somethingElse' } });
    });
    unsubscribe();

    expect(received).toEqual(['collectionContentChanged']);
    expect(navigationRef.navigate).not.toHaveBeenCalled();
  });

  it('a tapped friend request opens Friends; a tapped invitation opens 공유 컬렉션 › 공유 요청', async () => {
    await mount();
    const tap = jest.mocked(onNotificationOpenedApp).mock.calls[0][1] as (message: unknown) => void;

    act(() => tap({ data: { type: 'friendRequest' } }));
    expect(navigationRef.navigate).toHaveBeenLastCalledWith('Friends');

    act(() => tap({ data: { type: 'collectionInvitation', collectionId: '3' } }));
    expect(navigationRef.navigate).toHaveBeenLastCalledWith('MainTabs', {
      screen: 'Collections',
      params: expect.objectContaining({ filter: 'shared', openShareRequests: true }),
    });
  });

  it('collaboration taps: a reaction or comment opens the Collection, a proposal its 승인 대기 list, a result the Collection or its public page', async () => {
    await mount();
    const tap = jest.mocked(onNotificationOpenedApp).mock.calls[0][1] as (message: unknown) => void;

    act(() => tap({ data: { type: 'collectionItemReaction', collectionId: '7' } }));
    expect(navigationRef.navigate).toHaveBeenLastCalledWith('CollectionDetails', expect.objectContaining({ collectionId: 7 }));

    act(() => tap({ data: { type: 'collectionItemComment', collectionId: '8' } }));
    expect(navigationRef.navigate).toHaveBeenLastCalledWith('CollectionDetails', expect.objectContaining({ collectionId: 8 }));

    act(() => tap({ data: { type: 'collectionLinkSubmission', collectionId: '9' } }));
    expect(navigationRef.navigate).toHaveBeenLastCalledWith('CollectionSubmissions', { collectionId: 9 });

    act(() => tap({ data: { type: 'collectionLinkSubmissionApproved', collectionId: '10' } }));
    expect(navigationRef.navigate).toHaveBeenLastCalledWith('CollectionDetails', expect.objectContaining({ collectionId: 10 }));

    act(() => tap({ data: { type: 'collectionLinkSubmissionRejected', publicId: 'AbCdEfGh1234' } }));
    expect(navigationRef.navigate).toHaveBeenLastCalledWith('SharedCollection', { publicId: 'AbCdEfGh1234' });

    // A result with nowhere safe to go (public link off, no membership): the app just opens.
    jest.mocked(navigationRef.navigate).mockClear();
    act(() => tap({ data: { type: 'collectionLinkSubmissionRejected' } }));
    expect(navigationRef.navigate).not.toHaveBeenCalled();
  });

  it('a foreground collaboration message is passed to open screens and never navigates', async () => {
    await mount();
    const received: string[] = [];
    const unsubscribe = subscribeSocialPushEvents(event => received.push(event.type));

    const handler = jest.mocked(onMessage).mock.calls[0][1] as (message: unknown) => void;
    act(() => {
      handler({ data: { type: 'collectionItemComment', collectionId: '7' } });
      handler({ data: { type: 'collectionLinkSubmission', collectionId: '7' } });
    });
    unsubscribe();

    expect(received).toEqual(['collectionItemComment', 'collectionLinkSubmission']);
    expect(navigationRef.navigate).not.toHaveBeenCalled();
  });

  it('a cold-start tap waits until the user is signed in and bootstrapped', async () => {
    mockAuth.isAuthenticated = false;
    jest.mocked(getInitialNotification).mockResolvedValueOnce({ data: { type: 'friendRequest' } } as never);
    await mount();
    expect(navigationRef.navigate).not.toHaveBeenCalled();
  });
});
