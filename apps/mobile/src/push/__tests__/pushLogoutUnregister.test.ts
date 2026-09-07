import { ApiError } from '../../api/ApiError';
import { requestAuthenticatedApi } from '../../api/authenticatedApiClient';
import { getOrCreatePushInstallationId } from '../pushInstallationId';
import { unregisterPushDevice } from '../api/pushDevicesApi';
import { unregisterCurrentPushDeviceBestEffort } from '../pushLogoutUnregister';

jest.mock('../../api/authenticatedApiClient', () => ({
  requestAuthenticatedApi: jest.fn(),
}));
jest.mock('../pushInstallationId', () => ({
  getOrCreatePushInstallationId: jest.fn(),
}));
jest.mock('../api/pushDevicesApi', () => ({
  unregisterPushDevice: jest.fn(),
}));

describe('unregisterCurrentPushDeviceBestEffort', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('unregisters this installation using the authenticated request function', async () => {
    jest.mocked(getOrCreatePushInstallationId).mockResolvedValue('install-1');
    jest.mocked(unregisterPushDevice).mockResolvedValue(undefined);

    await unregisterCurrentPushDeviceBestEffort();

    expect(unregisterPushDevice).toHaveBeenCalledWith(requestAuthenticatedApi, 'install-1');
  });

  it('never throws when installationId lookup fails', async () => {
    jest.mocked(getOrCreatePushInstallationId).mockRejectedValue(new Error('storage unavailable'));

    await expect(unregisterCurrentPushDeviceBestEffort()).resolves.toBeUndefined();
    expect(unregisterPushDevice).not.toHaveBeenCalled();
  });

  it('never throws when the unregister call itself fails (offline, Backend down, ...)', async () => {
    jest.mocked(getOrCreatePushInstallationId).mockResolvedValue('install-1');
    jest.mocked(unregisterPushDevice).mockRejectedValue(new Error('network error'));

    await expect(unregisterCurrentPushDeviceBestEffort()).resolves.toBeUndefined();
  });

  it('never throws (and never surfaces a user-visible error) when called right after account deletion', async () => {
    // After DELETE /api/v1/account succeeds, the User/PushDeviceRegistration rows are already
    // gone server-side - a subsequent call with the same still-valid token hits
    // CurrentJupleUserNotFoundException -> 409, which unregisterPushDevice does NOT special-case
    // as a no-op (only 404 is). This function's own unconditional catch is what makes that safe:
    // MyPageScreen's account-deletion flow calls signOut() (which calls this) right after a
    // successful delete, and must never show an error banner because of this expected 409.
    jest.mocked(getOrCreatePushInstallationId).mockResolvedValue('install-1');
    jest.mocked(unregisterPushDevice).mockRejectedValue(new ApiError('conflict', 409));

    await expect(unregisterCurrentPushDeviceBestEffort()).resolves.toBeUndefined();
  });
});
