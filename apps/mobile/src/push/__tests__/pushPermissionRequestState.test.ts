import AsyncStorage from '@react-native-async-storage/async-storage';
import { hasRequestedPushPermission, markPushPermissionRequested } from '../pushPermissionRequestState';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe('hasRequestedPushPermission', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('resolves false when nothing has been persisted yet', async () => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);

    await expect(hasRequestedPushPermission()).resolves.toBe(false);
  });

  it('resolves true once markPushPermissionRequested has persisted the flag', async () => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('true');

    await expect(hasRequestedPushPermission()).resolves.toBe(true);
  });
});

describe('markPushPermissionRequested', () => {
  it('persists the flag under the expected key', async () => {
    await markPushPermissionRequested();

    expect(AsyncStorage.setItem).toHaveBeenCalledWith('juple.pushPermissionRequested', 'true');
  });
});
