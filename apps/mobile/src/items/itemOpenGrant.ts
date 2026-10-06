/**
 * The hand-off of ONE Home/Archive locked-link opening's unlock grant from the card tap (useItemCardOpen) to the Item
 * Details popup it opens - so the grant itself never goes into navigation state. One slot, in memory only (never
 * AsyncStorage, never a cache that outlives the opening): a new opening replaces it, and the popup takes it exactly
 * once when it mounts, keeping it only for its own lifetime. Closing the popup therefore drops it - the next tap on the
 * same card asks for the password again. The grant opens nothing by itself: the server checks it, per Collection,
 * against the Collection's current lock (GET items/{id}?collectionId=).
 */

/** Where a link is being opened: in the Collection that gates its Home/Archive card. */
export interface ItemOpenContext {
  readonly collectionId: number;
  /** The key to take this opening's grant with (see takeItemOpenGrant), or null when the Collection was not locked. */
  readonly grantKey: string | null;
}

let slot: { readonly key: string; readonly collectionId: number; readonly unlockToken: string } | null = null;
let sequence = 0;

/** Leaves this opening's grant for the popup about to open; returns the key it takes it with. */
export function handOffItemOpenGrant(collectionId: number, unlockToken: string): string {
  sequence += 1;
  const key = `open-${sequence}-${Date.now()}`;
  slot = { key, collectionId, unlockToken };
  return key;
}

/** Takes (and forgets) the grant left under this key for this Collection; null when there is none any more. */
export function takeItemOpenGrant(key: string | null | undefined, collectionId: number): string | null {
  if (!key || slot === null || slot.key !== key || slot.collectionId !== collectionId) {
    return null;
  }
  const { unlockToken } = slot;
  slot = null;
  return unlockToken;
}

/** For tests and sign-out. */
export function clearItemOpenGrant(): void {
  slot = null;
}
