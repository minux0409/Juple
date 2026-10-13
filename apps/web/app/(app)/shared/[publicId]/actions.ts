'use server';

import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { isValidSharePublicId } from '../../../../lib/collectionShareUrl';
import { getPublicCollection, unlockPublicCollection } from '../../../../lib/publicApi';
import type { ShareProfile } from '../../../../lib/sharedCollectionEntry';
import { ATTEMPT_COOKIE_MAX_AGE_SECONDS, ATTEMPT_COOKIE_NAME, isValidAttemptId } from '../../../../lib/unlockCookie';

/**
 * The anonymous Public API (the link's profile, its password check) answers browsers only on the public share host's own origin (its
 * CORS policy), so the signed-in app reaches it through these server actions - server to server, exactly like the /c share page. The
 * signed-in calls (membership, 저장, 요청) go from the browser with the person's token as usual.
 */

const MAX_PASSWORD_LENGTH = 64;
/** The grant the Backend minted for this link (opaque, base64url-ish); anything else is not forwarded. */
const UNLOCK_TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]{16,2048}$/;
/** This flow's own per-browser attempt id (the /c page's cookie is scoped to /c and is not sent here). */
const ATTEMPT_COOKIE_PATH = '/shared';

function apiBaseUrl(): string {
  return (process.env.JUPLE_API_BASE_URL || 'http://localhost:5092').replace(/\/+$/, '');
}

export type ShareProfileResult = { readonly kind: 'found'; readonly profile: ShareProfile } | { readonly kind: 'unavailable' };

/** The link's profile only - name, lock / public state and its tile (explicit fields: nothing else of the answer passes through). */
export async function readShareProfile(publicId: string, unlockToken: string | null): Promise<ShareProfileResult> {
  if (!isValidSharePublicId(publicId)) {
    return { kind: 'unavailable' };
  }
  try {
    const collection = await getPublicCollection(apiBaseUrl(), publicId, unlockToken && UNLOCK_TOKEN_PATTERN.test(unlockToken) ? unlockToken : undefined);
    if (collection === null) {
      return { kind: 'unavailable' };
    }
    return {
      kind: 'found',
      profile: {
        name: typeof collection.name === 'string' ? collection.name : null,
        isLocked: collection.isLocked === true,
        isPublic: collection.isPublic,
        icon: typeof collection.icon === 'string' ? collection.icon : null,
        color: typeof collection.color === 'string' ? collection.color : null,
        iconImageUrl: typeof collection.iconImageUrl === 'string' ? collection.iconImageUrl : null,
      },
    };
  } catch {
    // Unknown, revoked or unreadable: one "unavailable" state, never distinguished (the mobile rule).
    return { kind: 'unavailable' };
  }
}

export type ShareUnlockResult =
  | { readonly kind: 'unlocked'; readonly unlockToken: string }
  | { readonly kind: 'invalidPassword' | 'throttled' | 'notFound' | 'failed' };

/**
 * Verifies a protected link's password with the Backend (which throttles attempts per link and per browser). Only the short-lived grant
 * comes back - kept in the page's memory for this visit, never stored; the password is forwarded once and never kept or logged.
 */
export async function unlockShare(publicId: string, password: string): Promise<ShareUnlockResult> {
  if (!isValidSharePublicId(publicId)) {
    return { kind: 'notFound' };
  }
  if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    return { kind: 'invalidPassword' };
  }
  const cookieStore = await cookies();
  let attemptId = cookieStore.get(ATTEMPT_COOKIE_NAME)?.value;
  if (!isValidAttemptId(attemptId)) {
    attemptId = randomBytes(24).toString('base64url');
    cookieStore.set(ATTEMPT_COOKIE_NAME, attemptId, {
      httpOnly: true,
      maxAge: ATTEMPT_COOKIE_MAX_AGE_SECONDS,
      path: ATTEMPT_COOKIE_PATH,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }
  try {
    const result = await unlockPublicCollection(apiBaseUrl(), publicId, password, attemptId!);
    return result.kind === 'unlocked' ? { kind: 'unlocked', unlockToken: result.unlockToken } : { kind: result.kind };
  } catch {
    return { kind: 'failed' };
  }
}
