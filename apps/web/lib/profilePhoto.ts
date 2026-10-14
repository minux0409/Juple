import { ApiHttpError } from './appApi.ts';
import { PROFILE_PATH } from './accountDisplay.ts';

/**
 * The profile photo on the Web - the mobile flow and the same server (apps/mobile/src/api/profileApi.ts setMyProfileImage /
 * removeMyProfileImage): PUT / DELETE /api/v1/users/me/profile/image, one `file` form part, the updated profile comes back. The server
 * is the judge of the real format and the size; the checks here only spare a pointless upload and use the same words.
 */
export const PROFILE_IMAGE_PATH = `${PROFILE_PATH}/image`;
/** The photo types the server accepts (mobile: JPEG / PNG / WebP) and its limit (mobile "5 MB or less"). */
export const PROFILE_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';
export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

const ACCEPTED_TYPES: readonly string[] = PROFILE_PHOTO_ACCEPT.split(',');

/** Whether a picked file may be sent at all: an allowed type and a size within the limit (and not empty). */
export function isUsableProfilePhoto(file: { readonly type: string; readonly size: number }): boolean {
  return ACCEPTED_TYPES.includes(file.type) && file.size > 0 && file.size <= PROFILE_PHOTO_MAX_BYTES;
}

/** The mobile wording: a 400 is "this photo cannot be used"; anything else is the general "could not save". */
export function profilePhotoErrorMessage(error: unknown, dictionary: { readonly profilePhotoInvalid: string; readonly profilePhotoSaveFallback: string }): string {
  return error instanceof ApiHttpError && (error.status === 400 || error.status === 413 || error.status === 415) ? dictionary.profilePhotoInvalid : dictionary.profilePhotoSaveFallback;
}

export function profilePhotoForm(file: File): FormData {
  const form = new FormData();
  form.append('file', file, file.name || 'profile');
  return form;
}
