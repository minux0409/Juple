import {
  refreshEntraSession,
  isEntraSessionInvalidError,
  EntraAuthError,
} from '../entraAuthClient';
import { AuthSessionError } from './authSessionErrors';
import { clearAuthSession, loadAuthSession, saveAuthSession } from './authSessionStorage';

/**
 * Owns the Entra auth session lifecycle (in-memory access token cache, secure
 * refresh-token storage, refresh/single-flight, session invalidation) without
 * depending on React. Callable from any context, including a future
 * Headless JS task with no mounted React tree.
 */

const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

export interface AuthorizedSession {
  readonly accessToken: string;
  readonly accessTokenExpirationDate: string;
  readonly refreshToken: string;
  readonly idToken?: string;
}

/**
 * The two real sub-phases refreshAccessToken() below goes through on a cold start (reading the
 * persisted session, then the network round trip to Entra) - exposed via GetValidAccessTokenOptions
 * so the Startup Progress UI (see auth/bootstrapProgress.ts) can show determinate progress driven by
 * these actual transitions instead of a fake timer.
 */
export type SessionRestoreStep = 'sessionRestore' | 'entraRefresh';

export interface GetValidAccessTokenOptions {
  readonly forceRefresh?: boolean;
  readonly onStep?: (step: SessionRestoreStep) => void;
}

let accessToken: string | null = null;
let accessTokenExpirationDate: string | null = null;
/** The most recently known idToken - only for reading display-only claims client-side (see idTokenClaims.ts), never used for API authorization. */
let cachedIdToken: string | null = null;
let refreshInFlight: Promise<string> | null = null;
const sessionInvalidatedListeners = new Set<() => void>();

function isAccessTokenUsable(expirationDate: string | null): boolean {
  if (!expirationDate) {
    return false;
  }

  const expirationMs = Date.parse(expirationDate);
  return (
    Number.isFinite(expirationMs) &&
    expirationMs > Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS
  );
}

function setCachedAccessToken(token: string, expirationDate: string): void {
  accessToken = token;
  accessTokenExpirationDate = expirationDate;
}

function clearCachedAccessToken(): void {
  accessToken = null;
  accessTokenExpirationDate = null;
}

async function clearSessionInternal(): Promise<void> {
  await clearAuthSession().catch(() => undefined);
  clearCachedAccessToken();
  cachedIdToken = null;
}

/** The most recently known idToken (from sign-in, refresh, or the persisted session), or null if never available. */
export function getCachedIdToken(): string | null {
  return cachedIdToken;
}

function notifySessionInvalidated(): void {
  for (const listener of sessionInvalidatedListeners) {
    listener();
  }
}

/** Subscribes to session invalidation (revoked/expired refresh token). Returns an unsubscribe function. */
export function onSessionInvalidated(listener: () => void): () => void {
  sessionInvalidatedListeners.add(listener);
  return () => {
    sessionInvalidatedListeners.delete(listener);
  };
}

/** Persists a freshly authorized session (interactive sign-in) and caches its access token in memory. */
export async function saveAuthorizedSession(
  session: AuthorizedSession,
): Promise<void> {
  setCachedAccessToken(session.accessToken, session.accessTokenExpirationDate);
  cachedIdToken = session.idToken ?? cachedIdToken;
  await saveAuthSession({
    refreshToken: session.refreshToken,
    idToken: session.idToken,
  });
}

/** Clears the secure session and the in-memory access token (logout). */
export async function clearSession(): Promise<void> {
  await clearSessionInternal();
}

async function refreshAccessToken(onStep?: (step: SessionRestoreStep) => void): Promise<string> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  const refreshPromise = (async () => {
    onStep?.('sessionRestore');
    const session = await loadAuthSession();
    if (!session) {
      throw new AuthSessionError('sessionUnavailable');
    }
    // Populates the in-memory cache from the persisted session on a cold start, even before this
    // refresh call itself resolves - so getCachedIdToken() works right after app launch/restore.
    cachedIdToken = session.idToken ?? cachedIdToken;

    try {
      onStep?.('entraRefresh');
      const result = await refreshEntraSession(session.refreshToken);
      if (!result.accessToken) {
        throw new Error('Entra refresh completed without an access token.');
      }

      if (result.refreshToken) {
        const idToken = result.idToken ?? session.idToken;
        await saveAuthSession({
          refreshToken: result.refreshToken,
          idToken,
        });
        cachedIdToken = idToken ?? cachedIdToken;
      }

      setCachedAccessToken(result.accessToken, result.accessTokenExpirationDate);
      return result.accessToken;
    } catch (caughtError) {
      const cause =
        caughtError instanceof EntraAuthError
          ? caughtError.cause
          : caughtError;
      if (isEntraSessionInvalidError(cause)) {
        await clearSessionInternal();
        notifySessionInvalidated();
      }

      throw caughtError;
    }
  })();

  refreshInFlight = refreshPromise;
  try {
    return await refreshPromise;
  } finally {
    if (refreshInFlight === refreshPromise) {
      refreshInFlight = null;
    }
  }
}

/**
 * Returns a usable access token: the cached token when it is still valid outside the
 * 60s safety window, otherwise refreshes using the stored session. Concurrent callers
 * share a single in-flight refresh.
 */
export async function getValidAccessToken(
  options: GetValidAccessTokenOptions = {},
): Promise<string> {
  if (
    !options.forceRefresh &&
    accessToken &&
    isAccessTokenUsable(accessTokenExpirationDate)
  ) {
    return accessToken;
  }

  return refreshAccessToken(options.onStep);
}
