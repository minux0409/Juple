import { ApiError } from '../../api/ApiError';
import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';
import { registerPushDevice, unregisterPushDevice } from '../api/pushDevicesApi';

describe('registerPushDevice', () => {
  it('PUTs the platform/installationId/pushToken/locale and returns the registration', async () => {
    const registration = {
      id: 1,
      platform: 'android' as const,
      installationId: 'install-1',
      isEnabled: true,
      updatedAtUtc: '2026-09-06T00:00:00Z',
    };
    const request = jest.fn(async () => ({ status: 200, body: registration })) as unknown as AuthenticatedApiRequest;

    const result = await registerPushDevice(request, {
      platform: 'android',
      installationId: 'install-1',
      pushToken: 'token-1',
      locale: 'ko',
    });

    expect(result).toEqual(registration);
    expect(request).toHaveBeenCalledWith({
      method: 'PUT',
      path: '/api/v1/push/devices',
      body: { platform: 'android', installationId: 'install-1', pushToken: 'token-1', locale: 'ko' },
    });
  });

  it('throws when the Backend returns no body', async () => {
    const request = jest.fn(async () => ({ status: 200, body: undefined })) as unknown as AuthenticatedApiRequest;

    await expect(
      registerPushDevice(request, { platform: 'android', installationId: 'i', pushToken: 't', locale: 'en' }),
    ).rejects.toThrow();
  });
});

describe('unregisterPushDevice', () => {
  it('DELETEs the installationId, URL-encoded', async () => {
    const request = jest.fn(async () => ({ status: 204, body: undefined })) as unknown as AuthenticatedApiRequest;

    await unregisterPushDevice(request, 'install/with slash');

    expect(request).toHaveBeenCalledWith({
      method: 'DELETE',
      path: `/api/v1/push/devices/${encodeURIComponent('install/with slash')}`,
    });
  });

  it('swallows a 404 (never registered) rather than throwing', async () => {
    const request = jest.fn(async () => {
      throw new ApiError('notFound', 404);
    }) as unknown as AuthenticatedApiRequest;

    await expect(unregisterPushDevice(request, 'never-registered')).resolves.toBeUndefined();
  });

  it('rethrows any other error', async () => {
    const request = jest.fn(async () => {
      throw new ApiError('unavailable', undefined);
    }) as unknown as AuthenticatedApiRequest;

    await expect(unregisterPushDevice(request, 'install-1')).rejects.toBeInstanceOf(ApiError);
  });
});
