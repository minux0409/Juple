import { ApiError } from '../api/ApiError';
import { requestApi } from '../api/apiClient';
import type { BackendAuthStatus } from './types';

export async function validateBackendSession(
  accessToken: string,
): Promise<BackendAuthStatus> {
  try {
    await requestApi({
      method: 'GET',
      path: '/api/v1/auth/session',
      accessToken,
    });
    return 'valid';
  } catch (error) {
    if (error instanceof ApiError) {
      return error.kind === 'badRequest' || error.kind === 'conflict'
        ? 'unavailable'
        : error.kind;
    }

    return 'unavailable';
  }
}
