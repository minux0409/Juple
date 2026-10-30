import { authorizeWithEntra, REAUTHENTICATION_PARAMETERS } from './entraAuthClient';
import { decodeIdTokenClaims } from './idTokenClaims';
import { getCachedIdToken, runInteractiveSignIn, saveAuthorizedSession } from './session/authSessionManager';

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

// Claims that carry the sign-in e-mail of an External ID local (email + password) account, in order.
// 'upn' is deliberately not here: it is a workforce-account claim and would only ever steer the
// sign-in page towards the wrong (organizational) account type.
const LOGIN_HINT_CLAIMS = ['email', 'preferred_username'] as const;
const MAX_LOGIN_HINT_LENGTH = 254;
// One local part, one @, a dotted domain; no whitespace, quotes, angle brackets or control characters.
// eslint-disable-next-line no-control-regex
const EMAIL_SHAPE = /^[^\s@<>"'\u0000-\u001f]+@[^\s@<>"'\u0000-\u001f]+\.[^\s@<>"'\u0000-\u001f]+$/;

/**
 * The signed-in user's e-mail from the ID token the app already holds in memory - or null when it is
 * absent or not shaped like an e-mail address. It is used for exactly one thing: the login_hint of a
 * re-authentication request. It is never stored, logged or sent anywhere else, and a wrong or missing
 * value can only make the sign-in page less helpful - the new tokens must still be the same account
 * (isSameAccount) before they replace the session.
 */
export function loginHintFromIdToken(idToken: string | null | undefined): string | null {
  const claims = idToken ? decodeIdTokenClaims(idToken) : null;
  if (!claims) {
    return null;
  }
  for (const key of LOGIN_HINT_CLAIMS) {
    const value = claims[key];
    if (typeof value !== 'string') {
      continue;
    }
    const candidate = value.trim();
    if (
      candidate.length > 0 &&
      candidate.length <= MAX_LOGIN_HINT_LENGTH &&
      EMAIL_SHAPE.test(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

/**
 * prompt=login / max_age=0, plus login_hint when (and only when) the current user's e-mail is known
 * with confidence. Without a hint, External ID may show an account-type chooser from which the
 * organizational option fails with AADSTS700056 for a local account; with it, the sign-in page opens
 * straight on the local account's password. No hint -> exactly the previous parameters.
 */
export function buildReauthenticationParameters(
  currentIdToken: string | null | undefined,
): Record<string, string> {
  const loginHint = loginHintFromIdToken(currentIdToken);
  return {
    ...REAUTHENTICATION_PARAMETERS,
    ...(loginHint ? { login_hint: loginHint } : {}),
  };
}

/**
 * Runs an interactive prompt=login / max_age=0 sign-in (with the current user's e-mail as login_hint
 * when known). The current session is replaced only when the new sign-in is provably the same
 * account; otherwise nothing is saved and the existing session stays exactly as it was. A cancelled
 * or failed sign-in rejects (EntraAuthError).
 */
export async function reauthenticateSameAccount(): Promise<ReauthenticationOutcome> {
  const previousIdToken = getCachedIdToken();
  const result = await runInteractiveSignIn(() => authorizeWithEntra(buildReauthenticationParameters(previousIdToken)));
  if (!result.accessToken || !result.refreshToken) {
    return 'incomplete';
  }
  if (!isSameAccount(previousIdToken, result.idToken)) {
    return 'differentAccount';
  }
  try {
    await saveAuthorizedSession({
      accessToken: result.accessToken,
      accessTokenExpirationDate: result.accessTokenExpirationDate,
      refreshToken: result.refreshToken,
      idToken: result.idToken,
    });
  } catch (cause) {
    // The sign-in itself succeeded; storing it did not - said apart from a failed sign-in (signInFailureCode 'session_save').
    throw Object.assign(new Error('The re-authenticated session could not be stored.'), { code: 'session_save', cause });
  }
  return 'reauthenticated';
}
