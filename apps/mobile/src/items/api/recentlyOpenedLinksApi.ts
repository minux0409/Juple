import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';

/**
 * One My Page → "최근 본 링크" (Recently opened links) row - the current Title/Url of an Item the
 * user opened, plus when they last opened it. Deliberately minimal: no memo/category/purchase -
 * see GET /api/v1/recently-opened-links.
 */
export interface RecentlyOpenedLink {
  readonly itemId: number;
  readonly url: string;
  readonly title: string | null;
  readonly lastOpenedAtUtc: string;
}

export interface RecentlyOpenedLinksPage {
  readonly items: readonly RecentlyOpenedLink[];
  readonly nextCursor: string | null;
}

export interface GetRecentlyOpenedLinksOptions {
  readonly limit?: number;
  /** Opaque value from a previous RecentlyOpenedLinksPage.nextCursor; never parsed or modified. */
  readonly cursor?: string;
}

/** Newest-opened-first - always cursor-paginated, never returns everything in one response. */
export async function getRecentlyOpenedLinks(
  request: AuthenticatedApiRequest,
  options: GetRecentlyOpenedLinksOptions = {},
): Promise<RecentlyOpenedLinksPage> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) {
    query.set('limit', String(options.limit));
  }
  if (options.cursor) {
    query.set('cursor', options.cursor);
  }
  const queryString = query.toString();

  const response = await request<RecentlyOpenedLinksPage>({
    method: 'GET',
    path: queryString
      ? `/api/v1/recently-opened-links?${queryString}`
      : '/api/v1/recently-opened-links',
  });

  if (!response.body) {
    throw new Error('Juple API returned no Recently opened links page body.');
  }

  return response.body;
}

/** DELETEs a single entry by itemId; resolves on 204 (idempotent - missing/already-deleted succeeds too). */
export async function deleteRecentlyOpenedLink(
  request: AuthenticatedApiRequest,
  itemId: number,
): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: `/api/v1/recently-opened-links/${itemId}`,
  });
}

/** DELETEs every entry for the current user; resolves on 204 (idempotent - already-empty succeeds too). */
export async function deleteAllRecentlyOpenedLinks(request: AuthenticatedApiRequest): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: '/api/v1/recently-opened-links',
  });
}
