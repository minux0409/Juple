import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';
import { hasRequestedPushPermission, markPushPermissionRequested } from '../pushPermissionRequestState';
import { requestPushPermission } from '../pushPermission';
import { syncPushRegistrationIfPermitted } from '../pushRegistrationSync';
import { ensurePushPermissionAfterFirstRepeatPurchase } from '../pushPermissionFlow';

jest.mock('../pushPermissionRequestState', () => ({
  hasRequestedPushPermission: jest.fn(),
  markPushPermissionRequested: jest.fn(),
}));
jest.mock('../pushPermission', () => ({ requestPushPermission: jest.fn() }));
jest.mock('../pushRegistrationSync', () => ({ syncPushRegistrationIfPermitted: jest.fn() }));

const authenticatedRequest = jest.fn() as unknown as AuthenticatedApiRequest;

describe('ensurePushPermissionAfterFirstRepeatPurchase', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('does nothing (never re-prompts) once permission has already been requested', async () => {
    jest.mocked(hasRequestedPushPermission).mockResolvedValue(true);

    await ensurePushPermissionAfterFirstRepeatPurchase(authenticatedRequest);

    expect(requestPushPermission).not.toHaveBeenCalled();
    expect(markPushPermissionRequested).not.toHaveBeenCalled();
  });

  it('prompts once, marks it requested, and syncs registration on a grant', async () => {
    jest.mocked(hasRequestedPushPermission).mockResolvedValue(false);
    jest.mocked(requestPushPermission).mockResolvedValue('granted');

    await ensurePushPermissionAfterFirstRepeatPurchase(authenticatedRequest);

    expect(markPushPermissionRequested).toHaveBeenCalled();
    expect(syncPushRegistrationIfPermitted).toHaveBeenCalledWith(authenticatedRequest);
  });

  it('prompts once and does not sync when denied', async () => {
    jest.mocked(hasRequestedPushPermission).mockResolvedValue(false);
    jest.mocked(requestPushPermission).mockResolvedValue('denied');

    await ensurePushPermissionAfterFirstRepeatPurchase(authenticatedRequest);

    expect(markPushPermissionRequested).toHaveBeenCalled();
    expect(syncPushRegistrationIfPermitted).not.toHaveBeenCalled();
  });

  it('never throws when a dependency rejects', async () => {
    jest.mocked(hasRequestedPushPermission).mockRejectedValue(new Error('storage unavailable'));

    await expect(ensurePushPermissionAfterFirstRepeatPurchase(authenticatedRequest)).resolves.toBeUndefined();
  });
});
