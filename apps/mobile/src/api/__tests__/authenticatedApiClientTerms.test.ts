import { getValidAccessToken } from '../../auth/session/authSessionManager';
import { requestTermsAcceptance } from '../../safety/termsRequiredEvents';
import { ApiError } from '../ApiError';
import { requestApi } from '../apiClient';
import { requestAuthenticatedApi, requiresTermsBeforeRequest } from '../authenticatedApiClient';

jest.mock('../../auth/session/authSessionManager', () => ({ getValidAccessToken: jest.fn() }));
jest.mock('../../safety/termsRequiredEvents', () => ({ requestTermsAcceptance: jest.fn() }));
jest.mock('../apiClient', () => ({ requestApi: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getValidAccessToken).mockResolvedValue('test-token');
  jest.mocked(requestTermsAcceptance).mockResolvedValue(true);
  jest.mocked(requestApi).mockResolvedValue({ status: 200 });
});

it.each([
  [{ method: 'POST', path: '/api/v1/inbox' }, false],
  [{ method: 'POST', path: '/api/v1/collections' }, false],
  [{ method: 'POST', path: '/api/v1/items/3/images' }, false],
  [{ method: 'POST', path: '/api/v1/collections/4/share' }, true],
  [{ method: 'POST', path: '/api/v1/collections/4/items/3/comments' }, true],
  [{ method: 'PUT', path: '/api/v1/collections/4/items/3/reaction' }, true],
] as const)('classifies %p before submission', (request, expected) => {
  expect(requiresTermsBeforeRequest(request)).toBe(expected);
});

it('sends a private link save without showing Terms', async () => {
  await requestAuthenticatedApi({ method: 'POST', path: '/api/v1/inbox', body: { url: 'https://example.com' } });
  expect(requestTermsAcceptance).not.toHaveBeenCalled();
  expect(requestApi).toHaveBeenCalledTimes(1);
});

it('waits for acceptance before the first share write and does not send it after cancellation', async () => {
  jest.mocked(requestTermsAcceptance).mockResolvedValue(false);
  await expect(requestAuthenticatedApi({ method: 'POST', path: '/api/v1/collections/4/share' }))
    .rejects.toMatchObject({ code: 'termsAcceptanceRequired' });
  expect(requestApi).not.toHaveBeenCalled();
});

it('retries exactly once after the server rejects a mixed write for a newer Terms version', async () => {
  jest.mocked(requestApi).mockRejectedValueOnce(new ApiError('forbidden', 403, 'termsAcceptanceRequired'));
  await requestAuthenticatedApi({ method: 'POST', path: '/api/v1/inbox', body: { collectionIds: [4] } });
  expect(requestTermsAcceptance).toHaveBeenCalledTimes(1);
  expect(requestTermsAcceptance).toHaveBeenCalledWith(true);
  expect(requestApi).toHaveBeenCalledTimes(2);
});

it('never retries a write after a transport error', async () => {
  jest.mocked(requestApi).mockRejectedValue(new ApiError('timeout'));
  await expect(requestAuthenticatedApi({ method: 'POST', path: '/api/v1/inbox' })).rejects.toMatchObject({ kind: 'timeout' });
  expect(requestApi).toHaveBeenCalledTimes(1);
});
