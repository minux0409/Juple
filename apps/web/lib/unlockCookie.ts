/**
 * The short-lived unlock grant for one locked public share lives in an HttpOnly, SameSite=Lax
 * cookie scoped to that share's own path (/c/{publicId}) - browser JavaScript can never read it,
 * other share pages never receive it, and it expires with the grant. The grant itself is opaque
 * and bound server-side to this one share link and the lock's current version; it never contains
 * or reveals the password.
 */

// Public ids are URL-safe tokens minted by the Backend; anything else is never used to name a
// cookie or a path (and simply resolves to "not found").
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidPublicId(publicId: string): boolean {
  return PUBLIC_ID_PATTERN.test(publicId);
}

export function unlockCookieName(publicId: string): string {
  return `juple_unlock_${publicId}`;
}

export function unlockCookiePath(publicId: string): string {
  return `/c/${publicId}`;
}

/**
 * This browser's opaque unlock-attempt id: random, HttpOnly, shared by all share pages (/c). It
 * carries no identity and grants nothing - the Backend only uses it to count this browser's failed
 * password attempts separately from other visitors' (clearing it just starts a new counter, which
 * the Backend's link-wide ceiling still bounds).
 */
export const ATTEMPT_COOKIE_NAME = 'juple_unlock_attempt';
export const ATTEMPT_COOKIE_PATH = '/c';
export const ATTEMPT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const ATTEMPT_ID_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

export function isValidAttemptId(value: string | undefined): value is string {
  return value !== undefined && ATTEMPT_ID_PATTERN.test(value);
}
