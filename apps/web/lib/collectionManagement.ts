import { ApiHttpError, type AppApi } from './appApi.ts';
import type { AppDictionary } from './appI18n.ts';
import { COLLECTION_LOCK_PATH, type CollectionLockStatus } from './settings.ts';

export const collectionDeletePath = (collectionId: number) => `/api/v1/collections/${collectionId}`;
export const collectionSetLockPath = (collectionId: number) => `/api/v1/collections/${collectionId}/lock`;
export const collectionRemoveLockPath = (collectionId: number) => `/api/v1/collections/${collectionId}/lock/remove`;
/** A MEMBER's personal lock (their own password; the Owner and the other members are not affected) - the Owner has the paths above. */
export const collectionSetMemberLockPath = (collectionId: number) => `/api/v1/collections/${collectionId}/member-lock`;
export const collectionRemoveMemberLockPath = (collectionId: number) => `/api/v1/collections/${collectionId}/member-lock/remove`;
export const collectionLeavePath = (collectionId: number) => `/api/v1/collections/${collectionId}/collaborators/me`;

export async function collectionLockIsConfigured(api: AppApi): Promise<boolean> {
  const status = await api<CollectionLockStatus>({ path: COLLECTION_LOCK_PATH });
  return status.isConfigured;
}

export function collectionManagementError(error: unknown, dictionary: AppDictionary, action: 'delete' | 'leave' | 'lock' | 'remove'): string {
  if (action === 'delete') {
    return dictionary.collectionDeleteError;
  }
  if (action === 'leave') {
    return dictionary.collectionLeaveError;
  }
  if (error instanceof ApiHttpError) {
    if (error.status === 403 && error.code === 'invalidCollectionPassword') {
      return dictionary.lockWrongPassword;
    }
    if (error.status === 429) {
      return dictionary.lockTooManyAttempts;
    }
    if (error.code === 'collectionLockPasswordNotConfigured') {
      return dictionary.lockPasswordNotConfigured;
    }
  }
  return dictionary.lockSaveFallback;
}
