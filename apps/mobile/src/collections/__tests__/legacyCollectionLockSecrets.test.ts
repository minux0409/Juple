import * as Keychain from 'react-native-keychain';
import { purgeLegacyCollectionLockSecrets } from '../legacyCollectionLockSecrets';

jest.mock('react-native-keychain', () => ({
  getAllGenericPasswordServices: jest.fn(),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
  getGenericPassword: jest.fn(),
}));

afterEach(() => {
  jest.clearAllMocks();
});

describe('purgeLegacyCollectionLockSecrets', () => {
  it('deletes only leftover Collection lock password items - never the session, and never reads one', async () => {
    jest.mocked(Keychain.getAllGenericPasswordServices).mockResolvedValue([
      'com.juple.app.collection-lock.v1.7',
      'com.juple.app.collection-lock.v1.12',
      'com.juple.app.auth.session',
    ]);

    await purgeLegacyCollectionLockSecrets();

    expect(Keychain.resetGenericPassword).toHaveBeenCalledTimes(2);
    expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({ service: 'com.juple.app.collection-lock.v1.7' });
    expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({ service: 'com.juple.app.collection-lock.v1.12' });
    expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    jest.mocked(Keychain.getAllGenericPasswordServices).mockRejectedValue(new Error('keystore unavailable'));
    await expect(purgeLegacyCollectionLockSecrets()).resolves.toBeUndefined();
  });
});
