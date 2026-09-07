import { Platform } from 'react-native';
import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';
import { getOrCreatePushInstallationId } from '../pushInstallationId';
import { getPushPermissionStatus } from '../pushPermission';
import { registerPushDevice } from '../api/pushDevicesApi';
import { registerRefreshedPushToken, syncPushRegistrationIfPermitted } from '../pushRegistrationSync';

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

  afterEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
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
  afterEach(() => {
    jest.clearAllMocks();
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
