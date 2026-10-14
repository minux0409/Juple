import { ApiHttpError, AuthExpiredError } from './appApi.ts';

/**
 * The signed-in Web app's session states (kept pure for tests; the React provider in app/(app)/AppRoot.tsx drives them):
 *
 *   configMissing   sign-in values are not configured on this server - nothing can sign in, said plainly.
 *   initializing    MSAL is starting / finishing a redirect sign-in.
 *   signedOut       no account - the landing page with 로그인 / 회원가입.
 *   redirecting     on the way to (or back from) the Entra sign-in page.
 *   bootstrapping   signed in; telling the API who this is (POST /api/v1/users/me/bootstrap creates the Juple user on first use).
 *   ready           signed in and bootstrapped - the app shell.
 *   bootstrapFailed signed in, but the API could not be reached / answered an error - STAYS signed in, with a retry.
 */
export type AuthStatus = 'configMissing' | 'initializing' | 'signedOut' | 'redirecting' | 'bootstrapping' | 'ready' | 'bootstrapFailed';

/** After MSAL initialized (and handled any redirect response): an account means "go bootstrap", none means the landing page. */
export function statusAfterInitialize(hasAccount: boolean): AuthStatus {
  return hasAccount ? 'bootstrapping' : 'signedOut';
}

/** A failed bootstrap: only a lost session signs out; a network / server failure keeps the session and offers a retry. */
export function statusAfterBootstrapFailure(error: unknown): AuthStatus {
  return error instanceof AuthExpiredError ? 'signedOut' : 'bootstrapFailed';
}

/** Whether a page failure means the session is gone (sign out locally) rather than "try again". */
export function isSessionLost(error: unknown): boolean {
  return error instanceof AuthExpiredError;
}

/** The routes of the signed-in app (the (app) route group). Everything else - the public viewer, legal pages, the redirect bridge - never asks for sign-in. */
export const SIGNED_IN_ROUTES = ['/', '/archive', '/collections', '/me', '/notifications'] as const;

/** The signed-in pages below a route: a Collection (/collections/{id}, another member's link in it), a link (/items/{id}) and 내 페이지's pages (/me/settings, /me/friends, ...). */
export const SIGNED_IN_ROUTE_PREFIXES = ['/collections/', '/items/', '/me/', '/shared/'] as const;

export function requiresSignIn(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return (SIGNED_IN_ROUTES as readonly string[]).includes(path) || SIGNED_IN_ROUTE_PREFIXES.some(prefix => path.startsWith(prefix));
}

/** The body the mobile app sends to POST /api/v1/users/me/bootstrap: the browser's own locale and IANA time zone. */
export function bootstrapRequestBody(locale: string | undefined, timeZone: string | undefined): { preferredLocale: string | null; timeZoneId: string | null } {
  return { preferredLocale: locale?.trim() || null, timeZoneId: timeZone?.trim() || null };
}

/**
 * The API refuses to CREATE a Juple account from a sign-in that is not recent (403 recentAuthenticationRequired from bootstrap): a
 * stale session - e.g. a tab left open after the account was deleted - must never re-create it silently. Existing accounts are never
 * refused this way.
 */
export function isAccountCreationRefused(error: unknown): boolean {
  return error instanceof ApiHttpError && error.status === 403 && error.code === 'recentAuthenticationRequired';
}

/**
 * What to do when account creation was refused: ask for the credentials once (prompt=login - the explicit sign-up); if that fresh
 * sign-in was already asked for and the API still refuses, stop and sign out locally instead of looping through Entra.
 */
export function actionAfterAccountCreationRefused(credentialsAlreadyAsked: boolean): 'askForCredentials' | 'signOut' {
  return credentialsAlreadyAsked ? 'signOut' : 'askForCredentials';
}
