/**
 * "A link changed" - one tiny in-memory signal (no storage, nothing sent anywhere). With the Quick Detail sheet the list under it stays
 * mounted (that is the point: same page, same scroll), so after a 삭제 / 컬렉션에서 삭제 / 수정 the lists change themselves instead
 * of waiting for a remount that no longer happens.
 *
 * The signal says WHAT happened, because the lists react differently:
 *  - `deleted`: the link itself is gone (soft-deleted, or found gone) - it leaves every ordinary list (Home, 보관함, every Collection).
 *  - `removedFromCollection`: only that one membership went - the link stays in 보관함 / Home and its other Collections; only the
 *    list of THAT Collection loses it.
 *  - `updated`: something about the link changed (text, photos, Collections) - lists read themselves again, nothing is removed.
 *  - `refresh`: several links changed at once (a merge and its undo) - lists read themselves again.
 */
export type ItemChange =
  | { readonly kind: 'deleted'; readonly itemId: number }
  | { readonly kind: 'removedFromCollection'; readonly itemId: number; readonly collectionId: number }
  | { readonly kind: 'updated'; readonly itemId: number }
  | { readonly kind: 'refresh' };

/** Which list hears it: the person's own links (Home / 보관함) or one Collection's links. */
export type ItemListScope = { readonly kind: 'personal' } | { readonly kind: 'collection'; readonly collectionId: number };

type Listener = (change: ItemChange) => void;

const listeners = new Set<Listener>();

export function notifyItemsChanged(change: ItemChange): void {
  for (const listener of [...listeners]) {
    listener(change);
  }
}

export function subscribeItemsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the change takes the link OUT of a list of this scope (nothing else removes: an edit only re-reads). */
export function removesFromList(
  change: ItemChange,
  scope: ItemListScope,
): change is Extract<ItemChange, { readonly kind: 'deleted' | 'removedFromCollection' }> {
  switch (change.kind) {
    case 'deleted':
      return true;
    case 'removedFromCollection':
      // Never from 보관함 / Home (the link still exists there) and never from another Collection.
      return scope.kind === 'collection' && scope.collectionId === change.collectionId;
    default:
      return false;
  }
}

/** Whether a list of this scope has anything to learn from the change (a membership removed elsewhere changes nothing here). */
export function affectsList(change: ItemChange, scope: ItemListScope): boolean {
  return change.kind !== 'removedFromCollection' || removesFromList(change, scope);
}
