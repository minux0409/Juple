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

describe('concurrent installation initialization and storage recovery', () => {
  function fixture() {
    const storage = require('@react-native-async-storage/async-storage');
    const uuid = require('uuid');
    storage.getItem.mockResolvedValue(null);
    storage.setItem.mockResolvedValue(undefined);
    uuid.v4.mockReturnValue('new-installation');
    return { storage, uuid, get: require('../pushInstallationId').getOrCreatePushInstallationId as () => Promise<string> };
  }
  beforeEach(() => jest.resetModules());

  it('shares one pending promise and one persisted ID for 20 simultaneous first calls', async () => {
    const { storage, uuid, get } = fixture();
    let read!: (value: null) => void;
    storage.getItem.mockImplementation(() => new Promise(resolve => { read = resolve; }));
    const calls = Array.from({ length: 20 }, () => get());
    expect(calls.every(call => call === calls[0])).toBe(true);
    read(null);
    expect(await Promise.all(calls)).toEqual(Array(20).fill('new-installation'));
    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(uuid.v4).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('retries a read failure without replacing an existing identity', async () => {
    const { storage, uuid, get } = fixture();
    storage.getItem.mockRejectedValueOnce(new Error('read unavailable')).mockResolvedValue('existing-id');
    await expect(get()).rejects.toThrow('read unavailable');
    expect(await get()).toBe('existing-id');
    expect(uuid.v4).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('retries a write failure with the same generated ID', async () => {
    const { storage, uuid, get } = fixture();
    storage.setItem.mockRejectedValueOnce(new Error('write unavailable'));
    await expect(get()).rejects.toThrow('write unavailable');
    expect(await get()).toBe('new-installation');
    expect(uuid.v4).toHaveBeenCalledTimes(1);
    expect(storage.setItem.mock.calls).toEqual([
      ['juple.pushInstallationId', 'new-installation'],
      ['juple.pushInstallationId', 'new-installation'],
    ]);
  });

  it('accepts a persisted winner when the write succeeded but its callback failed', async () => {
    const { storage, get } = fixture();
    storage.getItem.mockResolvedValueOnce(null).mockResolvedValue('persisted-winner');
    storage.setItem.mockRejectedValueOnce(new Error('callback failed'));
    await expect(get()).rejects.toThrow('callback failed');
    expect(await get()).toBe('persisted-winner');
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('shares a failure with concurrent callers and permits a recovery attempt', async () => {
    const { storage, uuid, get } = fixture();
    storage.getItem.mockRejectedValueOnce(new Error('read unavailable'));
    const results = await Promise.allSettled([get(), get(), get()]);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(await get()).toBe('new-installation');
    expect(storage.getItem).toHaveBeenCalledTimes(2);
    expect(uuid.v4).toHaveBeenCalledTimes(1);
  });
});
