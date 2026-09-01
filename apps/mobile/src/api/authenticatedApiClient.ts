import { getValidAccessToken } from '../auth/session/authSessionManager';
import { ApiError } from './ApiError';
import { requestApi, type ApiRequest, type ApiResponse } from './apiClient';

/**
 * Authenticated Juple API access with no React dependency, so it can be called
 * from a future Headless JS task with no mounted React tree.
 */

export type AuthenticatedApiRequest = <T>(
  request: Omit<ApiRequest, 'accessToken'>,
) => Promise<ApiResponse<T>>;

/**
 * Attaches a valid access token and performs the request. On a 401 only, forces
 * a token refresh and retries exactly once with the refreshed token. Any other
 * error (400/403/409/timeout/unavailable/5xx) is not retried.
 */
export async function requestAuthenticatedApi<T>(
  request: Omit<ApiRequest, 'accessToken'>,
): Promise<ApiResponse<T>> {
  const accessToken = await getValidAccessToken();

  try {
    return await requestApi<T>({ ...request, accessToken });
  } catch (error) {
    if (!(error instanceof ApiError) || error.kind !== 'unauthorized') {
      throw error;
    }
  }

  const refreshedAccessToken = await getValidAccessToken({
    forceRefresh: true,
  });
  return requestApi<T>({ ...request, accessToken: refreshedAccessToken });
}
