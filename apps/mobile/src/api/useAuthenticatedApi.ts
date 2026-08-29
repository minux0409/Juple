import { useCallback } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from './ApiError';
import { requestApi, type ApiRequest, type ApiResponse } from './apiClient';

export type AuthenticatedApiRequest = <T>(
  request: Omit<ApiRequest, 'accessToken'>,
) => Promise<ApiResponse<T>>;

export function useAuthenticatedApi(): AuthenticatedApiRequest {
  const { getValidAccessToken } = useAuth();

  return useCallback(
    async <T>(
      request: Omit<ApiRequest, 'accessToken'>,
    ): Promise<ApiResponse<T>> => {
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
    },
    [getValidAccessToken],
  );
}
