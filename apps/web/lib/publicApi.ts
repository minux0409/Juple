/**
 * Mirrors the Backend's PublicCollectionDto. A locked share answers { name: null, isLocked: true }
 * until a valid unlock grant is presented - the page must not render anything about it then.
 */
export interface PublicCollection {
  readonly name: string | null;
  readonly isLocked: boolean;
  /** false: a PRIVATE link (공용 컬렉션 OFF) - only the name is known and no content is served. Absent (older API) = public. */
  readonly isPublic?: boolean;
}

/**
 * Mirrors the Backend's PublicCollectionItemDto - Title, the original Url, and the automatic
 * link-preview image (from the linked page's own public metadata - never a user-uploaded photo).
 */
export interface PublicCollectionItem {
  readonly title: string | null;
  readonly url: string;
  readonly previewImageUrl: string | null;
}

export interface PublicCollectionItemsPage {
  readonly items: readonly PublicCollectionItem[];
  readonly nextCursor: string | null;
}

/** Returned instead of a page when the share is locked and no valid grant was sent. */
export const LOCKED = 'locked' as const;

/** The request header the unlock grant travels in (never a query string, so never in URL logs). */
const UNLOCK_HEADER = 'X-Juple-Collection-Unlock';

function unlockHeaders(unlockToken: string | undefined): HeadersInit | undefined {
  return unlockToken ? { [UNLOCK_HEADER]: unlockToken } : undefined;
}

async function isLockedResponse(response: Response): Promise<boolean> {
  if (response.status !== 403) {
    return false;
  }
  try {
    const problem = (await response.json()) as { code?: unknown };
    return problem.code === 'collectionLocked';
  } catch {
    return false;
  }
}

/**
 * apiBaseUrl is always passed in by the caller rather than read from an env var here - this keeps
 * the same Docker image usable across Dev/Staging/Prod with no rebuild: `JUPLE_API_BASE_URL` is a
 * genuine runtime env var (see app/c/[publicId]/page.tsx, which reads it fresh on every request -
 * safe because that Server Component is already dynamic via headers()), never NEXT_PUBLIC_*. The
 * "load more" pagination (ItemList.tsx) is a Client Component that calls this same function
 * directly from the browser for an unlocked share, so it receives apiBaseUrl as a prop threaded
 * down from page.tsx instead of reading any env var of its own. A locked share's grant is an
 * HttpOnly cookie, so its pages are fetched through this app's own route handler instead.
 */

/** Returns null for a 404 (unknown or revoked publicId) - callers render the not-found UI, never distinguishing the two. */
export async function getPublicCollection(
  apiBaseUrl: string,
  publicId: string,
  unlockToken?: string,
): Promise<PublicCollection | null> {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/public/collections/${encodeURIComponent(publicId)}`,
    { cache: 'no-store', headers: unlockHeaders(unlockToken) },
  );

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Juple Public API returned ${response.status} for collection ${publicId}.`);
  }

  return (await response.json()) as PublicCollection;
}

export interface GetPublicCollectionItemsOptions {
  readonly limit?: number;
  /** Opaque value from a previous page's nextCursor; never parsed or modified. */
  readonly cursor?: string;
  /** Server-side only (page.tsx / the items route handler) - never passed from browser code. */
  readonly unlockToken?: string;
}

/**
 * Returns null for a 404 (unknown or revoked publicId) - same rule as getPublicCollection - and
 * LOCKED when the share is locked and no valid grant was sent (no items are ever returned then).
 */
export async function getPublicCollectionItems(
  apiBaseUrl: string,
  publicId: string,
  options: GetPublicCollectionItemsOptions = {},
): Promise<PublicCollectionItemsPage | null | typeof LOCKED> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) {
    query.set('limit', String(options.limit));
  }
  if (options.cursor) {
    query.set('cursor', options.cursor);
  }
  const queryString = query.toString();

  const response = await fetch(
    `${apiBaseUrl}/api/v1/public/collections/${encodeURIComponent(publicId)}/items${queryString ? `?${queryString}` : ''}`,
    { cache: 'no-store', headers: unlockHeaders(options.unlockToken) },
  );

  if (response.status === 404) {
    return null;
  }
  if (await isLockedResponse(response)) {
    return LOCKED;
  }
  if (!response.ok) {
    throw new Error(`Juple Public API returned ${response.status} for collection ${publicId} items.`);
  }

  return (await response.json()) as PublicCollectionItemsPage;
}

export type UnlockResult =
  | { readonly kind: 'unlocked'; readonly unlockToken: string; readonly expiresAtUtc: string }
  | { readonly kind: 'invalidPassword' | 'throttled' | 'notFound' | 'failed' };

/**
 * Server-side only: verifies the password with the Backend. attemptId is this browser's opaque
 * attempt id (see lib/unlockCookie.ts) - the Backend uses it only to scope a per-browser failure
 * counter, under a much higher link-wide ceiling, so one visitor's wrong guesses do not lock
 * everyone else out of the link.
 */
export async function unlockPublicCollection(
  apiBaseUrl: string,
  publicId: string,
  password: string,
  attemptId: string,
): Promise<UnlockResult> {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/public/collections/${encodeURIComponent(publicId)}/unlock`,
    {
      body: JSON.stringify({ password }),
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Juple-Unlock-Attempt': attemptId },
      method: 'POST',
    },
  );

  if (response.ok) {
    const body = (await response.json()) as { unlockToken: string; expiresAtUtc: string };
    return { kind: 'unlocked', unlockToken: body.unlockToken, expiresAtUtc: body.expiresAtUtc };
  }
  if (response.status === 403) {
    return { kind: 'invalidPassword' };
  }
  if (response.status === 429) {
    return { kind: 'throttled' };
  }
  if (response.status === 404) {
    return { kind: 'notFound' };
  }
  return { kind: 'failed' };
}
