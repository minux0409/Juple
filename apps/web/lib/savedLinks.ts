/**
 * A saved link as the signed-in Web app lists it - one model for Home, 보관함 and a Collection's links, built with the mobile app's
 * own display rules (apps/mobile/src/components/SavedLinkRow.tsx, items/savedLinkPrimaryText.ts, items/resolveEffectiveThumbnailUrl.ts)
 * so the same link reads the same everywhere. Pure - unit-tested without a browser.
 */

/** A short-lived read URL of an uploaded image (the Backend's RepresentativeImage). */
export interface ImageRef {
  readonly id?: number;
  readonly readUrl: string | null;
}

/** Mirrors the Backend's history row (apps/mobile/src/items/api/itemsApi.ts ItemHistoryEntry) - Home and 보관함. */
export interface ItemHistoryEntry {
  readonly id: number;
  readonly url: string;
  readonly title: string | null;
  readonly memo: string | null;
  readonly savedAtUtc: string;
  readonly representativeImage: ImageRef | null;
  readonly previewImageUrl: string | null;
  readonly coverImage: ImageRef | null;
  /** Redacted by the server while the item's Collection content gate is active: no title / url / memo / images then. */
  readonly isCollectionLocked?: boolean;
}

export interface ItemHistoryPage {
  readonly items: readonly ItemHistoryEntry[];
  readonly nextCursor: string | null;
}

/** Who put a link into a Collection, as the server lets the caller see them (apps/mobile collectionsApi.ts CollectionItemAdder). */
export interface CollectionItemAdder {
  readonly kind: 'me' | 'owner' | 'member' | 'publicLink';
  readonly jupleId?: string | null;
  readonly displayName?: string | null;
}

/** Mirrors one link of GET /api/v1/collections/{id}/items (apps/mobile collectionsApi.ts CollectionItemEntry) - the fields the Web shows. */
export interface CollectionItemEntry {
  readonly itemId: number;
  readonly url: string;
  readonly title: string | null;
  readonly memo: string | null;
  readonly addedAtUtc: string;
  readonly representativeImage: ImageRef | null;
  readonly previewImageUrl: string | null;
  readonly coverImage: ImageRef | null;
  /** False: another member's link - memo / own photos are never sent and it opens as the read-only shared view. Absent = mine. */
  readonly isMine?: boolean;
  readonly addedBy?: CollectionItemAdder | null;
}

export interface CollectionItemsPage {
  readonly items: readonly CollectionItemEntry[];
  readonly nextCursor: string | null;
}

/**
 * What a row shows as its name: the link's own title; for a title-less Instagram post / reel the mobile app's localized label (only
 * the content TYPE is read from the URL path - never a caption or author); else the site; else the raw URL. `technical` marks a
 * hostname / URL, shown left-to-right in any locale.
 */
export type LinkDisplayTitle =
  | { readonly kind: 'text'; readonly text: string; readonly technical: boolean }
  | { readonly kind: 'instagramPost' }
  | { readonly kind: 'instagramReel' }
  | { readonly kind: 'locked' };

export interface LinkView {
  /** The Item id (a Collection link's itemId). */
  readonly id: number;
  readonly locked: boolean;
  readonly title: LinkDisplayTitle;
  /** The user's memo (one line in the List), null when none / not sent. */
  readonly memo: string | null;
  /** Host without "www."; null for a locked link or an unparsable url. */
  readonly site: string | null;
  /** A site with its own badge (the picture fallback), else null. */
  readonly siteId: KnownSiteId | null;
  readonly thumbnailUrl: string | null;
  /** When it was saved (Home / 보관함) or added to the Collection. */
  readonly timestampUtc: string;
  /** Where clicking it goes in this app - null when it cannot be opened here (a locked link). */
  readonly href: string | null;
}

export function siteOf(url: string): string | null {
  try {
    const { hostname } = new URL(url);
    return hostname ? hostname.replace(/^www\./i, '') : null;
  } catch {
    return null;
  }
}

/** The sites with their own badge in the mobile app (items/resolveSiteInfo.ts) - by host only. */
export type KnownSiteId = 'youtube' | 'instagram' | 'naver';

