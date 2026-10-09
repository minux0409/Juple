import { requestApi } from '../../api/apiClient';
import { v4 as uuidv4 } from 'uuid';
import { COLLECTION_UNLOCK_HEADER_NAME } from '../collectionUnlockGrants';

/**
 * The anonymous Public Collection Sharing API only (api/v1/public/collections/*) - mirrors
 * apps/web's lib/publicApi.ts. Deliberately never imports useAuthenticatedApi/getValidAccessToken:
 * a shared Collection opened via a deep link (see screens/SharedCollectionScreen.tsx) must work
 * for a signed-out user, and must never resolve to the authenticated /api/v1/collections/* surface
 * even for a signed-in one - the publicId is opaque and carries no ownership.
 */

/**
 * Mirrors the Backend's PublicCollectionDto. A locked share not yet unlocked has a null name and
 * no permission. permission 'write' means signed-in holders may add their own links.
 */
export interface PublicCollection {
  readonly name: string | null;
  readonly isLocked?: boolean;
  /** 'submit' (승인 후 추가): signed-in holders propose links that join once the Owner approves them. */
  readonly permission?: 'read' | 'submit' | 'write' | null;
  /**
   * false: a PRIVATE link (공용 컬렉션 OFF) - only the name is known, no items and no permission; the only possible action is a join
   * request. Absent (older server) = public.
   */
  readonly isPublic?: boolean;
  /** The Collection's own look (icon, color, profile photo - never content) for the 컬렉션 추가 / 참가 요청 dialogs. */
  readonly icon?: string | null;
  readonly color?: string | null;
  /** The Collection's own profile photo (signed read URL + stable version), when it has one - never an item image. */
  readonly iconImageUrl?: string | null;
  readonly iconImageVersion?: string | null;
}

/** Mirrors the Backend's PublicCollectionItemDto - Title and the original Url only. */
export interface PublicCollectionItem {
  readonly title: string | null;
  readonly url: string;
}

export interface PublicCollectionItemsPage {
  readonly items: readonly PublicCollectionItem[];
  readonly nextCursor: string | null;
}

/**
 * The short-lived grant a password-protected link hands out after its password was verified (the same grant the Web Viewer keeps in an
 * HttpOnly cookie): sent as a header, never in a URL, held only in memory by the caller. It is bound to this one link, grants no
 * membership and no identity.
 */
export function unlockHeaders(unlockToken: string | undefined): Readonly<Record<string, string>> | undefined {
  return unlockToken ? { [COLLECTION_UNLOCK_HEADER_NAME]: unlockToken } : undefined;
}

export interface PublicUnlockGrant {
  readonly unlockToken: string;
  readonly expiresAtUtc: string;
}

/** An opaque per-app-session id that only scopes the Backend's failed-attempt counter (never identity). Memory only. */
let unlockAttemptId: string | null = null;

/**
 * Verifies a protected link's password with the Backend (the same endpoint the Web Viewer uses; throttled server-side) and returns the
 * short-lived grant. The password travels only in this request body - never stored, logged or put in a URL. ApiError kinds: 'forbidden'
 * (wrong password), 'tooManyRequests' (throttled), 'notFound' (link gone or not protected any more).
 */
export async function unlockPublicCollection(publicId: string, password: string): Promise<PublicUnlockGrant> {
  unlockAttemptId ??= uuidv4();
  const response = await requestApi<PublicUnlockGrant>({
    method: 'POST',
    path: `/api/v1/public/collections/${encodeURIComponent(publicId)}/unlock`,
    body: { password },
    headers: { 'X-Juple-Unlock-Attempt': unlockAttemptId },
  });
  if (!response.body?.unlockToken) {
    throw new Error('Juple API returned no unlock grant.');
  }
  return response.body;
}

/** Throws ApiError('notFound') for an unknown or revoked publicId - callers show the same "unavailable" state for both, never distinguishing them. */
export async function getPublicCollection(publicId: string, unlockToken?: string): Promise<PublicCollection> {
  const response = await requestApi<PublicCollection>({
    method: 'GET',
    path: `/api/v1/public/collections/${encodeURIComponent(publicId)}`,
    headers: unlockHeaders(unlockToken),
  });

  if (!response.body) {
    throw new Error('Juple API returned no public Collection body.');
  }

  return response.body;
}

export interface GetPublicCollectionItemsOptions {
  readonly limit?: number;
  /** Opaque value from a previous page's nextCursor; never parsed or modified. */
  readonly cursor?: string;
  /** A protected link's grant (see unlockPublicCollection). */
  readonly unlockToken?: string;
}

/** Same "notFound" rule as getPublicCollection. */
export async function getPublicCollectionItems(
  publicId: string,
  options: GetPublicCollectionItemsOptions = {},
): Promise<PublicCollectionItemsPage> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) {
    query.set('limit', String(options.limit));
  }
  if (options.cursor) {
    query.set('cursor', options.cursor);
  }
  const queryString = query.toString();

  const response = await requestApi<PublicCollectionItemsPage>({
    method: 'GET',
    path: queryString
      ? `/api/v1/public/collections/${encodeURIComponent(publicId)}/items?${queryString}`
      : `/api/v1/public/collections/${encodeURIComponent(publicId)}/items`,
    headers: unlockHeaders(options.unlockToken),
  });

  if (!response.body) {
    throw new Error('Juple API returned no public Collection Items page body.');
  }

  return response.body;
}
