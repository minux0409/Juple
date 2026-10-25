/**
 * Who the signed-in person is shown as. Juple's own identity first - the same as the mobile 내 페이지 (GET /api/v1/users/me/profile:
 * the nickname, else the public Juple ID) - then what the sign-in itself carries, then a plain "계정". Never Microsoft Graph, never
 * an invented name.
 *
 * Microsoft Entra External ID puts the literal "unknown" in the ID token's `name` claim (MSAL AccountInfo.name) when the sign-up flow
 * collected no display name - a placeholder, not a name, so it is never shown.
 */

/** Mirrors GET /api/v1/users/me/profile (apps/mobile/src/api/profileApi.ts UserProfile) - only the fields the Web shows. */
export interface UserProfile {
  readonly displayName: string | null;
  readonly jupleId: string;
  /** Short-lived read URL of the person's own profile photo, null without one (mobile UserProfile.profileImageUrl). */
  readonly profileImageUrl?: string | null;
  /** How the account signs in, as the server reports it (mobile resolveSignInMethod): 'email' | 'google' | 'apple'; anything else is unknown. */
  readonly signInMethod?: string | null;
}

export const PROFILE_PATH = '/api/v1/users/me/profile';

/** The mobile format: the canonical XXXXXXXX, no separator (collaborationApi.ts formatJupleId); a typed XXXX-XXXX is still accepted by the server. */
export function formatJupleId(jupleId: string): string {
  return jupleId.replace(/[-\s]/g, '');
}

/** Values identity providers use when they have no real name - never shown. */
const PLACEHOLDER_NAMES = new Set(['unknown', 'null', 'undefined']);

function realText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text && !PLACEHOLDER_NAMES.has(text.toLowerCase()) ? text : null;
}

export interface AccountSources {
  /** The Juple profile, or null when it is not loaded (yet, or it failed). */
  readonly profile: UserProfile | null;
  /** MSAL AccountInfo.name (the ID token's `name`). */
  readonly accountName?: string | null;
  /** MSAL AccountInfo.username (the sign-in name - typically the email for External ID). */
  readonly accountUsername?: string | null;
}

/**
 * One line naming the person: the nickname, else @JUPL-EID0, else the sign-in's real name, else its sign-in name, else `fallback`
 * ("계정"). Never "unknown".
 */
export function accountLabel(sources: AccountSources, fallback: string): string {
  const nickname = realText(sources.profile?.displayName);
  if (nickname) {
    return nickname;
  }
  const jupleId = realText(sources.profile?.jupleId);
  if (jupleId) {
    return `@${formatJupleId(jupleId)}`;
  }
  return realText(sources.accountName) ?? realText(sources.accountUsername) ?? fallback;
}
