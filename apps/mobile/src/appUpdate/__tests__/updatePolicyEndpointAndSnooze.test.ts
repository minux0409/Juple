import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestApi } from '../../api/apiClient';
import { fetchAppUpdatePolicy } from '../appUpdatePolicyApi';
import {
  isOptionalUpdateSnoozed,
  loadOptionalUpdateSnooze,
  OPTIONAL_UPDATE_SNOOZE_MS,
  saveOptionalUpdateSnooze,
} from '../optionalUpdateSnooze';

jest.mock('../../api/apiClient', () => ({ requestApi: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

afterEach(() => jest.clearAllMocks());

describe('fetchAppUpdatePolicy (sign-in-free endpoint) - never throws, fails open', () => {
  const answer = (body: unknown) => jest.mocked(requestApi).mockResolvedValue({ status: 200, body } as never);

  it('reads an enabled policy for the platform without any access token', async () => {
    answer({ platform: 'android', enabled: true, latestBuild: 24, minimumSupportedBuild: 23, storeUrl: 'https://play.google.com/store/apps/details?id=com.juple.app' });

    const result = await fetchAppUpdatePolicy('android');

    expect(result).toEqual({
      ok: true,
      policy: { latestBuild: 24, minimumSupportedBuild: 23, storeUrl: 'https://play.google.com/store/apps/details?id=com.juple.app' },
    });
    const call = jest.mocked(requestApi).mock.calls[0][0];
    expect(call).toMatchObject({ method: 'GET', path: '/api/v1/app-update/android' });
    expect(call.accessToken).toBeUndefined();
  });

  it('a disabled platform is an answer with no policy', async () => {
    answer({ platform: 'ios', enabled: false, latestBuild: 0, minimumSupportedBuild: 0, storeUrl: null });

    expect(await fetchAppUpdatePolicy('ios')).toEqual({ ok: true, policy: null });
  });

  it.each([
    ['not an object', 'x'],
    ['no enabled flag', { latestBuild: 3, minimumSupportedBuild: 1 }],
    ['a minimum above the latest', { enabled: true, latestBuild: 3, minimumSupportedBuild: 9, storeUrl: null }],
    ['a malformed number', { enabled: true, latestBuild: 'x', minimumSupportedBuild: 0, storeUrl: null }],
  ])('%s is no answer at all', async (_name, body) => {
    answer(body);

    expect(await fetchAppUpdatePolicy('android')).toEqual({ ok: false });
  });

  it('a network or server failure is no answer - and an unsupported platform is never even requested', async () => {
    jest.mocked(requestApi).mockRejectedValue(new Error('offline'));
    expect(await fetchAppUpdatePolicy('android')).toEqual({ ok: false });

    jest.mocked(requestApi).mockClear();
    expect(await fetchAppUpdatePolicy('windows')).toEqual({ ok: false });
    expect(requestApi).not.toHaveBeenCalled();
  });
});

describe('optional update snooze', () => {
  const NOW = 1_800_000_000_000;

  it('is for the same latest build and only inside 24 hours', () => {
    const snooze = { latestBuild: 25, dismissedAt: NOW };

    expect(isOptionalUpdateSnoozed(snooze, 25, NOW + 1000)).toBe(true);
    expect(isOptionalUpdateSnoozed(snooze, 25, NOW + OPTIONAL_UPDATE_SNOOZE_MS - 1)).toBe(true);
    expect(isOptionalUpdateSnoozed(snooze, 25, NOW + OPTIONAL_UPDATE_SNOOZE_MS)).toBe(false);
    expect(isOptionalUpdateSnoozed(snooze, 26, NOW + 1000)).toBe(false);
    expect(isOptionalUpdateSnoozed(null, 25, NOW)).toBe(false);
  });

  it('a device clock that moved backwards never extends a snooze', () => {
    expect(isOptionalUpdateSnoozed({ latestBuild: 25, dismissedAt: NOW }, 25, NOW - 60_000)).toBe(false);
  });

  it('stores only the build number and the moment, and reads them back', async () => {
    await saveOptionalUpdateSnooze(25, NOW);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith('juple.appUpdate.optionalSnooze', JSON.stringify({ latestBuild: 25, dismissedAt: NOW }));

    jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify({ latestBuild: 25, dismissedAt: NOW }));
    expect(await loadOptionalUpdateSnooze()).toEqual({ latestBuild: 25, dismissedAt: NOW });
  });

  it('an unreadable stored value or a storage failure is "no snooze" - never an error', async () => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('not json');
    expect(await loadOptionalUpdateSnooze()).toBeNull();

    jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify({ latestBuild: 'x', dismissedAt: 'y' }));
    expect(await loadOptionalUpdateSnooze()).toBeNull();

    jest.mocked(AsyncStorage.getItem).mockRejectedValue(new Error('disk'));
    expect(await loadOptionalUpdateSnooze()).toBeNull();

    jest.mocked(AsyncStorage.setItem).mockRejectedValue(new Error('disk'));
    await expect(saveOptionalUpdateSnooze(25, NOW)).resolves.toBeUndefined();
  });
});
