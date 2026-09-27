import { ensurePushPermissionOnce } from '../pushPermissionFlow';
import { hasRequestedPushPermission, markPushPermissionRequested } from '../pushPermissionRequestState';
import { requestPushPermission } from '../pushPermission';
import { syncPushRegistrationIfPermitted } from '../pushRegistrationSync';

jest.mock('../pushPermissionRequestState', () => ({
  hasRequestedPushPermission: jest.fn(),
  markPushPermissionRequested: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../pushPermission', () => ({ requestPushPermission: jest.fn() }));
jest.mock('../pushRegistrationSync', () => ({ syncPushRegistrationIfPermitted: jest.fn().mockResolvedValue(undefined) }));

afterEach(() => jest.clearAllMocks());

const request = jest.fn() as never;

describe('ensurePushPermissionOnce', () => {
  it('asks once, and registers the device only when granted', async () => {
    jest.mocked(hasRequestedPushPermission).mockResolvedValue(false);
    jest.mocked(requestPushPermission).mockResolvedValue('granted');

    await ensurePushPermissionOnce(request);

    expect(markPushPermissionRequested).toHaveBeenCalled();
    expect(syncPushRegistrationIfPermitted).toHaveBeenCalledWith(request);
  });

  it('never asks again once asked, and a denial changes nothing else', async () => {
    jest.mocked(hasRequestedPushPermission).mockResolvedValue(true);
    await ensurePushPermissionOnce(request);
    expect(requestPushPermission).not.toHaveBeenCalled();

    jest.mocked(hasRequestedPushPermission).mockResolvedValue(false);
    jest.mocked(requestPushPermission).mockResolvedValue('denied');
    await ensurePushPermissionOnce(request);
    expect(syncPushRegistrationIfPermitted).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    jest.mocked(hasRequestedPushPermission).mockRejectedValue(new Error('storage'));
    await expect(ensurePushPermissionOnce(request)).resolves.toBeUndefined();
  });
});
