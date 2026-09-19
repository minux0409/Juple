import { ApiError } from '../../api/ApiError';
import { requestApi } from '../../api/apiClient';
import { bootstrapCurrentUser } from '../userBootstrapApi';

jest.mock('../../api/apiClient', () => ({
  requestApi: jest.fn(),
}));

describe('bootstrapCurrentUser', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('POSTs to the bootstrap endpoint and returns ready + the backend-reported plan on 200', async () => {
    jest.mocked(requestApi).mockResolvedValue({ status: 200, body: { plan: 'Free' } });

    const result = await bootstrapCurrentUser('a-token', { preferredLocale: 'ko-KR', timeZoneId: 'Asia/Seoul' });

    expect(requestApi).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/v1/users/me/bootstrap',
      accessToken: 'a-token',
      body: { preferredLocale: 'ko-KR', timeZoneId: 'Asia/Seoul' },
    });
    expect(result).toEqual({ status: 'ready', plan: 'Free' });
  });

  it('returns the Plus plan when the backend reports it', async () => {
    jest.mocked(requestApi).mockResolvedValue({ status: 200, body: { plan: 'Plus' } });

    const result = await bootstrapCurrentUser('a-token', { preferredLocale: 'ko-KR', timeZoneId: 'Asia/Seoul' });

    expect(result).toEqual({ status: 'ready', plan: 'Plus' });
  });

  it('maps a badRequest (invalid device settings) error to invalidDeviceSettings with no plan', async () => {
    jest.mocked(requestApi).mockRejectedValue(new ApiError('badRequest', 400));

    const result = await bootstrapCurrentUser('a-token', { preferredLocale: 'invalid', timeZoneId: 'Invalid/Zone' });

    expect(result).toEqual({ status: 'invalidDeviceSettings', plan: null });
  });

  it('maps any other failure to unavailable with no plan', async () => {
    jest.mocked(requestApi).mockRejectedValue(new ApiError('unavailable'));

    const result = await bootstrapCurrentUser('a-token', { preferredLocale: 'ko-KR', timeZoneId: 'Asia/Seoul' });

    expect(result).toEqual({ status: 'unavailable', plan: null });
  });
});
