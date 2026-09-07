jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));
jest.mock('uuid', () => ({
  v4: jest.fn(),
}));

// jest.resetModules() per test (rather than one top-level import) is required here: the module
// under test caches the installation id in a module-level variable across calls, so each test
// needs fresh copies of pushInstallationId AND the mocks it closes over, all from the same
// post-reset registry (a stale top-level `import` would silently mock a discarded copy).
describe('getOrCreatePushInstallationId', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('returns the persisted value when one already exists, without generating or writing again', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const { v4 } = require('uuid');
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('existing-id');
    const { getOrCreatePushInstallationId } = require('../pushInstallationId');

    const id = await getOrCreatePushInstallationId();

    expect(id).toBe('existing-id');
    expect(v4).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('generates and persists a new UUID (via the react-native-get-random-values-backed uuid package) when none exists', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const { v4 } = require('uuid');
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
    jest.mocked(v4).mockReturnValue('generated-uuid');
    const { getOrCreatePushInstallationId } = require('../pushInstallationId');

    const id = await getOrCreatePushInstallationId();

    expect(id).toBe('generated-uuid');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('juple.pushInstallationId', 'generated-uuid');
  });

  it('caches the id in-memory so a second call does not read AsyncStorage again', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('existing-id');
    const { getOrCreatePushInstallationId } = require('../pushInstallationId');

    await getOrCreatePushInstallationId();
    await getOrCreatePushInstallationId();

    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
  });
});
