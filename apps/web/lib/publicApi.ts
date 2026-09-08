/** Mirrors the Backend's PublicCollectionDto - Name only, nothing else. */
export interface PublicCollection {
  readonly name: string;
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
 * apiBaseUrl is always passed in by the caller rather than read from an env var here - this keeps
 * the same Docker image usable across Dev/Staging/Prod with no rebuild: `JUPLE_API_BASE_URL` is a
 * genuine runtime env var (see app/c/[publicId]/page.tsx, which reads it fresh on every request -
 * safe because that Server Component is already dynamic via headers()), never NEXT_PUBLIC_*. The
 * "load more" pagination (ItemList.tsx) is a Client Component that calls this same function
 * directly from the browser, so it receives apiBaseUrl as a prop threaded down from page.tsx
 * instead of reading any env var of its own - a plain string in a request's own RSC/HTML payload,
 * not a value frozen into the JS bundle at build time.
 */

/** Returns null for a 404 (unknown or revoked publicId) - callers render the not-found UI, never distinguishing the two. */
export async function getPublicCollection(
  apiBaseUrl: string,
  publicId: string,
): Promise<PublicCollection | null> {
  const response = await fetch(
    `${apiBaseUrl}/api/v1/public/collections/${encodeURIComponent(publicId)}`,
    { cache: 'no-store' },
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
}

/** Returns null for a 404 (unknown or revoked publicId) - same rule as getPublicCollection. */
export async function getPublicCollectionItems(
  apiBaseUrl: string,
  publicId: string,
  options: GetPublicCollectionItemsOptions = {},
): Promise<PublicCollectionItemsPage | null> {
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
    { cache: 'no-store' },
  );

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Juple Public API returned ${response.status} for collection ${publicId} items.`);
  }

  return (await response.json()) as PublicCollectionItemsPage;
}