export function siteIdOf(url: string): KnownSiteId | null {
  const host = siteOf(url)?.toLowerCase();
  if (!host) {
    return null;
  }
  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') {
    return 'youtube';
  }
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
    return 'instagram';
  }
  if (host === 'naver.com' || host.endsWith('.naver.com') || host === 'naver.me') {
    return 'naver';
  }
  return null;
}

/** Only http(s) links are ever rendered as clickable - a stored url is user input. */
export function isSafeHttpUrl(url: string | null | undefined): url is string {
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

/** Instagram's own public URL shapes (/p/{code}, /reel/{code}, /reels/{code}, optionally after /{handle}) - mobile resolveKnownContentFallbackKey. */
function instagramContentKind(url: string): 'instagramPost' | 'instagramReel' | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'instagram.com' && !host.endsWith('.instagram.com')) {
    return null;
  }
  const match = /^\/(?:[A-Za-z0-9._]{1,30}\/)?(p|reels?)\/[A-Za-z0-9_-]+\/?$/.exec(parsed.pathname);
  if (!match) {
    return null;
  }
  return match[1] === 'p' ? 'instagramPost' : 'instagramReel';
}

export function displayTitleOf(title: string | null | undefined, url: string): LinkDisplayTitle {
  const own = title?.trim();
  if (own) {
    return { kind: 'text', text: own, technical: false };
  }
  const instagram = instagramContentKind(url);
  if (instagram) {
    return { kind: instagram };
  }
  return { kind: 'text', text: siteOf(url) ?? url, technical: true };
}

/**
 * The mobile thumbnail priority (items/resolveEffectiveThumbnailUrl.ts): the person's own photo first - the cover, else the first
 * uploaded photo of an older link - then the automatic link preview, then none (the site badge is drawn instead). A picture that
 * fails to load is replaced by that same fallback (see LinkImage), never the browser's broken-image icon.
 */
export function thumbnailOf(entry: Pick<ItemHistoryEntry, 'coverImage' | 'previewImageUrl' | 'representativeImage'>): string | null {
  const candidate = entry.coverImage?.readUrl || entry.representativeImage?.readUrl || entry.previewImageUrl || null;
  return isSafeHttpUrl(candidate) ? candidate : null;
}

/** A route id segment: a positive integer only - anything else is "not found" without asking the API. */
export function parseRouteId(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d{0,15}$/.test(value)) {
    return null;
  }
  return Number(value);
}

export function itemHref(itemId: number): string {
  return `/items/${itemId}`;
}

export function collectionHref(collectionId: number): string {
  return `/collections/${collectionId}`;
}

/** Another member's link in a shared Collection: the read-only shared view, always IN that Collection (mobile CollectionSharedItem). */
export function sharedItemHref(collectionId: number, itemId: number): string {
  return `/collections/${collectionId}/items/${itemId}`;
}

/**
 * A Home / 보관함 row. A link behind a Collection lock carries nothing of itself and is not opened on the Web: the mobile app opens it
 * only IN its Collection after the password, and a read without that context would skip the gate.
 */
export function historyLinkView(entry: ItemHistoryEntry): LinkView {
  if (entry.isCollectionLocked) {
    return { id: entry.id, locked: true, title: { kind: 'locked' }, memo: null, site: null, siteId: null, thumbnailUrl: null, timestampUtc: entry.savedAtUtc, href: null };
  }
  return {
    id: entry.id,
    locked: false,
    title: displayTitleOf(entry.title, entry.url),
    memo: entry.memo?.trim() || null,
    site: siteOf(entry.url),
    siteId: siteIdOf(entry.url),
    thumbnailUrl: thumbnailOf(entry),
    timestampUtc: entry.savedAtUtc,
    href: itemHref(entry.id),
  };
}

/** A Collection's link: mine opens my Item Details; another member's opens the read-only shared view in this Collection. */
export function collectionLinkView(entry: CollectionItemEntry, collectionId: number): LinkView {
  const mine = entry.isMine !== false;
  return {
    id: entry.itemId,
    locked: false,
    title: displayTitleOf(entry.title, entry.url),
    memo: mine ? entry.memo?.trim() || null : null,
    site: siteOf(entry.url),
    siteId: siteIdOf(entry.url),
    thumbnailUrl: thumbnailOf(entry),
    timestampUtc: entry.addedAtUtc,
    href: mine ? itemHref(entry.itemId) : sharedItemHref(collectionId, entry.itemId),
  };
}

