import type { Collection } from './api/collectionsApi';
import { getCollectionUnlockToken } from './collectionUnlockGrants';

/**
 * Pure readers of the server-provided collaboration/lock fields (see Collection.accessRole) - kept
 * out of collectionsApi.ts so screens and tests that mock the API module still get the real logic.
 */

/** Shared with the caller by someone else - as a Contributor (공동작업) or a Viewer (보기 전용). */
export function isSharedWithMe(collection: Pick<Collection, 'accessRole'>): boolean {
  return collection.accessRole === 'contributor' || collection.accessRole === 'viewer';
}

/** Whether the caller may put their own links into it: the Owner and Contributors, never a Viewer. */
export function canAddItemsTo(collection: Pick<Collection, 'accessRole'>): boolean {
  return collection.accessRole !== 'viewer';
}

export function isCollectionLocked(collection: Pick<Collection, 'isLocked'>): boolean {
  return collection.isLocked === true;
}

/**
 * A locked Collection whose content this app session has not unlocked yet: adding/removing links
 * would be rejected by the server (for the Owner too), so the UI must send the user through the
 * password panel first rather than let them pick it as a target.
 */
export function needsUnlockForContent(collection: Pick<Collection, 'id' | 'isLocked'>): boolean {
  return isCollectionLocked(collection) && getCollectionUnlockToken(collection.id) === null;
}

/**
 * Shown with the "shared" marker - exactly the server's 공유 컬렉션 ("shared") scope: shared with
 * me, or my own Collection that has members or an active 모든 사용자 link. (Move/merge rules look
 * at hasCollaborators alone - a public link never blocks those.)
 */
export function isCollaborative(collection: Pick<Collection, 'accessRole' | 'hasCollaborators' | 'isPublicShareActive'>): boolean {
  return isSharedWithMe(collection) || collection.hasCollaborators === true || collection.isPublicShareActive === true;
}
