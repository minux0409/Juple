import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { getCollection, type Collection } from './api/collectionsApi';
import { canAddItemsTo, contentGateOf, type CollectionContentGate } from './collectionAccess';

/**
 * A Collection's lock / share-password state and the caller's role are MUTABLE (the Owner can switch the password
 * off - or on - from another device at any moment). A card in a list loaded minutes ago is only a snapshot, so
 * nothing that decides "ask for the password" or "may add here" may trust it at the moment of the action: the
 * Collection is read again, from the server, and THAT state wins - in both directions (a password that is gone
 * is not asked for; a password that appeared is not skipped).
 *
 * One small bounded read (GET /collections/{id} - the card's own metadata, no content, no grant needed).
 */
export type FreshCollectionAccess =
  /** The server's current card and, from it, the password the caller must prove now (null: none). */
  | { readonly status: 'ok'; readonly collection: Collection; readonly gate: CollectionContentGate | null }
  /** The Collection is gone for the caller (deleted, access removed, or now view-only): it cannot take this action. */
  | { readonly status: 'unavailable' }
  /** The read itself failed (offline...): the caller keeps what it had - the server still enforces everything on the real action. */
  | { readonly status: 'unknown' };

export async function resolveFreshCollectionAccess(request: AuthenticatedApiRequest, cached: Collection): Promise<FreshCollectionAccess> {
  try {
    const fresh = await getCollection(request, cached.id);
    if (!canAddItemsTo(fresh)) {
      return { status: 'unavailable' };
    }
    return { status: 'ok', collection: fresh, gate: contentGateOf(fresh) };
  } catch (caughtError) {
    if (caughtError instanceof ApiError && caughtError.kind === 'notFound') {
      return { status: 'unavailable' };
    }
    return { status: 'unknown' };
  }
}

/** The stable server codes of "this Collection no longer asks for that password": the lock was removed / there is no share password. */
const UNLOCK_STATE_CHANGED_CODES: ReadonlySet<string> = new Set(['collectionNotLocked', 'sharePasswordNotSet']);

/**
 * An unlock attempt that failed because the state it was for no longer exists (a conflict with one of the codes above) -
 * not a wrong password. The caller re-reads the Collection (resolveFreshCollectionAccess) and goes on from the truth.
 */
export function isUnlockStateChangedError(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'conflict' && error.code !== undefined && UNLOCK_STATE_CHANGED_CODES.has(error.code);
}

/** Replaces the cached card of a list with the fresh one (same position); a missing one stays missing. */
export function withFreshCollection(list: readonly Collection[], fresh: Collection): readonly Collection[] {
  return list.map(entry => (entry.id === fresh.id ? fresh : entry));
}
