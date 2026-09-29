import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';
import { storedUnlockHeaders } from '../collectionUnlockGrants';
import type { CollectionUnlockGrant } from './collectionsApi';

/**
 * A Collection's own share password - separate from its Owner's Collection lock password. The Owner
 * manages it on the Share screen (and is never asked for it); members and public-link visitors must
 * prove it before the Collection's content opens. The status never carries the password: it is only
 * ever returned by revealSharePassword, on the Owner's explicit request.
 */
export type SharePasswordMode = 'none' | 'legacyCommonLock' | 'perCollection';

export interface SharePasswordStatus {
  /**
   * 'legacyCommonLock': a Collection locked before share passwords existed - its recipients still
   * open it with the Owner's Collection lock password until the Owner sets a share password.
   */
  readonly mode: SharePasswordMode;
  readonly isEnabled: boolean;
  readonly updatedAtUtc: string | null;
}

const path = (collectionId: number) => `/api/v1/collections/${collectionId}/share-password`;

function requireBody<T>(body: T | null | undefined, what: string): T {
  if (body === null || body === undefined) {
    throw new Error(`Juple API returned no ${what}.`);
  }
  return body;
}

/** Owner only. */
export async function getSharePasswordStatus(request: AuthenticatedApiRequest, collectionId: number): Promise<SharePasswordStatus> {
  const response = await request<SharePasswordStatus>({ method: 'GET', path: path(collectionId) });
  return requireBody(response.body, 'share password status');
}

/**
 * Owner only; a locked Collection sends this visit's lock grant. Sets or changes the password -
 * recipients are asked again right away. The Owner types it once, in plain view, so there is no
 * separate confirmation: the same value fills the API's confirmPassword field (contract unchanged).
 */
export async function setSharePassword(
  request: AuthenticatedApiRequest,
  collectionId: number,
  password: string,
): Promise<SharePasswordStatus> {
  const response = await request<SharePasswordStatus>({
    method: 'PUT',
    path: path(collectionId),
    body: { password, confirmPassword: password },
    headers: storedUnlockHeaders(collectionId),
  });
  return requireBody(response.body, 'share password status');
}

/** Owner only, same gates. Removes the protection; the sharing itself stays as it is. */
export async function removeSharePassword(request: AuthenticatedApiRequest, collectionId: number): Promise<SharePasswordStatus> {
  const response = await request<SharePasswordStatus>({
    method: 'DELETE',
    path: path(collectionId),
    headers: storedUnlockHeaders(collectionId),
  });
  return requireBody(response.body, 'share password status');
}

/** Owner only, same gates. The password itself - only when the Owner asks to see it; never cached or logged. */
export async function revealSharePassword(request: AuthenticatedApiRequest, collectionId: number): Promise<string> {
  const response = await request<{ readonly password: string }>({
    method: 'POST',
    path: `${path(collectionId)}/reveal`,
    headers: storedUnlockHeaders(collectionId),
  });
  return requireBody(response.body, 'share password').password;
}

/** A member proves the share password; the grant travels like a lock grant (X-Juple-Collection-Unlock). */
export async function unlockSharePassword(
  request: AuthenticatedApiRequest,
  collectionId: number,
  password: string,
): Promise<CollectionUnlockGrant> {
  const response = await request<CollectionUnlockGrant>({
    method: 'POST',
    path: `${path(collectionId)}/unlock`,
    body: { password },
  });
  return requireBody(response.body, 'unlock grant');
}
