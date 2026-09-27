/**
 * Collection unlock grants, in memory only (never persisted to disk), scoped to one VISIT of the
 * Collection: CollectionDetailsScreen opens a visit while it is on the stack (see
 * beginCollectionVisit), and everything done from it - its items, edit/delete, the Share screen,
 * the participants sheet, a shared link's detail - reuses the grant. Leaving the Collection (the
 * screen is popped) ends the visit and forgets the grant, so opening it again asks for the
 * password again even though the server-side grant would still be valid for a while. The grant is
 * opaque, bound server-side to this user, Collection and the lock's current version - a password
 * change or lock removal invalidates it on the server, and the next request asks again.
 *
 * The Collection picker (ItemDetails / NewLinkReview) never reads these: it keeps its own grants
 * for its own session (see useCollectionPickerUnlock).
 */

interface StoredGrant {
  readonly token: string;
  readonly expiresAtMs: number;
}

// A grant is treated as expired slightly early so a request never races its server-side expiry.
const EXPIRY_MARGIN_MS = 30_000;

const grants = new Map<number, StoredGrant>();

export function rememberCollectionUnlock(collectionId: number, token: string, expiresAtUtc: string): void {
  const expiresAtMs = Date.parse(expiresAtUtc);
  if (Number.isFinite(expiresAtMs)) {
    grants.set(collectionId, { token, expiresAtMs });
  }
}

export function getCollectionUnlockToken(collectionId: number, nowMs: number = Date.now()): string | null {
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

export function forgetCollectionUnlock(collectionId: number): void {
  grants.delete(collectionId);
}

// How many CollectionDetails screens for each Collection are currently on the stack (normally 0 or
// 1; counted so a Collection opened twice in the same stack keeps its grant until both are gone).
const openVisits = new Map<number, number>();

/**
 * Starts a visit of a Collection; call the returned function when the visit ends (the screen
 * unmounts). When the last visit of that Collection ends, its grant is forgotten.
 */
export function beginCollectionVisit(collectionId: number): () => void {
  openVisits.set(collectionId, (openVisits.get(collectionId) ?? 0) + 1);
  let hasEnded = false;
  return () => {
    if (hasEnded) {
      return;
    }
    hasEnded = true;
    const remaining = (openVisits.get(collectionId) ?? 1) - 1;
    if (remaining > 0) {
      openVisits.set(collectionId, remaining);
      return;
    }
    openVisits.delete(collectionId);
    grants.delete(collectionId);
  };
}

/** The request header a grant travels in (never a query string, so never in URL logs). */
export const COLLECTION_UNLOCK_HEADER_NAME = 'X-Juple-Collection-Unlock';

/**
 * This session's grants for the given Collections as request headers (comma-joined when an
 * operation spans two), or undefined when none is stored. Attached to every call the server
 * guards with the lock: content changes and managing a locked Collection (rename, icon, color,
 * delete, public share, collaboration). An unlocked Collection needs none.
 */
export function storedUnlockHeaders(...collectionIds: readonly number[]): Readonly<Record<string, string>> | undefined {
  const tokens = [...new Set(collectionIds)]
    .map(id => getCollectionUnlockToken(id))
    .filter((token): token is string => token !== null);
  return tokens.length > 0 ? { [COLLECTION_UNLOCK_HEADER_NAME]: tokens.join(',') } : undefined;
}

/** For tests and sign-out. */
export function clearCollectionUnlockGrants(): void {
  grants.clear();
  openVisits.clear();
}
