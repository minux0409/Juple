import { ApiError } from './ApiError';
import { apiConfig } from './apiConfig';

export interface ApiRequest {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly accessToken?: string;
  readonly body?: object;
}

export interface ApiResponse<T> {
  readonly status: number;
  readonly body?: T;
}

export async function requestApi<T>({
  method,
  path,
  accessToken,
  body,
}: ApiRequest): Promise<ApiResponse<T>> {
  const baseUrl = apiConfig.baseUrl;
  if (!baseUrl) {
    throw new ApiError('unavailable');
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('unavailable');
  }

  if (response.status === 204) {
    return { status: response.status };
  }

  if (response.status === 200 || response.status === 201) {
    try {
      return { status: response.status, body: (await response.json()) as T };
    } catch {
      throw new ApiError('unavailable', response.status);
    }
  }

  if (response.status === 400) {
    throw new ApiError('badRequest', response.status);
  }

  if (response.status === 401) {
    throw new ApiError('unauthorized', response.status);
  }

  if (response.status === 403) {
    throw new ApiError('forbidden', response.status);
  }

  if (response.status === 409) {
    throw new ApiError('conflict', response.status);
  }

  throw new ApiError('unavailable', response.status);
}
