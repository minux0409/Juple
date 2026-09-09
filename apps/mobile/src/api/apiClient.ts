import { ApiError } from './ApiError';
import { apiConfig } from './apiConfig';

export const DEFAULT_API_TIMEOUT_MS = 15_000;

export interface ApiRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly path: string;
  readonly accessToken?: string;
  readonly body?: object;
  /**
   * Multipart body (e.g. an image upload). Mutually exclusive with `body` - when set, no
   * Content-Type header is set here, so fetch/React Native fills in
   * `multipart/form-data; boundary=...` itself. Setting Content-Type manually for a FormData
   * body would omit that boundary and break parsing server-side.
   */
  readonly formData?: FormData;
  readonly timeoutMs?: number;
}

export interface ApiResponse<T> {
  readonly status: number;
  readonly body?: T;
}

// Bounded retry for a transport-level failure on a GET request only (connection refused/DNS
// failure/client-side timeout with no response at all). Originally sized to survive the Azure Dev
// Backend cold-starting from a scale-to-zero replica (minReplicas=0), which took 30s+ - now that
// both Dev and Production keep minReplicas=1 (always warm), that scenario no longer happens, so
// this only needs to absorb a brief, genuinely transient network blip. Total worst-case wait is 2
// attempts * 8s + 1 * 1s backoff = 17s, comfortably inside a ~15-20s automatic-retry budget - a
// sustained outage past that surfaces as an error (see RootStack.tsx's AuthenticatedPlaceholder,
// whose "try again" action re-runs the bootstrap check) rather than making the user wait longer.
//
// Never retried: a response that actually arrived (any HTTP status, including 401/403/5xx - see
// below and authenticatedApiClient.ts's own separate 401-refresh-and-retry-once), or any non-GET
// method - retrying a POST/PUT/DELETE after a transport failure cannot tell "the server never saw
// it" apart from "the server processed it but the response was lost", and duplicating a write is
// worse than surfacing the error.
const TRANSPORT_RETRY_ATTEMPT_TIMEOUT_MS = 8_000;
const TRANSPORT_RETRY_DELAYS_MS = [1_000];

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function requestApi<T>({
  method,
  path,
  accessToken,
  body,
  formData,
  timeoutMs,
}: ApiRequest): Promise<ApiResponse<T>> {
  const baseUrl = apiConfig.baseUrl;
  if (!baseUrl) {
    throw new ApiError('unavailable');
  }

  const requestInit: RequestInit = {
    method,
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: formData ?? (body ? JSON.stringify(body) : undefined),
  };

  // An explicit timeoutMs always wins, for every attempt, whatever the method - e.g.
  // imagesApi.ts's own longer UPLOAD_TIMEOUT_MS. Only the un-overridden default differs by method:
  // GET gets the shorter, retry-tuned attempt timeout (see TRANSPORT_RETRY_ATTEMPT_TIMEOUT_MS
  // above); everything else keeps the original single-attempt default.
  const effectiveTimeoutMs =
    timeoutMs ?? (method === 'GET' ? TRANSPORT_RETRY_ATTEMPT_TIMEOUT_MS : DEFAULT_API_TIMEOUT_MS);
  const maxAttempts =
    method === 'GET' ? TRANSPORT_RETRY_DELAYS_MS.length + 1 : 1;
  let response: Response | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const abortController = new AbortController();
    let didRequestTimeOut = false;
    const timeoutId = setTimeout(() => {
      didRequestTimeOut = true;
      abortController.abort();
    }, effectiveTimeoutMs);

    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...requestInit,
        signal: abortController.signal,
      });
      break;
    } catch {
      const isLastAttempt = attempt === maxAttempts - 1;
      if (isLastAttempt) {
        throw new ApiError(didRequestTimeOut ? 'timeout' : 'unavailable');
      }
      await delay(TRANSPORT_RETRY_DELAYS_MS[attempt]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Unreachable: the loop above either returns via `break` (response assigned) or throws on its
  // last attempt - satisfies TypeScript's definite-assignment analysis across the for-loop.
  if (!response) {
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

  if (response.status === 404) {
    throw new ApiError('notFound', response.status);
  }

  if (response.status === 409) {
    throw new ApiError('conflict', response.status);
  }

  throw new ApiError('unavailable', response.status);
}
