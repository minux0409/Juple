import { ApiHttpError } from './appApi.ts';
import type { AppDictionary } from './appI18n.ts';

/**
 * Opening a locked Collection on the Web - the mobile rules (collections/collectionUnlockGrants.ts, CollectionUnlockPanel.tsx) on the
 * same API:
 *
 *  - The password is sent ONCE, to POST /api/v1/collections/{id}/unlock (the Owner's lock password) or
 *    POST .../share-password/unlock (a member's access password). It is never stored, logged or sent again.
 *  - The server answers with a short-lived grant (an opaque token bound to this user, this Collection and the lock's current
 *    version, plus when it expires). Only that grant travels afterwards, in the X-Juple-Collection-Unlock header - never in a URL.
 *  - Grants live in this page's memory only (no localStorage, cookie or IndexedDB) and only while the person stays in that
 *    Collection (its own pages): leaving it, reloading the page or signing out forgets them, so it asks again - the mobile "visit".
 */

export const COLLECTION_UNLOCK_HEADER = 'X-Juple-Collection-Unlock';

export interface CollectionUnlockGrant {
  readonly unlockToken: string;
  readonly expiresAtUtc: string;
}

/** A grant is treated as expired slightly early so a request never races its server-side expiry (mobile EXPIRY_MARGIN_MS). */
const EXPIRY_MARGIN_MS = 30_000;

const grants = new Map<number, { readonly token: string; readonly expiresAtMs: number }>();

export function rememberUnlock(collectionId: number, grant: CollectionUnlockGrant): void {
  const expiresAtMs = Date.parse(grant.expiresAtUtc);
  if (Number.isFinite(expiresAtMs) && grant.unlockToken) {
    grants.set(collectionId, { token: grant.unlockToken, expiresAtMs });
  }
}

export function unlockTokenFor(collectionId: number, nowMs: number = Date.now()): string | null {
  const grant = grants.get(collectionId);
  if (!grant) {
    return null;
  }
  if (grant.expiresAtMs - EXPIRY_MARGIN_MS <= nowMs) {
    grants.delete(collectionId);
    return null;
  }
  return grant.token;
}

/** The header for a request about this Collection - only when a grant is held (an unlocked Collection needs none). */
export function unlockHeaders(collectionId: number): Readonly<Record<string, string>> | undefined {
  const token = unlockTokenFor(collectionId);
  return token ? { [COLLECTION_UNLOCK_HEADER]: token } : undefined;
}

export function forgetUnlock(collectionId: number): void {
  grants.delete(collectionId);
}

/** Leaving a Collection's pages ends its visit: every grant for a Collection the current path is not inside is forgotten. */
export function forgetUnlocksOutside(pathname: string): void {
  for (const collectionId of [...grants.keys()]) {
    const base = `/collections/${collectionId}`;
    if (pathname !== base && !pathname.startsWith(`${base}/`)) {
      grants.delete(collectionId);
    }
  }
}

export function forgetAllUnlocks(): void {
  grants.clear();
}

/** The endpoint for the password this Collection asks for. */
export function unlockPath(collectionId: number, kind: 'lock' | 'sharePassword'): string {
  return kind === 'sharePassword' ? `/api/v1/collections/${collectionId}/share-password/unlock` : `/api/v1/collections/${collectionId}/unlock`;
}

/** The password this unlock was for no longer exists (removed meanwhile) - not a wrong password (mobile isUnlockStateChangedError). */
export function isUnlockStateChanged(error: unknown): boolean {
  return error instanceof ApiHttpError && error.status === 409 && (error.code === 'collectionNotLocked' || error.code === 'sharePasswordNotSet');
}

/** Mobile getUnlockErrorMessage. */
export function unlockErrorMessage(error: unknown, kind: 'lock' | 'sharePassword', dictionary: AppDictionary): string {
  if (error instanceof ApiHttpError) {
    if (error.status === 403 && error.code === 'invalidCollectionPassword') {
      return kind === 'sharePassword' ? dictionary.sharePasswordWrong : dictionary.lockWrongPassword;
    }
    if (error.status === 429) {
      return dictionary.lockTooManyAttempts;
    }
  }
  return dictionary.lockUnlockFallback;
}
