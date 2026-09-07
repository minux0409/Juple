import { ApiError } from './ApiError';
import type { AuthenticatedApiRequest } from './useAuthenticatedApi';

/**
 * Permanently deletes the current user's Juple account and all data Juple owns for it (Backend
 * AccountController/IDeleteAccountService). Not soft delete, not recoverable. A 'conflict' (409)
 * means the identity no longer resolves to a Juple user - already deleted by an earlier call
 * (e.g. a retried tap after a lost response) - so it is treated as a no-op success, the same way
 * unregisterPushDevice already treats a 404 as a no-op.
 */
export async function deleteAccount(request: AuthenticatedApiRequest): Promise<void> {
  try {
    await request<void>({
      method: 'DELETE',
      path: '/api/v1/account',
    });
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'conflict') {
      return;
    }
    throw error;
  }
}
