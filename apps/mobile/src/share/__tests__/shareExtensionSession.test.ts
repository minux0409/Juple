import { Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';

jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn(() => Promise.resolve(true)),
  resetGenericPassword: jest.fn(() => Promise.resolve(true)),
  getGenericPassword: jest.fn(),
  ACCESSIBLE: { AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AccessibleAfterFirstUnlockThisDeviceOnly' },
}));
jest.mock('../../api/apiConfig', () => ({ apiConfig: { baseUrl: 'https://api.example.test' } }));
jest.mock('../../config/publicWebConfig', () => ({ publicWebConfig: { host: 'web.example.test' } }));
jest.mock('../../auth/entraAuthConfig', () => ({
  selectedEntraAuthConfig: { tokenEndpoint: 'https://login.example.test/token', clientId: 'client-1', scopes: ['openid', 'offline_access'] },
}));

const originalOS = Platform.OS;

function load() {
  let module: typeof import('../shareExtensionSession') | undefined;
  jest.isolateModules(() => {
    module = require('../shareExtensionSession');
  });
  return module!;
}

afterEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
});

describe('the Share extension session copy (iOS)', () => {
  it('stores the refresh token with the public settings, device-only, in the App Group access group', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const { mirrorShareExtensionSession } = load();
    await mirrorShareExtensionSession('rt-1');
    expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(1);
    const [username, payload, options] = jest.mocked(Keychain.setGenericPassword).mock.calls[0];
    expect(username).toBe('juple-share-extension-session');
    expect(JSON.parse(payload)).toEqual({
      version: 1,
      refreshToken: 'rt-1',
      tokenEndpoint: 'https://login.example.test/token',
      clientId: 'client-1',
      scopes: ['openid', 'offline_access'],
      apiBaseUrl: 'https://api.example.test',
      publicWebHost: 'web.example.test',
    });
    expect(options).toEqual({
      service: 'com.juple.app.share-extension.session',
      accessGroup: 'group.com.juple.app',
      accessible: 'AccessibleAfterFirstUnlockThisDeviceOnly',
    });
  });

  it('writes again only when the refresh token changed, and sign-out removes it', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const { mirrorShareExtensionSession, clearShareExtensionSession } = load();
    await mirrorShareExtensionSession('rt-1');
    await mirrorShareExtensionSession('rt-1');
    await mirrorShareExtensionSession('rt-2');
    expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(2);
    await clearShareExtensionSession();
    expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({ service: 'com.juple.app.share-extension.session', accessGroup: 'group.com.juple.app' });
    // After a sign-out the same token (a new sign-in of the same person) is written again.
    await mirrorShareExtensionSession('rt-2');
    expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(3);
  });

  it('does nothing on Android and never throws when the Keychain refuses', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const android = load();
    await android.mirrorShareExtensionSession('rt-1');
    await android.clearShareExtensionSession();
    expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
    expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();

    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    jest.mocked(Keychain.setGenericPassword).mockRejectedValueOnce(new Error('denied'));
    const ios = load();
    await expect(ios.mirrorShareExtensionSession('rt-9')).resolves.toBeUndefined();
  });
});
