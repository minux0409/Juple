import ReactTestRenderer, { act } from 'react-test-renderer';
import { Platform } from 'react-native';
import { getMessaging, onTokenRefresh } from '@react-native-firebase/messaging';
import { registerRefreshedPushToken, syncPushRegistrationIfPermitted } from '../pushRegistrationSync';
import { usePushRegistrationSync } from '../usePushRegistrationSync';

const mockUnsubscribe = jest.fn();
const mockRequest = jest.fn();

jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  onTokenRefresh: jest.fn(() => mockUnsubscribe),
}));
jest.mock('../pushRegistrationSync', () => ({
  syncPushRegistrationIfPermitted: jest.fn(() => Promise.resolve()),
  registerRefreshedPushToken: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, userBootstrapStatus: 'ready' }),
}));
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => mockRequest }));
jest.mock('../../i18n', () => ({ __esModule: true, default: { on: jest.fn(), off: jest.fn() } }));

function Host() {
  usePushRegistrationSync();
  return null;
}

const originalOS = Platform.OS;
let renderer: ReactTestRenderer.ReactTestRenderer | null = null;

async function mount() {
  await act(async () => {
    renderer = ReactTestRenderer.create(<Host />);
  });
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  jest.clearAllMocks();
});

describe('usePushRegistrationSync', () => {
  it('on Android syncs at bootstrap and re-registers a refreshed FCM token', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    await mount();

    expect(syncPushRegistrationIfPermitted).toHaveBeenCalledWith(mockRequest);
    expect(onTokenRefresh).toHaveBeenCalledTimes(1);
    const listener = jest.mocked(onTokenRefresh).mock.calls[0][1] as (token: string) => void;
    listener('token-2');
    expect(registerRefreshedPushToken).toHaveBeenCalledWith(mockRequest, 'token-2');

    act(() => renderer?.unmount());
    renderer = null;
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('on iOS never subscribes to FCM token refresh (no FCM there)', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

    await mount();

    expect(getMessaging).not.toHaveBeenCalled();
    expect(onTokenRefresh).not.toHaveBeenCalled();
  });
});
