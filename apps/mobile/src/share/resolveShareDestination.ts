import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { getCollection, type Collection } from '../collections/api/collectionsApi';
import { canAddItemsTo, contentGateOf } from '../collections/collectionAccess';

/**
 * Is the Collection a Direct Share row / launcher shortcut named still a place this link may be saved into? The id that
 * arrives from an Intent is only a claim: it is checked against the backend (which also enforces everything again when the
 * link is actually added) - that the Collection exists for this signed-in user, that they may add links to it (a Viewer may
 * not; an Owner/Contributor add directly, a Submitter proposes - the existing approval rule applies unchanged), and that it
 * is not behind a lock or access password (nothing can be saved into content the user has not unlocked, and a Direct Share
 * must never be a way around that).
 *
 * - usable: save into it.
 * - unusable: gone, no access, view-only or protected - the link must NOT go to any Collection on the user's behalf.
 * - throws: the check itself failed (offline, session, server) - the caller decides, exactly as for any other failed request.
 */
export type ShareDestination =
  | { readonly status: 'usable'; readonly collection: Collection }
  | { readonly status: 'unusable' };

export async function resolveShareDestination(request: AuthenticatedApiRequest, collectionId: number): Promise<ShareDestination> {
  let collection: Collection;
  try {
    collection = await getCollection(request, collectionId);
  } catch (caughtError) {
    if (caughtError instanceof ApiError && (caughtError.kind === 'notFound' || caughtError.kind === 'forbidden')) {
      return { status: 'unusable' };
    }
    throw caughtError;
  }
  if (!canAddItemsTo(collection) || contentGateOf(collection) !== null) {
    return { status: 'unusable' };
  }
  return { status: 'usable', collection };
}

/**
 * The one way an incoming share's claimed Collection becomes a preselection (the review router and the open-draft conflict
 * hand-off both use it): usable keeps the id; unusable yields NO Collection (never another one) and says so, so the caller can
 * tell the user while keeping the link and everything already resolved; a failed check (offline...) keeps the claim - the
 * review's own save is verified by the server, which stays the final authority.
 */
export interface ClaimedDestination {
  readonly collectionId: number | null;
  readonly unavailable: boolean;
}

export async function validateClaimedDestination(request: AuthenticatedApiRequest, claimedCollectionId: number | null): Promise<ClaimedDestination> {
  if (claimedCollectionId === null) {
    return { collectionId: null, unavailable: false };
  }
  try {
    const destination = await resolveShareDestination(request, claimedCollectionId);
    return destination.status === 'usable'
      ? { collectionId: claimedCollectionId, unavailable: false }
      : { collectionId: null, unavailable: true };
  } catch {
    return { collectionId: claimedCollectionId, unavailable: false };
  }
}
