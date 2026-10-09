import type { Collection } from './api/collectionsApi';
import { canAddItemsTo, contentGateOf, isCollaborative, isSharedWithMe } from './collectionAccess';

/**
 * What the caller may do with a Collection - the ONE place the role rules live for menus and shortcuts, derived from the
 * server's own fields (accessRole, lock, share password) and never from an id comparison. It is a UI convenience only:
 * the backend independently enforces every one of these and refuses the rest.
 *
 * - Owner: everything below except leaving.
 * - Shared member (Contributor, Submitter, Viewer): their own favorite and notification setting, adding links where
 *   allowed (a Submitter proposes, a Viewer cannot), and leaving - never edit, delete or the Owner's lock.
 */
export interface CollectionCapabilities {
  readonly isOwner: boolean;
  /** Rename, icon, color, photo. */
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  /** A member can always leave; the Owner deletes instead. */
  readonly canLeave: boolean;
  /** The Owner's content lock (set / remove). */
  readonly canChangeLock: boolean;
  /** Put links in directly (Owner, Contributor) or as proposals (Submitter) - never a Viewer. */
  readonly canAddItem: boolean;
  /** The caller's own favorite mark - everyone, it changes nothing for anyone else. */
  readonly canToggleFavorite: boolean;
  /** 새 링크 알림: wherever someone else can add links. */
  readonly canToggleNotification: boolean;
  /** Offered as an app-shortcut / Direct Share destination: writable, and not behind a lock or access password. */
  readonly canPinShortcut: boolean;
}

export function getCollectionCapabilities(
  collection: Pick<Collection, 'accessRole' | 'isLocked' | 'isSharePasswordProtected' | 'hasCollaborators' | 'isPublicShareActive'>,
): CollectionCapabilities {
  const isOwner = !isSharedWithMe(collection);
  const canAddItem = canAddItemsTo(collection);
  return {
    isOwner,
    canEdit: isOwner,
    canDelete: isOwner,
    canLeave: !isOwner,
    canChangeLock: isOwner,
    canAddItem,
    canToggleFavorite: true,
    canToggleNotification: isCollaborative(collection),
    canPinShortcut: canAddItem && contentGateOf(collection) === null,
  };
}
