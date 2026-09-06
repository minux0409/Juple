/**
 * The Juple Backend's base URL for the anonymous Public API only (api/v1/public/*) - never an
 * authenticated route, never a token. NEXT_PUBLIC_ is required (not just a server-side env var)
 * because the "load more" pagination in ItemList is a Client Component that fetches directly from
 * the browser, not through this Next.js server - see ItemList.tsx. No real production domain is
 * hardcoded here; the local default only applies when the env var is unset (local dev).
 */
export const PUBLIC_API_BASE_URL =
  process.env.NEXT_PUBLIC_JUPLE_API_BASE_URL ?? 'http://localhost:5092';

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

/** Returns null for a 404 (unknown or revoked publicId) - callers render the not-found UI, never distinguishing the two. */
export async function getPublicCollection(publicId: string): Promise<PublicCollection | null> {
  const response = await fetch(
    `${PUBLIC_API_BASE_URL}/api/v1/public/collections/${encodeURIComponent(publicId)}`,
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
    `${PUBLIC_API_BASE_URL}/api/v1/public/collections/${encodeURIComponent(publicId)}/items${queryString ? `?${queryString}` : ''}`,
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
