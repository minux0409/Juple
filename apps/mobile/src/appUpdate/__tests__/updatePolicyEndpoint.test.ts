import { requestApi } from '../../api/apiClient';
import { fetchAppUpdatePolicy } from '../appUpdatePolicyApi';

jest.mock('../../api/apiClient', () => ({ requestApi: jest.fn() }));

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
