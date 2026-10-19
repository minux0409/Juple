import { AdminForbiddenError, AuthExpiredError } from './adminApi.ts';
import type { AdminMe } from './adminModel.ts';

/**
 * The Admin Web's session states (pure, for tests; app/(admin)/AdminRoot.tsx drives them):
 *
 *   configMissing  the deployment lacks a sign-in setting - nothing can sign in, said plainly.
 *   initializing   MSAL is starting / finishing a redirect sign-in.
 *   signedOut      no account - the sign-in page.
 *   redirecting    on the way to (or back from) Entra.
 *   checking       signed in; asking the API whether this person is an active admin (GET /api/v1/admin/me).
 *   ready          the API confirmed an active grant - the admin shell. Only now is any admin page rendered.
 *   forbidden      signed in, but the API refused (403): only "관리자 권한이 없습니다." and 로그아웃 - no navigation, no data.
 *   failed         the API could not be reached / answered an error - the session is kept, with a retry.
 */
export type AdminSessionStatus = 'configMissing' | 'initializing' | 'signedOut' | 'redirecting' | 'checking' | 'ready' | 'forbidden' | 'failed';

export function statusAfterInitialize(hasAccount: boolean): AdminSessionStatus {
  return hasAccount ? 'checking' : 'signedOut';
}

/** The outcome of GET /api/v1/admin/me. A role the client does not know is not trusted to mean anything - it is a failure. */
export function statusAfterAccessCheck(outcome: { readonly me: AdminMe } | { readonly error: unknown }): AdminSessionStatus {
  if ('me' in outcome) {
    return outcome.me.role === 'Owner' || outcome.me.role === 'Admin' ? 'ready' : 'failed';
  }
  if (outcome.error instanceof AdminForbiddenError) {
    return 'forbidden';
  }
  return outcome.error instanceof AuthExpiredError ? 'signedOut' : 'failed';
}

/**
 * A page call failed: a lost session signs out, a revoked grant (403 mid-session - the Owner deactivated it) drops to the forbidden
 * screen at once; anything else stays on the page with its own error and retry.
 */
export function statusAfterPageFailure(error: unknown): AdminSessionStatus | null {
  if (error instanceof AuthExpiredError) {
    return 'signedOut';
  }
  return error instanceof AdminForbiddenError ? 'forbidden' : null;
}
