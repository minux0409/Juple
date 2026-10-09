import type { Collection } from '../collections/api/collectionsApi';
import { getCollectionCapabilities } from '../collections/collectionCapabilities';

/**
 * Whether a Collection may be a launcher / Direct Share destination right now, and if not why. A shortcut's label is
 * visible OUTSIDE Juple's protected UI (launcher, share sheet), so a locked / access-password Collection is never
 * published, and a Collection the caller cannot add links to (a Viewer) is not a writable share destination.
 */
export type ShortcutIneligibility = 'locked' | 'cannotAdd';

export function getShortcutIneligibility(
  collection: Pick<Collection, 'accessRole' | 'isLocked' | 'isSharePasswordProtected' | 'hasCollaborators' | 'isPublicShareActive'>,
): ShortcutIneligibility | null {
  const capabilities = getCollectionCapabilities(collection);
  if (!capabilities.canAddItem) {
    return 'cannotAdd';
  }
  return capabilities.canPinShortcut ? null : 'locked';
}

export function isShortcutEligible(collection: Parameters<typeof getShortcutIneligibility>[0]): boolean {
  return getShortcutIneligibility(collection) === null;
}
