import ReactTestRenderer, { act } from 'react-test-renderer';
import { Platform } from 'react-native';
import { getMessaging } from '@react-native-firebase/messaging';
import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';
import { notificationBannerQueue } from '../../notifications/bannerQueue';
import { navigationRef } from '../../navigation/navigationRef';
import { registerPushDevice } from '../api/pushDevicesApi';
import {
  consumeInitialApnsMessage,
  getApnsToken,
  isApnsPlatform,
  parseApnsMessage,
  subscribeApnsForegroundMessages,
  subscribeApnsTokenChanged,
} from '../apnsPush';
import { getOrCreatePushInstallationId } from '../pushInstallationId';
import { getPushPermissionStatus } from '../pushPermission';
import { syncPushRegistration } from '../pushRegistrationSync';
import { usePushMessageHandling } from '../usePushMessageHandling';

type Listener = (value: string) => void;

/** A stand-in for the NativeApnsIOS TurboModule: events keep their listeners so a test can fire them. */
const mockListeners: Record<'token' | 'foreground' | 'opened', Set<Listener>> = {
  token: new Set(),
  foreground: new Set(),
  opened: new Set(),
};
function mockEmitter(kind: 'token' | 'foreground' | 'opened') {
  return (listener: Listener) => {
    mockListeners[kind].add(listener);
    return { remove: () => mockListeners[kind].delete(listener) };
  };
}
const mockNative = {
  registerForRemoteNotifications: jest.fn(),
  consumeInitialNotification: jest.fn(() => Promise.resolve(null as string | null)),
  onTokenChanged: mockEmitter('token'),
  onForegroundNotification: mockEmitter('foreground'),
  onNotificationOpened: mockEmitter('opened'),
};
const mockDetails = new Map<number, unknown>();
const mockRequest = jest.fn(async (request: { method: string; path: string }) => {
  if (request.path === '/api/v1/notifications/unread-count') {
    return { status: 200, body: { totalUnread: 1 } };
  }
  if (/^\/api\/v1\/notifications\/\d+\/read$/.test(request.path)) {
    return { status: 200, body: { markedCount: 1, unreadCount: 0 } };
  }
  const detail = /^\/api\/v1\/notifications\/(\d+)\?/.exec(request.path);
  if (detail) {
    return { status: 200, body: { id: Number(detail[1]), type: 'x', title: null, body: null, actor: null, collectionName: null, createdAtUtc: '2026-10-21T00:00:00Z', readAtUtc: null, target: mockDetails.get(Number(detail[1])) } };
  }
  throw new Error(`unexpected request ${request.method} ${request.path}`);
});

// A getter: imports are hoisted above mockNative's initialization.
jest.mock('../../share/specs/NativeApnsIOS', () => ({
  __esModule: true,
  get default() {
    return mockNative;
  },
}));
jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn(),
  onMessage: jest.fn(() => () => undefined),
  onNotificationOpenedApp: jest.fn(() => () => undefined),
  getInitialNotification: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../pushInstallationId', () => ({ getOrCreatePushInstallationId: jest.fn() }));
jest.mock('../pushPermission', () => ({ getPushPermissionStatus: jest.fn() }));
jest.mock('../api/pushDevicesApi', () => ({ registerPushDevice: jest.fn() }));
jest.mock('../../i18n', () => ({ __esModule: true, default: { language: 'ko' } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'ko' } }) }));
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, userBootstrapStatus: 'ready' }) }));
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => mockRequest }));
jest.mock('../../navigation/navigationRef', () => ({
  navigationRef: {
    isReady: jest.fn(() => true),
    navigate: jest.fn(),
    getRootState: jest.fn(() => ({ routeNames: ['MainTabs', 'CollectionDetails'] })),
    addListener: jest.fn(() => () => undefined),
  },
}));

const originalOS = Platform.OS;
const authenticatedRequest = jest.fn() as unknown as AuthenticatedApiRequest;

beforeEach(() => {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  jest.clearAllMocks();
  jest.restoreAllMocks();
  mockDetails.clear();
  notificationBannerQueue.clear();
});

function fire(kind: 'token' | 'foreground' | 'opened', value: string) {
  mockListeners[kind].forEach(listener => listener(value));
}

describe('apnsPush', () => {
  it('is available when the native module exists', () => {
    expect(isApnsPlatform()).toBe(true);
  });

  it('reads the token and the signing environment; a failure or an empty token is not a token', async () => {
    mockNative.registerForRemoteNotifications.mockResolvedValueOnce({ token: 'ab12', environment: 'development', failure: null });
    await expect(getApnsToken()).resolves.toEqual({ token: 'ab12', environment: 'development', failed: false });

    mockNative.registerForRemoteNotifications.mockResolvedValueOnce({ token: null, environment: 'production', failure: 'timeout' });
    await expect(getApnsToken()).resolves.toEqual({ token: null, environment: 'production', failed: true });

    mockNative.registerForRemoteNotifications.mockResolvedValueOnce({ token: '', environment: 'unexpected', failure: null });
    await expect(getApnsToken()).resolves.toEqual({ token: null, environment: 'production', failed: false });
  });

  it('parses the native message, keeps only string data and never throws on malformed input', () => {
    expect(parseApnsMessage('{"notification":{"title":"새 댓글","body":"본문"},"data":{"notificationId":"55","n":3}}')).toEqual({
      notification: { title: '새 댓글', body: '본문' },
      data: { notificationId: '55' },
    });
    expect(parseApnsMessage('{"notification":null,"data":{"type":"collectionContentChanged"}}')).toEqual({
      notification: null,
      data: { type: 'collectionContentChanged' },
    });
    expect(parseApnsMessage('not json')).toBeNull();
    expect(parseApnsMessage('42')).toBeNull();
    expect(parseApnsMessage(null)).toBeNull();
  });

  it('subscriptions forward parsed messages, skip malformed ones and unsubscribe cleanly', () => {
    const tokenListener = jest.fn();
    const messageListener = jest.fn();
    const stopToken = subscribeApnsTokenChanged(tokenListener);
    const stopMessages = subscribeApnsForegroundMessages(messageListener);

    fire('token', '');
    fire('foreground', '{"notification":null,"data":{"type":"x"}}');
    fire('foreground', 'broken');
    expect(tokenListener).toHaveBeenCalledTimes(1);
    expect(messageListener).toHaveBeenCalledTimes(1);

    stopToken();
    stopMessages();
    expect(mockListeners.token.size).toBe(0);
    expect(mockListeners.foreground.size).toBe(0);
  });

  it('the launch tap is taken from the native side', async () => {
    mockNative.consumeInitialNotification.mockResolvedValueOnce('{"notification":null,"data":{"notificationId":"9"}}');
    await expect(consumeInitialApnsMessage()).resolves.toEqual({ notification: null, data: { notificationId: '9' } });
  });
});

