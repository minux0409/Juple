import type { AuthenticatedApiRequest } from './useAuthenticatedApi';

/** The signed-in user's own public-facing profile - never an internal id or email. */
export interface UserProfile {
  /** Optional name shown to collaborators; null when not set (the Juple ID is shown instead). */
  readonly displayName: string | null;
  readonly jupleId: string;
}

/** Mirrors the Backend's UserDisplayName limit (user-perceived characters). */
export const DISPLAY_NAME_MAX_LENGTH = 30;

/**
 * The Backend's technical cap in UTF-16 code units (its column size). The text input limits by
 * this, not by DISPLAY_NAME_MAX_LENGTH, so a valid name made of multi-unit emoji sequences is never
 * cut off while typing; the server enforces the 30-character rule.
 */
export const DISPLAY_NAME_MAX_STORAGE_LENGTH = 512;

export async function getMyProfile(request: AuthenticatedApiRequest): Promise<UserProfile> {
  const response = await request<UserProfile>({ method: 'GET', path: '/api/v1/users/me/profile' });
  if (!response.body) {
    throw new Error('Juple API returned no profile.');
  }
  return response.body;
}

/** Trimmed server-side; an empty value clears the name. Rejects with ApiError badRequest for an invalid name. */
export async function setMyDisplayName(request: AuthenticatedApiRequest, displayName: string): Promise<UserProfile> {
  const response = await request<UserProfile>({
    method: 'PUT',
    path: '/api/v1/users/me/profile/display-name',
    body: { displayName },
  });
  if (!response.body) {
    throw new Error('Juple API returned no profile.');
  }
  return response.body;
}
