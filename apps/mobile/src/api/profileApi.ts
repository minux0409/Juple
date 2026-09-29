import { ApiError } from './ApiError';
import type { AuthenticatedApiRequest } from './useAuthenticatedApi';

/**
 * How the account signs in, read by the server from the current access token (Juple itself keeps
 * no password). "unknown" (or a value an older/newer server sends that this app does not know)
 * means the app offers no password management at all rather than guessing.
 */
export type SignInMethod = 'email' | 'google' | 'apple' | 'unknown';

/** The signed-in user's own profile - never an internal id. */
export interface UserProfile {
  /** Optional nickname shown to other people; null when not set (the Juple ID is shown instead). */
  readonly displayName: string | null;
  readonly jupleId: string;
  /** Short-lived signed URL of the profile photo; null without one. Never cache on this string. */
  readonly profileImageUrl?: string | null;
  /** Stable identity of the photo - changes exactly when it is replaced or removed. */
  readonly profileImageVersion?: string | null;
  readonly signInMethod?: string | null;
}

/** Mirrors the Backend's UserDisplayName limit (user-perceived characters). */
export const DISPLAY_NAME_MAX_LENGTH = 30;

/**
 * The Backend's technical cap in UTF-16 code units (its column size). The text input limits by
 * this, not by DISPLAY_NAME_MAX_LENGTH, so a valid name made of multi-unit emoji sequences is never
 * cut off while typing; the server enforces the 30-character rule.
 */
export const DISPLAY_NAME_MAX_STORAGE_LENGTH = 512;

export function resolveSignInMethod(profile: Pick<UserProfile, 'signInMethod'> | null): SignInMethod {
  const value = profile?.signInMethod;
  return value === 'email' || value === 'google' || value === 'apple' ? value : 'unknown';
}

export async function getMyProfile(request: AuthenticatedApiRequest): Promise<UserProfile> {
  const response = await request<UserProfile>({ method: 'GET', path: '/api/v1/users/me/profile' });
  if (!response.body) {
    throw new Error('Juple API returned no profile.');
  }
  return response.body;
}

/**
 * Validated by the server (the only authority): an empty value clears the nickname. Rejects with
 * ApiError badRequest carrying a stable code - see getNicknameErrorKey.
 */
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

/** A picked photo for the profile (see setMyProfileImage). */
export interface ProfileImageAsset {
  readonly uri: string;
  /** The picker's own reported MIME type - the server checks the real format by magic bytes. */
  readonly type?: string;
  readonly fileName?: string;
}

const PROFILE_IMAGE_UPLOAD_TIMEOUT_MS = 60_000;

/** Replaces the caller's own profile photo. Returns the updated profile. */
export async function setMyProfileImage(request: AuthenticatedApiRequest, asset: ProfileImageAsset): Promise<UserProfile> {
  const formData = new FormData();
  formData.append('file', { uri: asset.uri, type: asset.type, name: asset.fileName ?? 'profile' });
  const response = await request<UserProfile>({
    method: 'PUT',
    path: '/api/v1/users/me/profile/image',
    formData,
    timeoutMs: PROFILE_IMAGE_UPLOAD_TIMEOUT_MS,
  });
  if (!response.body) {
    throw new Error('Juple API returned no profile.');
  }
  return response.body;
}

/** Back to the fallback avatar (idempotent). Returns the updated profile. */
export async function removeMyProfileImage(request: AuthenticatedApiRequest): Promise<UserProfile> {
  const response = await request<UserProfile>({ method: 'DELETE', path: '/api/v1/users/me/profile/image' });
  if (!response.body) {
    throw new Error('Juple API returned no profile.');
  }
  return response.body;
}

const NICKNAME_ERROR_KEYS: Readonly<Record<string, string>> = {
  nicknameTooLong: 'profile.nicknameTooLong',
  nicknameInvalidCharacters: 'profile.nicknameInvalidCharacters',
  nicknameReserved: 'profile.nicknameReserved',
  nicknameProhibited: 'profile.nicknameProhibited',
};

/** The locale message key for a rejected nickname - from the server's stable code, never its message text. */
export function getNicknameErrorKey(error: unknown): string {
  if (error instanceof ApiError && error.kind === 'badRequest') {
    return (error.code && NICKNAME_ERROR_KEYS[error.code]) || 'profile.nicknameInvalid';
  }
  return 'profile.saveFallback';
}
