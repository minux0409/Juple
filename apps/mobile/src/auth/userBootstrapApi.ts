import { ApiError } from '../api/ApiError';
import { requestApi } from '../api/apiClient';
import type { DeviceRegionalSettings } from '../device/regionalSettings';
import type { UserBootstrapStatus } from './types';

export async function bootstrapCurrentUser(
  accessToken: string,
  regionalSettings: DeviceRegionalSettings,
): Promise<UserBootstrapStatus> {
  try {
    await requestApi({
      method: 'POST',
      path: '/api/v1/users/me/bootstrap',
      accessToken,
      body: regionalSettings,
    });
    return 'ready';
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'badRequest') {
      return 'invalidDeviceSettings';
    }

    return 'unavailable';
  }
}
