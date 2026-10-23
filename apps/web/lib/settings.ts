import { ApiHttpError } from './appApi.ts';
import { formatMessage, type AppDictionary } from './appI18n.ts';

/**
 * The rules behind 내 페이지's pages - ports of the mobile ones on the same API, kept pure for tests. The server validates everything
 * again; these only decide what is said.
 */

// ---- nickname (mobile api/profileApi.ts) -------------------------------------------------------------------------------------

/** The Backend's UserDisplayName limits: 30 user-perceived characters (the server counts), at most 512 UTF-16 units sent. */
export const DISPLAY_NAME_MAX_LENGTH = 30;
export const DISPLAY_NAME_MAX_STORAGE_LENGTH = 512;

const NICKNAME_ERROR_KEYS = {
  nicknameTooLong: 'nicknameTooLong',
  nicknameInvalidCharacters: 'nicknameInvalidCharacters',
  nicknameReserved: 'nicknameReserved',
  nicknameProhibited: 'nicknameProhibited',
} as const;

/** From the server's stable code, never its message text (mobile getNicknameErrorKey). An empty nickname clears it. */
export function nicknameErrorMessage(error: unknown, dictionary: AppDictionary): string {
  if (error instanceof ApiHttpError && error.status === 400) {
    const key = error.code && Object.hasOwn(NICKNAME_ERROR_KEYS, error.code) ? NICKNAME_ERROR_KEYS[error.code as keyof typeof NICKNAME_ERROR_KEYS] : 'nicknameInvalid';
    return formatMessage(dictionary[key], { max: DISPLAY_NAME_MAX_LENGTH });
  }
  return dictionary.profileSaveFallback;
}

// ---- collection lock password (mobile settings/CollectionLockPasswordDialog.tsx) --------------------------------------------

export const LOCK_PASSWORD_MIN_LENGTH = 6;
export const LOCK_PASSWORD_MAX_LENGTH = 64;
export const RECENT_AUTHENTICATION_REQUIRED_CODE = 'recentAuthenticationRequired';
export const COLLECTION_LOCK_PATH = '/api/v1/users/me/collection-lock';

export interface CollectionLockStatus {
  readonly isConfigured: boolean;
  readonly passwordChangedAtUtc: string | null;
}

/** Checked before anything is sent: the current password (when changing), 6..64 characters, and the confirmation. */
export function lockPasswordProblem(mode: 'change' | 'reset', current: string, next: string, confirm: string, dictionary: AppDictionary): string | null {
  if (mode === 'change' && !current) {
    return dictionary.lockCurrentPasswordRequired;
  }
  if (next.length < LOCK_PASSWORD_MIN_LENGTH || next.length > LOCK_PASSWORD_MAX_LENGTH) {
    return formatMessage(dictionary.lockPasswordRule, { min: LOCK_PASSWORD_MIN_LENGTH });
  }
  if (next !== confirm) {
    return dictionary.lockPasswordMismatch;
  }
  return null;
}

/** 'signInExpired': the fresh sign-in is too old for the server - sign in again. */
export function lockSaveFailure(error: unknown, dictionary: AppDictionary): { readonly signInExpired: boolean; readonly message: string } {
  if (error instanceof ApiHttpError) {
    if (error.code === RECENT_AUTHENTICATION_REQUIRED_CODE) {
      return { signInExpired: true, message: dictionary.collectionLockSignInExpired };
    }
    if (error.status === 403 && error.code === 'invalidCollectionPassword') {
      return { signInExpired: false, message: dictionary.lockWrongCurrentPassword };
    }
    if (error.status === 429) {
      return { signInExpired: false, message: dictionary.lockTooManyAttempts };
    }
    if (error.status === 400) {
      return { signInExpired: false, message: formatMessage(dictionary.lockPasswordRule, { min: LOCK_PASSWORD_MIN_LENGTH }) };
    }
  }
  return { signInExpired: false, message: dictionary.lockSaveFallback };
}

// ---- account deletion (mobile screens/DeleteAccountScreen.tsx) -----------------------------------------------------------------

/** The typed Juple ID, compared without spaces, @ or the display hyphen, case-insensitively (mobile normalizeTypedJupleId). */
export function normalizeTypedJupleId(value: string): string {
  return value.replace(/[\s@-]/g, '').toUpperCase();
}

export function isDeletionConfirmed(typed: string, jupleId: string | null | undefined): boolean {
  return Boolean(jupleId) && normalizeTypedJupleId(typed) === normalizeTypedJupleId(jupleId ?? '');
}

// ---- friends (mobile friends/api/friendsApi.ts, AddFriendModal) ---------------------------------------------------------------

export interface Friend {
  readonly friendshipId: number;
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly myNote: string | null;
  readonly friendsSinceUtc: string;
  readonly profileImageUrl?: string | null;
}

export interface FriendRequest {
  readonly requestId: number;
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly direction: 'incoming' | 'outgoing';
  readonly createdAtUtc: string;
  /** The other person's photo as the API returns it (a signed read URL); absent when they have none. */
  readonly profileImageUrl?: string | null;
  readonly profileImageVersion?: string | null;
}

export interface JupleIdLookup {
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly profileImageUrl?: string | null;
  readonly isSelf?: boolean;
}

/** Mobile FRIEND_NOTE limits: one line, 200 user-perceived characters (the server counts), 1000 UTF-16 units sent. */
export const FRIEND_NOTE_MAX_STORAGE_LENGTH = 1000;

/** The server's own verdict that an accept / decline / cancel hit a request that is not open any more (mobile). */
export const FRIEND_REQUEST_NO_LONGER_PENDING = 'requestNoLongerPending';

/**
 * The words for a refused friend action - exactly the mobile getFriendRequestErrorMessage: 404 + requestNoLongerPending (withdrawn /
 * already answered), 409 by code, 400 = yourself, 404 = no such Juple ID, 429 = too many requests.
 */
export function friendRequestFailure(error: unknown, dictionary: AppDictionary, intent: 'send' | 'answer' | 'cancel' = 'send'): string {
  if (error instanceof ApiHttpError) {
    if (error.status === 404 && error.code === FRIEND_REQUEST_NO_LONGER_PENDING) {
      return intent === 'cancel' ? dictionary.friendsRequestNoLongerPending : dictionary.friendsRequestCancelledByRequester;
    }
    if (error.status === 409) {
      switch (error.code) {
        case 'alreadyFriends':
          return dictionary.friendsAlreadyFriends;
        case 'requestPending':
          return dictionary.friendsRequestAlreadyPending;
        case 'incomingRequestExists':
          return dictionary.friendsIncomingRequestExists;
      }
    }
    if (error.status === 400) {
      return dictionary.friendsCannotAddSelf;
    }
    if (error.status === 404) {
      return dictionary.lookupNotFound;
    }
    if (error.status === 429) {
      return dictionary.tooManyRequests;
    }
  }
  return dictionary.friendsActionFallback;
}

/** Mobile getLookupErrorMessage. */
export function lookupFailure(error: unknown, dictionary: AppDictionary): string {
  if (error instanceof ApiHttpError) {
    if (error.status === 404) {
      return dictionary.lookupNotFound;
    }
    if (error.status === 429) {
      return dictionary.tooManyRequests;
    }
  }
  return dictionary.lookupFallback;
}
