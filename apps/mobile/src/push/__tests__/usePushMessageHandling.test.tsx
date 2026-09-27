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

  it('a cold-start tap waits until the user is signed in and bootstrapped', async () => {
    mockAuth.isAuthenticated = false;
    jest.mocked(getInitialNotification).mockResolvedValueOnce({ data: { type: 'friendRequest' } } as never);
    await mount();
    expect(navigationRef.navigate).not.toHaveBeenCalled();
  });
});
