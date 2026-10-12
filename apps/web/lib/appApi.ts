/**
 * The signed-in Web app's calls to the Juple API: a bearer token from the auth layer, JSON in/out. Pure (fetch and the token
 * source are injected), so the rules below are unit-tested without a browser:
 *
 *  - 401: ask for a FRESH token once and retry once. A second 401 (or no token at all) is a lost session - AuthExpiredError, and
 *    the app signs out locally. Never a retry loop.
 *  - The network failed (no response): ApiNetworkError. The session is NOT touched - the page offers a retry.
 *  - Any other non-2xx: ApiHttpError with the status (and the problem code when the API sent one).
 */
export class AuthExpiredError extends Error {
  constructor() {
    super('The sign-in session is no longer valid.');
    this.name = 'AuthExpiredError';
  }
}

export class ApiNetworkError extends Error {
  constructor() {
    super('The Juple API could not be reached.');
    this.name = 'ApiNetworkError';
  }
}

export class ApiHttpError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null) {
    super(`The Juple API answered ${status}.`);
    this.name = 'ApiHttpError';
    this.status = status;
    this.code = code;
  }
}

/** Returns an access token for the Juple API; forceRefresh skips any cached token. Null = no signed-in session. */
export type AccessTokenSource = (options: { readonly forceRefresh: boolean }) => Promise<string | null>;

export interface AppApiRequest {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly body?: unknown;
}

export type AppApi = <T>(request: AppApiRequest) => Promise<T>;

export function createAppApi(options: {
  readonly apiBaseUrl: string;
  readonly getAccessToken: AccessTokenSource;
  readonly fetchImpl?: typeof fetch;
}): AppApi {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));

  const send = async (request: AppApiRequest, token: string): Promise<Response> => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (request.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    try {
      return await fetchImpl(`${options.apiBaseUrl}${request.path}`, {
        method: request.method ?? 'GET',
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        cache: 'no-store',
      });
    } catch {
      throw new ApiNetworkError();
    }
  };

  return async <T>(request: AppApiRequest): Promise<T> => {
    const token = await options.getAccessToken({ forceRefresh: false });
    if (!token) {
      throw new AuthExpiredError();
    }

    let response = await send(request, token);
    if (response.status === 401) {
      const fresh = await options.getAccessToken({ forceRefresh: true });
      if (!fresh) {
        throw new AuthExpiredError();
      }
      response = await send(request, fresh);
      if (response.status === 401) {
        throw new AuthExpiredError();
      }
    }

    if (!response.ok) {
      throw new ApiHttpError(response.status, await readProblemCode(response));
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  };
}

async function readProblemCode(response: Response): Promise<string | null> {
  try {
    const problem = (await response.json()) as { code?: unknown };
    return typeof problem.code === 'string' ? problem.code : null;
  } catch {
    return null;
  }
}
