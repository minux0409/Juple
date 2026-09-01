import { ApiError } from './ApiError';
import { apiConfig } from './apiConfig';

export const DEFAULT_API_TIMEOUT_MS = 15_000;

export interface ApiRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly path: string;
  readonly accessToken?: string;
  readonly body?: object;
  readonly timeoutMs?: number;
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
  timeoutMs = DEFAULT_API_TIMEOUT_MS,
}: ApiRequest): Promise<ApiResponse<T>> {
  const baseUrl = apiConfig.baseUrl;
  if (!baseUrl) {
    throw new ApiError('unavailable');
  }

  const abortController = new AbortController();
  let didRequestTimeOut = false;
  const timeoutId = setTimeout(() => {
    didRequestTimeOut = true;
    abortController.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: abortController.signal,
    });
  } catch {
    throw new ApiError(didRequestTimeOut ? 'timeout' : 'unavailable');
  } finally {
    clearTimeout(timeoutId);
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

  if (response.status === 404) {
    throw new ApiError('notFound', response.status);
  }

  if (response.status === 409) {
    throw new ApiError('conflict', response.status);
  }

  throw new ApiError('unavailable', response.status);
}
