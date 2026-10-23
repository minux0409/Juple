import { ApiHttpError, type AppApi } from './appApi.ts';

/** The existing mobile API. Only invitations addressed to the signed-in caller are returned. */
export interface ReceivedCollectionInvitation {
  readonly invitationId: number;
  readonly collectionId: number;
  readonly collectionName: string;
  readonly icon?: string | null;
  readonly color?: string | null;
  readonly ownerJupleId: string;
  readonly ownerDisplayName?: string | null;
  readonly ownerProfileImageUrl?: string | null;
  readonly role: string;
  readonly createdAtUtc: string;
  readonly expiresAtUtc: string;
}

export const RECEIVED_INVITATIONS_PATH = '/api/v1/users/me/collection-invitations';
export const COLLECTION_INVITATIONS_HREF = '/collections?tab=shared&invitations=1';

export async function receivedInvitations(api: AppApi): Promise<readonly ReceivedCollectionInvitation[]> {
  const { items } = await api<{ items: readonly ReceivedCollectionInvitation[] }>({ path: RECEIVED_INVITATIONS_PATH });
  // The existing server serializes the enum with ToString() (Viewer / Submitter / Contributor).
  // Sharing labels use lowercase roles, as do older web fixtures. Normalize only the display DTO;
  // authority and accept/decline permissions remain entirely server-controlled.
  return items.map(item => typeof item.role === 'string' ? { ...item, role: item.role.toLowerCase() } : item);
}

/** A stale invitation is an operation result; authentication/permission/network errors still reach the caller. */
export async function respondToInvitation(api: AppApi, id: number, accept: boolean): Promise<'done' | 'stale'> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid invitation id');
  try {
    await api({ method: 'POST', path: `/api/v1/collection-invitations/${id}/${accept ? 'accept' : 'decline'}` });
    return 'done';
  } catch (error) {
    if (error instanceof ApiHttpError && (error.status === 404 || error.status === 409 && error.code === 'invitationNotPending')) return 'stale';
    throw error;
  }
}
