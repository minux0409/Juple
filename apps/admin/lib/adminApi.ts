import { RequestCooldown, retryAfterSeconds } from './retryAfter.ts';

/**
 * The Admin Web's calls to the Juple API (/api/v1/admin/*): a bearer token from MSAL, JSON in/out. Pure (fetch and the token source
 * are injected) so the rules are unit-tested without a browser - the same rules as the user Web's client (apps/web/lib/appApi.ts):
 *
 *  - 401: ask for a FRESH token once and retry once. A second 401 (or no token) is a lost session - AuthExpiredError. Never a loop.
 *  - 403: AdminForbiddenError - signed in, but the API does not hold an active admin grant for this person. Nothing is retried.
 *  - No response, or the token source could not tell (offline, timeout): ApiNetworkError; the session is kept and a retry is offered.
 *  - Any other non-2xx: ApiHttpError with the status and, for a 400, the first validation message the API sent.
 */
export class AuthExpiredError extends Error {
  constructor() {
    super('The sign-in session is no longer valid.');
    this.name = 'AuthExpiredError';
  }
}

export class AdminForbiddenError extends Error {
  constructor() {
    super('This account is not an active Juple admin.');
    this.name = 'AdminForbiddenError';
  }
}

export class ApiNetworkError extends Error {
  constructor() {
    super('The Juple API could not be reached.');
    this.name = 'ApiNetworkError';
  }
}

export class ApiHttpError extends Error {
  readonly retryAfterSeconds?: number;
  readonly status: number;
  readonly validationMessage: string | null;
  /** The API's machine-readable reason of a 409 (e.g. inquiryChanged, translationNotConfigured); null otherwise. */
  readonly code: string | null;

  constructor(status: number, validationMessage: string | null, retryAfterSeconds?: number, code: string | null = null) {
    super(`The Juple API answered ${status}.`);
    this.name = 'ApiHttpError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.validationMessage = validationMessage;
    this.code = code;
  }
}

/** An access token for the Juple API; forceRefresh skips any cached one. Null = no session; throwing = could not tell right now. */
export type AccessTokenSource = (options: { readonly forceRefresh: boolean }) => Promise<string | null>;

export interface AdminApiRequest {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly path: string;
  readonly body?: unknown;
  readonly responseType?: 'json' | 'blob';
}

export type AdminApi = <T>(request: AdminApiRequest) => Promise<T>;

export function createAdminApi(options: {
  readonly apiBaseUrl: string;
  readonly getAccessToken: AccessTokenSource;
  readonly fetchImpl?: typeof fetch;
}): AdminApi {
  const cooldown = new RequestCooldown();
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));

  const send = async (request: AdminApiRequest, token: string): Promise<Response> => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const multipart = typeof FormData !== 'undefined' && request.body instanceof FormData;
    if (request.body !== undefined && !multipart) {
      headers['Content-Type'] = 'application/json';
    }
    try {
      return await fetchImpl(`${options.apiBaseUrl}${request.path}`, {
        method: request.method ?? 'GET',
        headers,
        body: request.body === undefined ? undefined : multipart ? request.body as FormData : JSON.stringify(request.body),
        cache: 'no-store',
        // The API never needs cookies; the bearer token is the only credential.
        credentials: 'omit',
      });
    } catch {
      throw new ApiNetworkError();
    }
  };

  const tokenFor = async (forceRefresh: boolean): Promise<string | null> => {
    try {
      return await options.getAccessToken({ forceRefresh });
    } catch {
      throw new ApiNetworkError();
    }
  };

  return async <T>(request: AdminApiRequest): Promise<T> => {
    const token = await tokenFor(false);
    if (!token) {
      throw new AuthExpiredError();
    }
    const remaining = cooldown.remaining(token, request.method ?? 'GET', request.path);
    if (remaining) throw new ApiHttpError(429, null, remaining);
    let response = await send(request, token);
    if (response.status === 401) {
      const fresh = await tokenFor(true);
      if (!fresh) {
        throw new AuthExpiredError();
      }
      response = await send(request, fresh);
      if (response.status === 401) {
        throw new AuthExpiredError();
      }
    }
    if (response.status === 403) {
      throw new AdminForbiddenError();
    }
    if (response.status === 429) {
      const retry = retryAfterSeconds(response.headers?.get?.('Retry-After'));
      cooldown.defer(token, request.method ?? 'GET', request.path, retry);
      throw new ApiHttpError(429, null, retry);
    }
    if (!response.ok) {
      throw new ApiHttpError(
        response.status,
        response.status === 400 ? await readValidationMessage(response) : null,
        undefined,
        response.status === 409 ? await readCode(response) : null,
      );
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (request.responseType === 'blob' ? await response.blob() : await response.json()) as T;
  };
}

export type ApiHealth = 'healthy' | 'unhealthy' | 'unreachable';

/** The API's anonymous liveness endpoint (/health) - no token is sent to it; any non-2xx is unhealthy, no answer is unreachable. */
export async function checkApiHealth(apiBaseUrl: string, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Promise<ApiHealth> {
  try {
    const response = await fetchImpl(`${apiBaseUrl}/health`, { cache: 'no-store', credentials: 'omit' });
    return response.ok ? 'healthy' : 'unhealthy';
  } catch {
    return 'unreachable';
  }
}

/** The first message of an ASP.NET ValidationProblem ({ errors: { field: [message] } }) - the API's own wording, no request echo. */
/** The {code} of a 409 body - a short identifier only (never echoed as HTML or longer text). */
async function readCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { code?: unknown };
    return typeof body.code === 'string' && /^[A-Za-z_]{1,64}$/.test(body.code) ? body.code : null;
  } catch {
    return null;
  }
}

async function readValidationMessage(response: Response): Promise<string | null> {
  try {
    const problem = (await response.json()) as { errors?: Record<string, unknown> };
    for (const messages of Object.values(problem.errors ?? {})) {
      if (Array.isArray(messages) && typeof messages[0] === 'string') {
        return messages[0].slice(0, 300);
      }
    }
    return null;
  } catch {
    return null;
  }
}
