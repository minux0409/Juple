import { ApiError } from '../api/ApiError';
import { requestApi } from '../api/apiClient';
import type { DeviceRegionalSettings } from '../device/regionalSettings';
import type { UserBootstrapStatus, UserPlan } from './types';

export interface UserBootstrapResult {
  readonly status: UserBootstrapStatus;
  readonly plan: UserPlan | null;
}

interface BootstrapCurrentUserResponseBody {
  readonly plan: UserPlan;
}

export async function bootstrapCurrentUser(
  accessToken: string,
  regionalSettings: DeviceRegionalSettings,
): Promise<UserBootstrapResult> {
  try {
    const response = await requestApi<BootstrapCurrentUserResponseBody>({
      method: 'POST',
      path: '/api/v1/users/me/bootstrap',
      accessToken,
      body: regionalSettings,
    });
    return { status: 'ready', plan: response.body?.plan ?? null };
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'badRequest') {
      return { status: 'invalidDeviceSettings', plan: null };
    }

    return { status: 'unavailable', plan: null };
  }
}
