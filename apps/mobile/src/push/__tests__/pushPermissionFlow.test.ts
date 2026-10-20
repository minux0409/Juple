import { AppState } from 'react-native';
import { ensurePushPermissionOnce } from '../pushPermissionFlow';
import { hasRequestedPushPermission, markPushPermissionRequested } from '../pushPermissionRequestState';
import { requestPushPermission } from '../pushPermission';
import { syncPushRegistration } from '../pushRegistrationSync';

jest.mock('../pushPermissionRequestState', () => ({
  hasRequestedPushPermission: jest.fn(),
  markPushPermissionRequested: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../pushPermission', () => ({ requestPushPermission: jest.fn() }));
jest.mock('../pushRegistrationSync', () => ({ syncPushRegistration: jest.fn().mockResolvedValue(undefined) }));

beforeEach(() => { Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active', writable: true }); });
afterEach(() => jest.clearAllMocks());

const request = jest.fn() as never;

describe('ensurePushPermissionOnce', () => {
  it('asks once, and registers the device only when granted', async () => {
    jest.mocked(hasRequestedPushPermission).mockResolvedValue(false);
    jest.mocked(requestPushPermission).mockResolvedValue('granted');

    await ensurePushPermissionOnce(request);

    expect(markPushPermissionRequested).toHaveBeenCalled();
    expect(syncPushRegistration).toHaveBeenCalledWith(request, expect.any(Function));
  });

  it('never asks again once asked, and a denial changes nothing else', async () => {
    jest.mocked(hasRequestedPushPermission).mockResolvedValue(true);
    await ensurePushPermissionOnce(request);
    expect(requestPushPermission).not.toHaveBeenCalled();

    jest.mocked(hasRequestedPushPermission).mockResolvedValue(false);
    jest.mocked(requestPushPermission).mockResolvedValue('denied');
    await ensurePushPermissionOnce(request);
    expect(syncPushRegistration).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    jest.mocked(hasRequestedPushPermission).mockRejectedValue(new Error('storage'));
    await expect(ensurePushPermissionOnce(request)).resolves.toBeUndefined();
  });
});
it('serializes simultaneous callers and never registers an old session result', async () => {
  jest.mocked(hasRequestedPushPermission).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  let finish!: (value: 'granted') => void;
  jest.mocked(requestPushPermission).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let current = true;
  const first = ensurePushPermissionOnce(request, () => current);
  const second = ensurePushPermissionOnce(request);
  // Allow the storage operations preceding the OS call to settle.
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(requestPushPermission).toHaveBeenCalledTimes(1);
  current = false;
  finish('granted');
  await Promise.all([first, second]);
  expect(syncPushRegistration).not.toHaveBeenCalled();
});
it('does not request in background or for a cancelled session', async () => {
  AppState.currentState = 'background';
  await ensurePushPermissionOnce(request);
  AppState.currentState = 'active';
  await ensurePushPermissionOnce(request, () => false);
  expect(requestPushPermission).not.toHaveBeenCalled();
});
