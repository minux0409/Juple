import { getValidAccessToken } from '../auth/session/authSessionManager';
import { ApiError } from './ApiError';
import { notifyTermsAcceptanceRequired } from '../safety/termsRequiredEvents';
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
  try {
    return await requestAuthenticatedApiOnce<T>(request);
  } catch (error) {
    // A content write refused for the missing Terms agreement: the app asks for the agreement (the call still fails as before).
    if (error instanceof ApiError && error.kind === 'forbidden' && error.code === 'termsAcceptanceRequired') {
      notifyTermsAcceptanceRequired();
    }
    throw error;
  }
}

async function requestAuthenticatedApiOnce<T>(
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
