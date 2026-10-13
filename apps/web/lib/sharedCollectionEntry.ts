import { ApiHttpError } from './appApi.ts';

/**
 * The rules of opening a Juple Collection share link, signed in (the mobile SharedCollectionScreen) - in one place, so the Home paste, a
 * typed /shared/{publicId} and the 새 링크 검토 safety net can never decide differently. The public share page (/c/{publicId}) shares the
 * two link facts below (public or not, profile visible or not until unlocked).
 *
 *  - a member (Owner, Contributor, Submitter, Viewer)        -> the normal Collection, no question
 *  - a nonmember of a PUBLIC link (공용 컬렉션 ON)              -> "컬렉션 추가" [취소] [저장] (저장 = Viewer at once, POST .../save)
 *  - a nonmember of a PRIVATE link (공용 컬렉션 OFF)            -> "참가 요청" [취소] [요청] (the Owner approves, POST .../join-requests)
 *  - a nonmember whose request is waiting                      -> "승인 대기 중" (no second request)
 *  - a password-protected link before its password            -> the password first (nothing of the Collection is shown)
 *  - unknown / revoked / unreadable                            -> one "unavailable" state, never a saved link
 * Opening a link creates nothing: membership or a request exists only after the explicit 저장 / 요청.
 */

/** GET /api/v1/public-shares/{publicId}/membership (signed in). collectionId / role exist ONLY for a member. */
export interface ShareMembership {
  readonly isMember: boolean;
  readonly collectionId: number | null;
  readonly role: 'owner' | 'contributor' | 'submitter' | 'viewer' | null;
  /** Non-members only: the request I made through this link waits for the Owner. */
  readonly joinRequestPending?: boolean;
}

/** GET /api/v1/public/collections/{publicId} - only the Collection's own profile, never its content. */
export interface ShareProfile {
  /** null until a protected link's password was proven. */
  readonly name: string | null;
  readonly isLocked: boolean;
  /** false: a PRIVATE link (공용 컬렉션 OFF). Absent (older API) = public. */
  readonly isPublic?: boolean;
  readonly icon?: string | null;
  readonly color?: string | null;
  readonly iconImageUrl?: string | null;
}

/** POST .../save and POST .../join-requests. collectionId only when I am a member afterwards. */
export interface ShareJoinResult {
  readonly outcome: 'joined' | 'alreadyMember' | 'requested' | 'alreadyRequested';
  readonly collectionId: number | null;
}

export function membershipPath(publicId: string): string {
  return `/api/v1/public-shares/${encodeURIComponent(publicId)}/membership`;
}

export function saveSharedCollectionPath(publicId: string): string {
  return `/api/v1/public-shares/${encodeURIComponent(publicId)}/save`;
}

export function joinRequestPath(publicId: string): string {
  return `/api/v1/public-shares/${encodeURIComponent(publicId)}/join-requests`;
}

/** The link's contents are public (공용 컬렉션 ON) - an absent flag (an older API) means public. Shared with the /c share page. */
export function isPublicShare(profile: Pick<ShareProfile, 'isPublic'>): boolean {
  return profile.isPublic !== false;
}

/** The Collection's profile can be shown - before a protected link's password nothing of it, not even its name, is known. Shared with the
 * /c share page. */
export function hasVisibleProfile<T extends { readonly name: string | null }>(profile: T): profile is T & { readonly name: string } {
  return profile.name !== null;
}

export type ShareEntry =
  | { readonly kind: 'member'; readonly collectionId: number }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'locked' }
  | { readonly kind: 'pending'; readonly profile: ShareProfile }
  | { readonly kind: 'publicAdd'; readonly profile: ShareProfile }
  | { readonly kind: 'privateRequest'; readonly profile: ShareProfile };

/**
 * What the link is for the signed-in person now. membership: the server's answer, null for an unknown / revoked link (404) or a failed
 * lookup (then the link's own state decides, as on mobile); profile: the link's profile, or 'unavailable' for any failure.
 */
export function decideShareEntry(membership: ShareMembership | null, profile: ShareProfile | 'unavailable'): ShareEntry {
  if (membership?.isMember && typeof membership.collectionId === 'number' && membership.collectionId > 0) {
    return { kind: 'member', collectionId: membership.collectionId };
  }
  if (profile === 'unavailable') {
    return { kind: 'unavailable' };
  }
  if (!hasVisibleProfile(profile)) {
    return profile.isLocked ? { kind: 'locked' } : { kind: 'unavailable' };
  }
  if (membership?.joinRequestPending === true) {
    return { kind: 'pending', profile };
  }
  return isPublicShare(profile) ? { kind: 'publicAdd', profile } : { kind: 'privateRequest', profile };
}

/** After 저장 / 요청: a member now -> that Collection; otherwise the request waits. */
export function joinResultDestination(result: ShareJoinResult): { readonly kind: 'open'; readonly collectionId: number } | { readonly kind: 'pending' } {
  return (result.outcome === 'joined' || result.outcome === 'alreadyMember') && typeof result.collectionId === 'number' && result.collectionId > 0
    ? { kind: 'open', collectionId: result.collectionId }
    : { kind: 'pending' };
}

/** The mobile joinErrorMessage keys; a 403 also means the password grant ran out (the caller asks for it again). */
export type ShareJoinErrorKey = 'joinNotAllowed' | 'joinLocked' | 'unavailable' | 'tooManyRequests' | 'joinFailed';

export function shareJoinErrorKey(error: unknown): ShareJoinErrorKey {
  if (error instanceof ApiHttpError) {
    if (error.status === 409 && error.code === 'joinNotAllowed') {
      return 'joinNotAllowed';
    }
    if (error.status === 403) {
      return 'joinLocked';
    }
    if (error.status === 404) {
      return 'unavailable';
    }
    if (error.status === 429) {
      return 'tooManyRequests';
    }
  }
  return 'joinFailed';
}

/**
 * The tile key of a Collection known only by its share link (the mobile shareEntryTileKey): a stable NEGATIVE number from the publicId -
 * the same Collection keeps the same fallback color, and it can never collide with a real Collection id.
 */
export function shareEntryTileKey(publicId: string): number {
  let hash = 5381;
  for (let index = 0; index < publicId.length; index += 1) {
    hash = (hash * 33 + publicId.charCodeAt(index)) % 4_294_967_296;
  }
  return -1 - (hash % 1_000_000_000);
}
