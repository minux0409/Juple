import { getValidAccessToken } from '../auth/session/authSessionManager';
import { ApiError } from './ApiError';
import { requestTermsAcceptance } from '../safety/termsRequiredEvents';
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
  if (requiresTermsBeforeRequest(request) && !(await requestTermsAcceptance())) {
    throw new ApiError('forbidden', 403, 'termsAcceptanceRequired');
  }
  try {
    return await requestAuthenticatedApiOnce<T>(request);
  } catch (error) {
    // A stale client status or newer Terms version: the server guarantees this 403 happened before the write.
    // Retry this exact request once only after current-version acceptance; never retry transport failures.
    if (error instanceof ApiError && error.kind === 'forbidden' && error.code === 'termsAcceptanceRequired') {
      if (await requestTermsAcceptance(true)) {
        return requestAuthenticatedApiOnce<T>(request);
      }
    }
    throw error;
  }
}

/** Unambiguously social writes. Mixed private/shared Collection writes rely on the server's 403 fallback. */
export function requiresTermsBeforeRequest(request: Pick<ApiRequest, 'method' | 'path'>): boolean {
  const { method, path } = request;
  if (method !== 'POST' && method !== 'PUT') {
    return false;
  }
  return /^\/api\/v1\/collections\/\d+\/(share(?:\/link\/send)?|invitations)(?:\?|$)/.test(path)
    || /^\/api\/v1\/collections\/\d+\/items\/\d+\/(reaction|comments(?:\/\d+(?:\/like)?)?)(?:\?|$)/.test(path)
    || /^\/api\/v1\/friends\/requests(?:\/\d+\/accept)?(?:\?|$)/.test(path)
    || /^\/api\/v1\/collection-invitations\/\d+\/accept(?:\?|$)/.test(path)
    || /^\/api\/v1\/public-shares\/[^/]+\/(join-requests|save|items\/\d+)(?:\?|$)/.test(path);
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
