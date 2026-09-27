import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';

/**
 * Settings > 컬렉션 잠금: the signed-in user's one Collection lock password, which opens every
 * Collection they lock. Passwords are only ever sent in these request bodies - never stored, logged
 * or returned.
 */
export interface CollectionLockPasswordStatus {
  readonly isConfigured: boolean;
  readonly passwordChangedAtUtc: string | null;
}

const PATH = '/api/v1/users/me/collection-lock';

export async function getCollectionLockPasswordStatus(request: AuthenticatedApiRequest): Promise<CollectionLockPasswordStatus> {
  const response = await request<CollectionLockPasswordStatus>({ method: 'GET', path: PATH });
  if (!response.body) {
    throw new Error('Juple API returned no Collection lock password status.');
  }
  return response.body;
}

/**
 * Rejects with ApiError forbidden/"invalidCollectionPassword" for a wrong current password,
 * tooManyRequests after repeated failures, conflict/"collectionLockPasswordNotConfigured" when none is set.
 */
export async function changeCollectionLockPassword(
  request: AuthenticatedApiRequest,
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
): Promise<void> {
  await request<void>({ method: 'PUT', path: PATH, body: { currentPassword, newPassword, confirmPassword } });
}

/**
 * First setup and "forgot password". The server accepts it only within minutes of a real sign-in,
 * judged from the access token itself - call it right after reauthenticateSameAccount(). Rejects
 * with ApiError forbidden/"recentAuthenticationRequired" otherwise.
 */
export async function resetCollectionLockPassword(
  request: AuthenticatedApiRequest,
  newPassword: string,
  confirmPassword: string,
): Promise<void> {
  await request<void>({ method: 'POST', path: `${PATH}/reset`, body: { newPassword, confirmPassword } });
}