describe('syncPushRegistration on iOS', () => {
  beforeEach(() => {
    jest.mocked(getOrCreatePushInstallationId).mockResolvedValue('install-ios');
  });

  it('registers the APNs token with platform ios and the signing environment, never touching Firebase', async () => {
    jest.mocked(getPushPermissionStatus).mockResolvedValue('granted');
    mockNative.registerForRemoteNotifications.mockResolvedValue({ token: 'a'.repeat(64), environment: 'development', failure: null });

    await expect(syncPushRegistration(authenticatedRequest)).resolves.toBe('registered');

    expect(getMessaging).not.toHaveBeenCalled();
    expect(registerPushDevice).toHaveBeenCalledWith(authenticatedRequest, {
      platform: 'ios',
      installationId: 'install-ios',
      pushToken: 'a'.repeat(64),
      locale: 'ko',
      apnsEnvironment: 'development',
    });
  });

  it('does not ask iOS for a token while notifications are not allowed', async () => {
    jest.mocked(getPushPermissionStatus).mockResolvedValue('denied');

    await expect(syncPushRegistration(authenticatedRequest)).resolves.toBe('permissionDenied');

    expect(mockNative.registerForRemoteNotifications).not.toHaveBeenCalled();
    expect(registerPushDevice).not.toHaveBeenCalled();
  });

  it('a failed or missing token registers nothing', async () => {
    jest.mocked(getPushPermissionStatus).mockResolvedValue('granted');
    mockNative.registerForRemoteNotifications.mockResolvedValueOnce({ token: null, environment: 'production', failure: 'registrationFailed' });
    await expect(syncPushRegistration(authenticatedRequest)).resolves.toBe('tokenFailed');

    mockNative.registerForRemoteNotifications.mockResolvedValueOnce({ token: null, environment: 'production', failure: null });
    await expect(syncPushRegistration(authenticatedRequest)).resolves.toBe('tokenUnavailable');

    mockNative.registerForRemoteNotifications.mockRejectedValueOnce(new Error('native'));
    await expect(syncPushRegistration(authenticatedRequest)).resolves.toBe('tokenFailed');

    expect(registerPushDevice).not.toHaveBeenCalled();
  });

  it('a network failure is reported, not thrown', async () => {
    jest.mocked(getPushPermissionStatus).mockResolvedValue('granted');
    mockNative.registerForRemoteNotifications.mockResolvedValue({ token: 'b'.repeat(64), environment: 'production', failure: null });
    jest.mocked(registerPushDevice).mockRejectedValueOnce(new Error('offline'));

    await expect(syncPushRegistration(authenticatedRequest)).resolves.toBe('registrationFailed');
  });
});

describe('usePushMessageHandling on iOS', () => {
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

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
  });

  it('a visible foreground APNs message becomes one in-app banner', async () => {
    await mount();

    act(() => fire('foreground', JSON.stringify({ notification: { title: '새 댓글', body: '본문' }, data: { type: 'collectionItemComment', collectionId: '7', notificationId: '55' } })));
    await flush();

    expect(notificationBannerQueue.current()).toEqual(expect.objectContaining({ notificationId: 55, title: '새 댓글' }));
    expect(navigationRef.navigate).not.toHaveBeenCalled();
  });

  it('a tap opens the target once, even when the launch tap reports the same notification again', async () => {
    mockDetails.set(60, { kind: 'friendRequests' });
    const tap = JSON.stringify({ notification: { title: 't', body: 'b' }, data: { type: 'friendRequest', notificationId: '60' } });
    mockNative.consumeInitialNotification.mockResolvedValueOnce(tap);
    await mount();
    await flush();

    act(() => fire('opened', tap));
    await flush();

    expect(navigationRef.navigate).toHaveBeenCalledTimes(1);
    expect(navigationRef.navigate).toHaveBeenCalledWith('Friends', { openRequests: true, refreshToken: expect.any(Number) });
  });

  it('removes its native listeners on unmount (no leak on remount)', async () => {
    await mount();
    expect(mockListeners.foreground.size).toBe(1);
    expect(mockListeners.opened.size).toBe(1);

    act(() => renderer?.unmount());
    renderer = null;

    expect(mockListeners.foreground.size).toBe(0);
    expect(mockListeners.opened.size).toBe(0);
  });
});
