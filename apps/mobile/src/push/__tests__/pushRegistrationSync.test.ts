import { getMessaging } from '@react-native-firebase/messaging';
import { Platform } from 'react-native';
import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';
import { getOrCreatePushInstallationId } from '../pushInstallationId';
import { getPushPermissionStatus } from '../pushPermission';
import { registerPushDevice } from '../api/pushDevicesApi';
import { registerRefreshedPushToken, syncPushRegistration, syncPushRegistrationIfPermitted } from '../pushRegistrationSync';

const mockGetToken = jest.fn();
jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  getToken: (...args: unknown[]) => mockGetToken(...args),
}));
jest.mock('../pushInstallationId', () => ({ getOrCreatePushInstallationId: jest.fn() }));
jest.mock('../pushPermission', () => ({ getPushPermissionStatus: jest.fn() }));
jest.mock('../api/pushDevicesApi', () => ({ registerPushDevice: jest.fn() }));
jest.mock('../../i18n', () => ({ __esModule: true, default: { language: 'ko' } }));

const authenticatedRequest = jest.fn() as unknown as AuthenticatedApiRequest;

describe('syncPushRegistrationIfPermitted', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  });

  afterEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  it('never touches Firebase or the Backend on iOS (no FCM there - APNs is not implemented yet)', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    jest.mocked(getPushPermissionStatus).mockResolvedValue('granted');
    mockGetToken.mockResolvedValue('token-1');

    await syncPushRegistrationIfPermitted(authenticatedRequest);

    expect(getMessaging).not.toHaveBeenCalled();
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(registerPushDevice).not.toHaveBeenCalled();
  });

  it('does nothing when permission is not granted', async () => {
    jest.mocked(getPushPermissionStatus).mockResolvedValue('denied');

    await syncPushRegistrationIfPermitted(authenticatedRequest);

    expect(mockGetToken).not.toHaveBeenCalled();
    expect(registerPushDevice).not.toHaveBeenCalled();
  });

  it('does nothing when the FCM token is unavailable', async () => {
    jest.mocked(getPushPermissionStatus).mockResolvedValue('granted');
    jest.mocked(getOrCreatePushInstallationId).mockResolvedValue('install-1');
    mockGetToken.mockResolvedValue(null);

    await syncPushRegistrationIfPermitted(authenticatedRequest);

    expect(registerPushDevice).not.toHaveBeenCalled();
  });

  it('registers the current token/installationId/locale when permitted', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    jest.mocked(getPushPermissionStatus).mockResolvedValue('granted');
    jest.mocked(getOrCreatePushInstallationId).mockResolvedValue('install-1');
    mockGetToken.mockResolvedValue('token-1');

    await syncPushRegistrationIfPermitted(authenticatedRequest);

    expect(registerPushDevice).toHaveBeenCalledWith(authenticatedRequest, {
      platform: 'android',
      installationId: 'install-1',
      pushToken: 'token-1',
      locale: 'ko',
    });
  });

  it('never throws when a dependency rejects', async () => {
    jest.mocked(getPushPermissionStatus).mockRejectedValue(new Error('boom'));

    await expect(syncPushRegistrationIfPermitted(authenticatedRequest)).resolves.toBeUndefined();
  });
});

describe('registerRefreshedPushToken', () => {
  const originalOS = Platform.OS;
  beforeEach(() => Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true }));
  afterEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  it('does not register an Android token on iOS', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    await registerRefreshedPushToken(authenticatedRequest, 'android-token');
    expect(registerPushDevice).not.toHaveBeenCalled();
  });

  it('does nothing for an empty token', async () => {
    await registerRefreshedPushToken(authenticatedRequest, '');

    expect(getPushPermissionStatus).not.toHaveBeenCalled();
    expect(registerPushDevice).not.toHaveBeenCalled();
  });

  it('does nothing when permission is no longer granted', async () => {
    jest.mocked(getPushPermissionStatus).mockResolvedValue('denied');

    await registerRefreshedPushToken(authenticatedRequest, 'new-token');

    expect(registerPushDevice).not.toHaveBeenCalled();
  });

  it('registers the refreshed token when still permitted', async () => {
    jest.mocked(getPushPermissionStatus).mockResolvedValue('granted');
    jest.mocked(getOrCreatePushInstallationId).mockResolvedValue('install-1');

    await registerRefreshedPushToken(authenticatedRequest, 'new-token');

    expect(registerPushDevice).toHaveBeenCalledWith(
      authenticatedRequest,
      expect.objectContaining({ pushToken: 'new-token', installationId: 'install-1' }),
    );
  });

  it('never throws when a dependency rejects', async () => {
    jest.mocked(getPushPermissionStatus).mockRejectedValue(new Error('boom'));

    await expect(registerRefreshedPushToken(authenticatedRequest, 'new-token')).resolves.toBeUndefined();
  });
});

describe('registration diagnosis and session races', () => {
  const originalOS = Platform.OS;
  beforeEach(() => { Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true }); jest.mocked(getPushPermissionStatus).mockResolvedValue('granted'); jest.mocked(getOrCreatePushInstallationId).mockResolvedValue('private-installation'); });
  afterEach(() => { jest.clearAllMocks(); jest.restoreAllMocks(); Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true }); });
  it('distinguishes missing token, token failure and server failure without logging their secrets', async () => {
    const log = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    mockGetToken.mockResolvedValueOnce(null); expect(await syncPushRegistration(authenticatedRequest)).toBe('tokenUnavailable');
    mockGetToken.mockRejectedValueOnce(new Error('private-token-source')); expect(await syncPushRegistration(authenticatedRequest)).toBe('tokenFailed');
    mockGetToken.mockResolvedValueOnce('private-fcm-token'); jest.mocked(registerPushDevice).mockRejectedValueOnce({ status: 503, body: 'private-backend-body' });
    expect(await syncPushRegistration(authenticatedRequest)).toBe('registrationFailed');
    const logs = JSON.stringify(log.mock.calls); expect(logs).toContain('503'); expect(logs).not.toMatch(/private-/);
  });
  it('does not register a token that finishes acquisition after logout invalidated the epoch', async () => {
    const { invalidatePushRegistration } = require('../pushMutationQueue');
    let finish!: (token: string) => void; mockGetToken.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = syncPushRegistration(authenticatedRequest);
    await Promise.resolve(); await Promise.resolve();
    invalidatePushRegistration(); finish('old-session-token');
    expect(await pending).toBe('cancelled'); expect(registerPushDevice).not.toHaveBeenCalled();
  });
});
