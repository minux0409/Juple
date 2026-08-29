import { ApiError } from './ApiError';
import { apiConfig } from './apiConfig';

interface ApiRequest {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly accessToken?: string;
  readonly body?: object;
}

interface ApiResponse {
  readonly status: number;
}

export async function requestApi({
  method,
  path,
  accessToken,
  body,
}: ApiRequest): Promise<ApiResponse> {
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

  if (response.status === 400) {
    throw new ApiError('badRequest', response.status);
  }

  if (response.status === 401) {
    throw new ApiError('unauthorized', response.status);
  }

  if (response.status === 403) {
    throw new ApiError('forbidden', response.status);
  }

  throw new ApiError('unavailable', response.status);
}
