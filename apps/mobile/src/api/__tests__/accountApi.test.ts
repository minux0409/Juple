import { ApiError } from '../ApiError';
import type { AuthenticatedApiRequest } from '../useAuthenticatedApi';
import { deleteAccount } from '../accountApi';

describe('deleteAccount', () => {
  it('DELETEs /api/v1/account', async () => {
    const request = jest.fn(async () => ({ status: 204, body: undefined })) as unknown as AuthenticatedApiRequest;

    await deleteAccount(request);

    expect(request).toHaveBeenCalledWith({
      method: 'DELETE',
      path: '/api/v1/account',
    });
  });

  it('treats a 409 conflict (already deleted) as a no-op rather than throwing', async () => {
    const request = jest.fn(async () => {
      throw new ApiError('conflict', 409);
    }) as unknown as AuthenticatedApiRequest;

    await expect(deleteAccount(request)).resolves.toBeUndefined();
  });

  it('rethrows any other error', async () => {
    const request = jest.fn(async () => {
      throw new ApiError('unavailable', undefined);
    }) as unknown as AuthenticatedApiRequest;

    await expect(deleteAccount(request)).rejects.toBeInstanceOf(ApiError);
  });
});
