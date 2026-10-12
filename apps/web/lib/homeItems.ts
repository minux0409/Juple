/**
 * Home (오늘 저장한 링크) for the signed-in Web app - the same API and the same rules as the mobile Home (DailyInboxScreen):
 * GET /api/v1/items/history with fromUtc = the start of TODAY in the viewer's own time zone, newest saved first.
 */

/** Mirrors the Backend's history row (see apps/mobile/src/items/api/itemsApi.ts ItemHistoryEntry). */
export interface ItemHistoryEntry {
  readonly id: number;
  readonly url: string;
  readonly title: string | null;
  readonly memo: string | null;
  readonly savedAtUtc: string;
  readonly representativeImage: { readonly readUrl: string | null } | null;
  readonly previewImageUrl: string | null;
  readonly coverImage: { readonly readUrl: string | null } | null;
  /** Redacted by the server while the item's Collection content gate is active: no title / url / images then. */
  readonly isCollectionLocked?: boolean;
}

export interface ItemHistoryPage {
  readonly items: readonly ItemHistoryEntry[];
  readonly nextCursor: string | null;
}

/** One page of today's links - the mobile Home's own page size. */
export const HOME_PAGE_SIZE = 50;

/** Midnight of `now`'s local day, as a UTC instant - the browser's own time zone, never a hardcoded one. */
export function todayWindowStartUtc(now: Date): string {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return start.toISOString();
}

export function homeHistoryPath(now: Date): string {
  const query = new URLSearchParams({ limit: String(HOME_PAGE_SIZE), fromUtc: todayWindowStartUtc(now) });
  return `/api/v1/items/history?${query.toString()}`;
}

export interface HomeLinkView {
  readonly id: number;
  readonly locked: boolean;
  /** The user's own title, else the site; null only for a locked item (its title is never sent). */
  readonly title: string | null;
  /** Host without "www."; null for a locked item or an unparsable url. */
  readonly site: string | null;
  readonly url: string | null;
  readonly thumbnailUrl: string | null;
  readonly savedAtUtc: string;
}

export function siteOf(url: string): string | null {
  try {
    const { hostname } = new URL(url);
    return hostname ? hostname.replace(/^www\./i, '') : null;
  } catch {
    return null;
  }
}

/** The same thumbnail priority as the mobile app: the chosen cover, then the link preview, then the first uploaded image. */
export function thumbnailOf(entry: ItemHistoryEntry): string | null {
  return entry.coverImage?.readUrl || entry.previewImageUrl || entry.representativeImage?.readUrl || null;
}

export function toHomeLinkView(entry: ItemHistoryEntry): HomeLinkView {
  if (entry.isCollectionLocked) {
    return { id: entry.id, locked: true, title: null, site: null, url: null, thumbnailUrl: null, savedAtUtc: entry.savedAtUtc };
  }
  const site = siteOf(entry.url);
  const title = entry.title?.trim() || site || entry.url;
  return { id: entry.id, locked: false, title, site, url: entry.url, thumbnailUrl: thumbnailOf(entry), savedAtUtc: entry.savedAtUtc };
}

/** Only http(s) links are ever rendered as clickable - a stored url is user input. */
export function isSafeHttpUrl(url: string | null): url is string {
  if (!url) {
    return false;
  }
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/** The header's count: GET /api/v1/items/history/count for the same window (mobile getItemHistoryCount). */
export function homeCountPath(now: Date): string {
  return `/api/v1/items/history/count?${new URLSearchParams({ fromUtc: todayWindowStartUtc(now) }).toString()}`;
}

/** The mobile Home's three presentations (List / Grid / Image - picture-only tiles). */
export const HOME_VIEW_MODES = ['list', 'grid', 'image'] as const;
export type HomeViewMode = (typeof HOME_VIEW_MODES)[number];

/** A per-browser convenience (like the mobile per-device preference) - never account data. */
export const HOME_VIEW_MODE_STORAGE_KEY = 'juple.web.homeViewMode';

export function parseHomeViewMode(stored: string | null): HomeViewMode {
  return (HOME_VIEW_MODES as readonly string[]).includes(stored ?? '') ? (stored as HomeViewMode) : 'list';
}
