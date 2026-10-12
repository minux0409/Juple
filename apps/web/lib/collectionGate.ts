import type { CollectionSummary } from './collectionsView.ts';
import { isCollectionLocked } from './collectionsView.ts';
import { isSharedWithMe } from './collectionSharing.ts';

/**
 * Which password stands before a Collection's content for the caller (mobile collectionAccess.contentGateOf) - read from the
 * Collection card the server sends, never inferred beyond these fields: the Owner meets only their Collection lock; someone it is
 * shared with meets its share password when it has one, else the Owner's lock only on a legacy Collection (the server reports
 * isLocked to a member only then). Null: nothing to prove.
 */
export type CollectionContentGate = 'lock' | 'sharePassword';

export function collectionContentGate(
  collection: Pick<CollectionSummary, 'accessRole' | 'isLocked'> & { readonly isSharePasswordProtected?: boolean },
): CollectionContentGate | null {
  if (isSharedWithMe(collection) && collection.isSharePasswordProtected === true) {
    return 'sharePassword';
  }
  return isCollectionLocked(collection) ? 'lock' : null;
}

/** What the picker found when it read the Collection again at the moment of the tap (mobile resolveFreshCollectionAccess). */
export type FreshCollectionAccess =
  | { readonly status: 'ok'; readonly collection: CollectionSummary & { readonly isSharePasswordProtected?: boolean }; readonly gate: CollectionContentGate | null }
  /** Gone for the caller (deleted, access removed, or now view-only): it cannot take this action. */
  | { readonly status: 'unavailable' }
  /** The read itself failed (offline...): keep what was known - the server still enforces everything on the real action. */
  | { readonly status: 'unknown' };
