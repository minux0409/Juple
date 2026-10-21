import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppState, Platform } from 'react-native';
import { getMessaging, onTokenRefresh } from '@react-native-firebase/messaging';
import { syncPushRegistration } from '../pushRegistrationSync';
import { usePushRegistrationSync } from '../usePushRegistrationSync';
import { reportPushSync } from '../pushRegistrationStatus';
import { subscribeApnsTokenChanged } from '../apnsPush';

const mockUnsubscribe = jest.fn();
const mockRequest = jest.fn();

jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  onTokenRefresh: jest.fn(() => mockUnsubscribe),
}));
const mockApnsUnsubscribe = jest.fn();
jest.mock('../apnsPush', () => ({ subscribeApnsTokenChanged: jest.fn(() => mockApnsUnsubscribe) }));
jest.mock('../pushRegistrationSync', () => ({
  syncPushRegistration: jest.fn(() => Promise.resolve('registered')),
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
const originalAppState = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
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
  Object.defineProperty(AppState, 'currentState', originalAppState);
  jest.clearAllMocks();
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.mocked(syncPushRegistration).mockResolvedValue('registered');
  reportPushSync('idle');
});

describe('usePushRegistrationSync', () => {
  it('waits for Retry-After when the server asks for longer than the normal retry delay', async () => {
    jest.useFakeTimers();
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    jest.mocked(syncPushRegistration).mockImplementation(async () => reportPushSync('registrationFailed', 429, 120));
    await mount();
    await act(async () => { jest.advanceTimersByTime(119_999); });
    expect(syncPushRegistration).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(syncPushRegistration).toHaveBeenCalledTimes(2);
  });
  it('retries transient failure at bounded intervals and releases timers on unmount', async () => {
    jest.useFakeTimers();
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    jest.mocked(syncPushRegistration).mockResolvedValue('tokenFailed');
    await mount();
    for (const [index, delay] of [15_000, 60_000, 180_000].entries()) {
      await act(async () => { jest.advanceTimersByTime(delay - 1); });
      expect(syncPushRegistration).toHaveBeenCalledTimes(index + 1);
      await act(async () => { jest.advanceTimersByTime(1); });
      expect(syncPushRegistration).toHaveBeenCalledTimes(index + 2);
    }
    expect(syncPushRegistration).toHaveBeenCalledTimes(4);
    await act(async () => { jest.advanceTimersByTime(600_000); });
    expect(syncPushRegistration).toHaveBeenCalledTimes(4);
    const refreshed = jest.mocked(onTokenRefresh).mock.calls[0][1] as (token: string) => void;
    await act(async () => { refreshed('synthetic-refresh'); });
    expect(syncPushRegistration).toHaveBeenCalledTimes(5);
    act(() => renderer?.unmount()); renderer = null;
    await act(async () => { jest.advanceTimersByTime(600_000); });
    expect(syncPushRegistration).toHaveBeenCalledTimes(5);
  });

  it('does not keep retrying a denied permission', async () => {
    jest.useFakeTimers();
    jest.mocked(syncPushRegistration).mockResolvedValue('permissionDenied');
    await mount();
    await act(async () => { jest.advanceTimersByTime(600_000); });
    expect(syncPushRegistration).toHaveBeenCalledTimes(1);
  });

  it('on Android syncs at bootstrap and re-registers a refreshed FCM token', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    await mount();

    expect(syncPushRegistration).toHaveBeenCalledWith(mockRequest, expect.any(Function));
    expect(onTokenRefresh).toHaveBeenCalledTimes(1);
    const listener = jest.mocked(onTokenRefresh).mock.calls[0][1] as (token: string) => void;
    listener('token-2');
    expect(syncPushRegistration).toHaveBeenCalledTimes(2);

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

  it('on iOS re-syncs when the APNs token changes and stops listening on unmount', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

    await mount();
    expect(syncPushRegistration).toHaveBeenCalledTimes(1);
    const changed = jest.mocked(subscribeApnsTokenChanged).mock.calls[0][0];
    await act(async () => { changed(); });
    expect(syncPushRegistration).toHaveBeenCalledTimes(2);

    act(() => renderer?.unmount());
    renderer = null;
    expect(mockApnsUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