// ---- List / Grid / Image ------------------------------------------------------------------------------------------------------

/** The mobile three presentations (List / Grid / Image - picture-only tiles). */
export const LINK_VIEW_MODES = ['list', 'grid', 'image'] as const;
export type LinkViewMode = (typeof LINK_VIEW_MODES)[number];

/** Per-browser conveniences (like the mobile per-device preferences, one per screen) - never account data. */
export const VIEW_MODE_STORAGE_KEYS = {
  home: 'juple.web.homeViewMode',
  archive: 'juple.web.archiveViewMode',
  collectionDetails: 'juple.web.collectionDetailsViewMode',
} as const;

export function parseViewMode(stored: string | null): LinkViewMode {
  return (LINK_VIEW_MODES as readonly string[]).includes(stored ?? '') ? (stored as LinkViewMode) : 'list';
}

// ---- date sections (보관함 and a Collection's 시간순) --------------------------------------------------------------------------

/**
 * One non-empty date section from the server (GET items/history/sections, GET collections/{id}/items/sections): its identity, exact
 * count and the window its links are read from. Never display text - see sectionLabel.
 */
export interface DateSection {
  readonly key: string;
  readonly kind: 'today' | 'yesterday' | 'thisWeek' | 'month';
  readonly year: number | null;
  readonly month: number | null;
  readonly fromUtc: string;
  readonly toUtc: string | null;
  readonly count: number;
}

/** Links per request inside one section - the mobile DATE_SECTION_PAGE_SIZE. */
export const DATE_SECTION_PAGE_SIZE = 25;

export interface SectionLabels {
  readonly sectionToday: string;
  readonly sectionYesterday: string;
  readonly sectionThisWeek: string;
}

/** 오늘 / 어제 / 이번 주 / a localized month (mobile historySectionLabel). */
export function sectionLabel(section: Pick<DateSection, 'kind' | 'key' | 'year' | 'month'>, labels: SectionLabels, locale: string): string {
  switch (section.kind) {
    case 'today':
      return labels.sectionToday;
    case 'yesterday':
      return labels.sectionYesterday;
    case 'thisWeek':
      return labels.sectionThisWeek;
    default: {
      const fromKey = /^month:(\d{4})-(\d{2})$/.exec(section.key);
      const year = section.year ?? (fromKey ? Number(fromKey[1]) : null);
      const month = section.month ?? (fromKey ? Number(fromKey[2]) : null);
      if (year === null || month === null) {
        return section.key;
      }
      return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(new Date(year, month - 1, 1));
    }
  }
}

/** One-day sections show a time; longer ones the full date and time (mobile historySectionShowsItemDate). */
export function sectionShowsDate(kind: DateSection['kind']): boolean {
  return kind !== 'today' && kind !== 'yesterday';
}

/** The section opened first: 오늘, else the first one shown (mobile). */
export function initialSectionKey(sections: readonly DateSection[]): string | null {
  return (sections.find(section => section.kind === 'today') ?? sections[0])?.key ?? null;
}

/** The mobile timestamp formats: a time inside a one-day section, else medium date + short time. */
export function formatLinkTimestamp(utc: string, locale: string, withDate: boolean): string {
  const options: Intl.DateTimeFormatOptions = withDate ? { dateStyle: 'medium', timeStyle: 'short' } : { hour: 'numeric', minute: '2-digit' };
  return new Intl.DateTimeFormat(locale, options).format(new Date(utc));
}

/** Adds a page to what is loaded, never twice the same link (a page boundary can repeat one). */
export function appendUnique<T>(loaded: readonly T[], page: readonly T[], idOf: (entry: T) => number): readonly T[] {
  const seen = new Set(loaded.map(idOf));
  return [...loaded, ...page.filter(entry => !seen.has(idOf(entry)))];
}
