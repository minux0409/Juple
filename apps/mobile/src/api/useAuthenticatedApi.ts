import {
  requestAuthenticatedApi,
  type AuthenticatedApiRequest,
} from './authenticatedApiClient';

export type { AuthenticatedApiRequest };

/** Thin React adapter over the plain authenticated API client; no retry logic lives here. */
export function useAuthenticatedApi(): AuthenticatedApiRequest {
  return requestAuthenticatedApi;
}
