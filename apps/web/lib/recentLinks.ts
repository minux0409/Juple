import type { AppApi } from './appApi.ts';
import { displayTitleOf, isSafeHttpUrl, itemHref, siteIdOf, siteOf, type LinkView } from './savedLinks.ts';

/**
 * Home's 최근 조회한 링크 - the links the person OPENED (their original page, via 링크 열기 / the open button), newest first, from the
 * server (GET /api/v1/recently-opened-links; one row per link, only the signed-in person's own links). Saving a link is not opening it:
 * a freshly saved link is never listed here. A link behind a Collection's lock or share password is left out by the server, and a link in
 * the trash too.
 */
export const RECENT_LINKS_PATH = '/api/v1/recently-opened-links';
export const RECENT_LINKS_LIMIT = 10;

export interface RecentlyOpenedEntry {
  readonly itemId: number;
  readonly url: string;
  readonly title: string | null;
  readonly lastOpenedAtUtc: string;
  readonly previewImageUrl?: string | null;
}

export const recentLinksPath = (): string => `${RECENT_LINKS_PATH}?limit=${RECENT_LINKS_LIMIT}`;

/** The card the existing link list draws; opening it is the link's own details page. */
export function recentLinkView(entry: RecentlyOpenedEntry): LinkView {
  return {
    id: entry.itemId,
    locked: false,
    title: displayTitleOf(entry.title, entry.url),
    memo: null,
    site: siteOf(entry.url),
    siteId: siteIdOf(entry.url),
    thumbnailUrl: isSafeHttpUrl(entry.previewImageUrl) ? entry.previewImageUrl : null,
    timestampUtc: entry.lastOpenedAtUtc,
    href: itemHref(entry.itemId),
    externalUrl: isSafeHttpUrl(entry.url) ? entry.url : null,
  };
}

/** The server's answer, checked: anything malformed is dropped rather than drawn. */
export function parseRecentLinks(raw: unknown): readonly RecentlyOpenedEntry[] | null {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { items?: unknown }).items)) {
    return null;
  }
  return (raw as { items: unknown[] }).items.flatMap(entry => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.itemId !== 'number' || typeof row.url !== 'string' || typeof row.lastOpenedAtUtc !== 'string') {
      return [];
    }
    return [{
      itemId: row.itemId,
      url: row.url,
      title: typeof row.title === 'string' ? row.title : null,
      lastOpenedAtUtc: row.lastOpenedAtUtc,
      previewImageUrl: typeof row.previewImageUrl === 'string' ? row.previewImageUrl : null,
    }];
  });
}

/**
 * Notes that the person opened this link of THEIRS (POST /api/v1/items/{id}/open). Best effort and silent: a failure never gets in the way of
 * opening the page, and the server refuses a link that is not the caller's own (a link in someone else's Collection).
 */
export function recordLinkOpened(api: AppApi, itemId: number): Promise<void> {
  return api<void>({ method: 'POST', path: `/api/v1/items/${itemId}/open` }).then(() => undefined, () => undefined);
}
