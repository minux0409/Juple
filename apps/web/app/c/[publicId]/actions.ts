'use server';

import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { unlockPublicCollection } from '../../../lib/publicApi';
import {
  ATTEMPT_COOKIE_MAX_AGE_SECONDS,
  ATTEMPT_COOKIE_NAME,
  ATTEMPT_COOKIE_PATH,
  isValidAttemptId,
  isValidPublicId,
  unlockCookieName,
  unlockCookiePath,
} from '../../../lib/unlockCookie';

export interface UnlockFormState {
  readonly error: 'invalidPassword' | 'throttled' | 'failed' | null;
}

const MAX_PASSWORD_LENGTH = 64;

function resolveApiBaseUrl(): string {
  return process.env.JUPLE_API_BASE_URL || 'http://localhost:5092';
}

/**
 * Verifies a locked share's password on the server (the Backend throttles attempts per share link)
 * and, on success, stores the returned short-lived grant in an HttpOnly cookie scoped to this share
 * - never in the page HTML, never readable by browser JS. The password is only ever forwarded to
 * the Backend over the server-to-server call; it is not logged or stored here.
 */
export async function unlockSharedCollection(
  publicId: string,
  _previousState: UnlockFormState,
  formData: FormData,
): Promise<UnlockFormState> {
  if (!isValidPublicId(publicId)) {
    return { error: 'failed' };
  }

  const password = formData.get('password');
  if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    return { error: 'invalidPassword' };
  }

  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV === 'production';

  // Reuse this browser's attempt id, or issue one (128+ random bits, no meaning of its own).
  let attemptId = cookieStore.get(ATTEMPT_COOKIE_NAME)?.value;
  if (!isValidAttemptId(attemptId)) {
    attemptId = randomBytes(24).toString('base64url');
    cookieStore.set(ATTEMPT_COOKIE_NAME, attemptId, {
      httpOnly: true,
      maxAge: ATTEMPT_COOKIE_MAX_AGE_SECONDS,
      path: ATTEMPT_COOKIE_PATH,
      sameSite: 'lax',
      secure,
    });
  }

  const result = await unlockPublicCollection(resolveApiBaseUrl(), publicId, password, attemptId);
  if (result.kind === 'invalidPassword' || result.kind === 'throttled') {
    return { error: result.kind };
  }
  if (result.kind !== 'unlocked') {
    return { error: 'failed' };
  }

  const maxAgeSeconds = Math.max(0, Math.floor((Date.parse(result.expiresAtUtc) - Date.now()) / 1000));
  cookieStore.set(unlockCookieName(publicId), result.unlockToken, {
    httpOnly: true,
    maxAge: maxAgeSeconds,
    path: unlockCookiePath(publicId),
    sameSite: 'lax',
    // Plain http only for local development; every deployed environment is https.
    secure,
  });

  // Re-render the page, which now reads the grant server-side.
  redirect(unlockCookiePath(publicId));
}
