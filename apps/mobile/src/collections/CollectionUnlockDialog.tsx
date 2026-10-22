import type { Collection } from './api/collectionsApi';
import { contentGateOf, isSharedWithMe } from './collectionAccess';
import { CollectionUnlockModal } from './CollectionUnlockModal';

interface CollectionUnlockDialogProps {
  /** The locked Collection to ask the password for; null = closed. */
  readonly collection: Collection | null;
  /** Receives the grant - it is handed to the caller only, never stored for anything else. */
  readonly onGranted: (unlockToken: string) => void;
  readonly onCancel: () => void;
  /** The attempt hit a state that no longer exists (the lock / password was removed): the caller re-reads and goes on. */
  readonly onStateChanged?: () => Promise<boolean>;
}

/**
 * The password prompt for touching a protected Collection from outside it (the Collection picker) -
 * the Owner's lock password, or for a member the Collection's share password (see contentGateOf):
 * a correct password resolves with a grant for the caller; a wrong one keeps the prompt open with
 * the reason, and cancelling changes nothing.
 */
export function CollectionUnlockDialog({ collection, onGranted, onCancel, onStateChanged }: CollectionUnlockDialogProps) {
  if (!collection) {
    return null;
  }
  return (
    <CollectionUnlockModal
      // A new prompt when the KIND of password changes under it (lock <-> share password): no leftover text.
      key={`${collection.id}-${contentGateOf(collection) ?? 'lock'}`}
      collectionId={collection.id}
      collectionName={collection.name}
      isOwner={!isSharedWithMe(collection)}
      kind={contentGateOf(collection) ?? 'lock'}
      onCancel={onCancel}
      onGranted={onGranted}
      onStateChanged={onStateChanged}
      onUnlocked={() => undefined}
      testID="collection-unlock-dialog"
      visible
    />
  );
}
