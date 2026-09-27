import { authorizeWithEntra, REAUTHENTICATION_PARAMETERS } from './entraAuthClient';
import { decodeIdTokenClaims } from './idTokenClaims';
import { getCachedIdToken, saveAuthorizedSession } from './session/authSessionManager';

/**
 * "Sign in again to confirm it's you" for security-sensitive actions (Settings > 컬렉션 잠금's
 * set/reset). The app never decides that a sign-in was recent - the server does, from the new
 * access token's auth_time. This only makes sure the new tokens belong to the same account before
 * they replace the current session.
 */

function accountKey(idToken: string | null | undefined): string | null {
  const claims = idToken ? decodeIdTokenClaims(idToken) : null;
  if (!claims) {
    return null;
  }
  const { tid, oid, iss, sub } = claims;
  if (typeof tid === 'string' && tid && typeof oid === 'string' && oid) {
    return `tid-oid:${tid}:${oid}`;
  }
  if (typeof iss === 'string' && iss && typeof sub === 'string' && sub) {
    return `iss-sub:${iss}:${sub}`;
  }
  return null;
}

/**
 * Whether two ID tokens name the same account (tenant + object id, else issuer + subject).
 * Decoding without signature validation is fine for this one purpose only: it can only ever REFUSE
 * to replace the current session (fail closed when either token is missing or unreadable) - it
 * never grants anything; the server re-validates every token it receives.
 */
export function isSameAccount(previousIdToken: string | null | undefined, nextIdToken: string | null | undefined): boolean {
  const previous = accountKey(previousIdToken);
  const next = accountKey(nextIdToken);
  return previous !== null && next !== null && previous === next;
}

export type ReauthenticationOutcome = 'reauthenticated' | 'differentAccount' | 'incomplete';

/**
 * Runs an interactive prompt=login / max_age=0 sign-in. The current session is replaced only when
 * the new sign-in is provably the same account; otherwise nothing is saved and the existing
 * session stays exactly as it was. A cancelled or failed sign-in rejects (EntraAuthError).
 */
export async function reauthenticateSameAccount(): Promise<ReauthenticationOutcome> {
  const previousIdToken = getCachedIdToken();
  const result = await authorizeWithEntra(REAUTHENTICATION_PARAMETERS);
  if (!result.accessToken || !result.refreshToken) {
    return 'incomplete';
  }
  if (!isSameAccount(previousIdToken, result.idToken)) {
    return 'differentAccount';
  }
  await saveAuthorizedSession({
    accessToken: result.accessToken,
    accessTokenExpirationDate: result.accessTokenExpirationDate,
    refreshToken: result.refreshToken,
    idToken: result.idToken,
  });
  return 'reauthenticated';
}
