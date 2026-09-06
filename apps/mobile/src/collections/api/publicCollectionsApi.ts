import { requestApi } from '../../api/apiClient';

/**
 * The anonymous Public Collection Sharing API only (api/v1/public/collections/*) - mirrors
 * apps/web's lib/publicApi.ts. Deliberately never imports useAuthenticatedApi/getValidAccessToken:
 * a shared Collection opened via a deep link (see screens/SharedCollectionScreen.tsx) must work
 * for a signed-out user, and must never resolve to the authenticated /api/v1/collections/* surface
 * even for a signed-in one - the publicId is opaque and carries no ownership.
 */

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

/** Throws ApiError('notFound') for an unknown or revoked publicId - callers show the same "unavailable" state for both, never distinguishing them. */
export async function getPublicCollection(publicId: string): Promise<PublicCollection> {
  const response = await requestApi<PublicCollection>({
    method: 'GET',
    path: `/api/v1/public/collections/${encodeURIComponent(publicId)}`,
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
  });

  if (!response.body) {
    throw new Error('Juple API returned no public Collection Items page body.');
  }

  return response.body;
}
