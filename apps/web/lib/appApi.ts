/**
 * The signed-in Web app's calls to the Juple API: a bearer token from the auth layer, JSON in/out. Pure (fetch and the token
 * source are injected), so the rules below are unit-tested without a browser:
 *
 *  - 401: ask for a FRESH token once and retry once. A second 401 (or no token at all) is a lost session - AuthExpiredError, and
 *    the app signs out locally. Never a retry loop.
 *  - The network failed (no response), or the token source could not tell (it threw - offline, timeout): ApiNetworkError. The
 *    session is NOT touched - the page offers a retry.
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

/**
 * Returns an access token for the Juple API; forceRefresh skips any cached token. Null = no signed-in session (sign in again);
 * throwing = could not tell right now (treated as a network failure).
 */
export type AccessTokenSource = (options: { readonly forceRefresh: boolean }) => Promise<string | null>;

export interface AppApiRequest {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  /** JSON, or FormData for a file upload (the browser then sets the multipart Content-Type and its boundary itself). */
  readonly body?: unknown;
  /** Extra request headers - only the ones the API's CORS allows (e.g. a Collection's unlock grant). Never a password. */
  readonly headers?: Readonly<Record<string, string>>;
}

export type AppApi = <T>(request: AppApiRequest) => Promise<T>;

/**
 * Where one API call spent its time, for measuring a slow screen (development only - see AppRoot). Only the method, the path and the
 * NAMES of the query parameters are reported: never a value (a search term), a header or a token.
 */
export interface ApiTiming {
  readonly method: string;
  readonly path: string;
  readonly queryKeys: readonly string[];
  readonly status: number | null;
  /** Getting the access token (a cached one is ~0). */
  readonly tokenMs: number;
  /** The request leaving until the response headers arrive: network + the API's own work (TTFB as the page sees it). */
  readonly waitMs: number;
  /** The response body arriving and being parsed. */
  readonly bodyMs: number;
  readonly totalMs: number;
}

export function createAppApi(options: {
  readonly apiBaseUrl: string;
  readonly getAccessToken: AccessTokenSource;
  readonly fetchImpl?: typeof fetch;
  /** Called after every call with its timing; omitted in production (nothing is measured). */
  readonly onTiming?: (timing: ApiTiming) => void;
  readonly now?: () => number;
}): AppApi {
  const now = options.now ?? (() => performance.now());
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));

  const send = async (request: AppApiRequest, token: string): Promise<Response> => {
    const headers: Record<string, string> = { ...request.headers, Authorization: `Bearer ${token}` };
    const isForm = typeof FormData !== 'undefined' && request.body instanceof FormData;
    if (request.body !== undefined && !isForm) {
      headers['Content-Type'] = 'application/json';
    }
    try {
      return await fetchImpl(`${options.apiBaseUrl}${request.path}`, {
        method: request.method ?? 'GET',
        headers,
        body: request.body === undefined ? undefined : isForm ? (request.body as FormData) : JSON.stringify(request.body),
        cache: 'no-store',
      });
    } catch {
      throw new ApiNetworkError();
    }
  };

  // A token source that THROWS could not tell (offline, timeout): that is a network failure, never a lost session.
  const tokenFor = async (forceRefresh: boolean): Promise<string | null> => {
    try {
      return await options.getAccessToken({ forceRefresh });
    } catch {
      throw new ApiNetworkError();
    }
  };

  return async <T>(request: AppApiRequest): Promise<T> => {
    const started = now();
    const token = await tokenFor(false);
    if (!token) {
      throw new AuthExpiredError();
    }
    const tokenReady = now();
    let headersAt = tokenReady;
    const report = (status: number | null, finished: number) => {
      if (!options.onTiming) {
        return;
      }
      const [path, query = ''] = request.path.split('?');
      options.onTiming({
        method: request.method ?? 'GET',
        path,
        queryKeys: [...new URLSearchParams(query).keys()],
        status,
        tokenMs: Math.round(tokenReady - started),
        waitMs: Math.round(headersAt - tokenReady),
        bodyMs: Math.round(finished - headersAt),
        totalMs: Math.round(finished - started),
      });
    };

    let response = await send(request, token);
    headersAt = now();
    if (response.status === 401) {
      const fresh = await tokenFor(true);
      if (!fresh) {
        throw new AuthExpiredError();
      }
      response = await send(request, fresh);
      headersAt = now();
      if (response.status === 401) {
        throw new AuthExpiredError();
      }
    }

    if (!response.ok) {
      const code = await readProblemCode(response);
      report(response.status, now());
      throw new ApiHttpError(response.status, code);
    }
    if (response.status === 204) {
      report(response.status, now());
      return undefined as T;
    }
    const body = (await response.json()) as T;
    report(response.status, now());
    return body;
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
