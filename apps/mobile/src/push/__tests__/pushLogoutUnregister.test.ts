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
});
