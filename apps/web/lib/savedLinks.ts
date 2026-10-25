/**
 * A saved link as the signed-in Web app lists it - one model for Home, 보관함 and a Collection's links, built with the mobile app's
 * own display rules (apps/mobile/src/components/SavedLinkRow.tsx, items/savedLinkPrimaryText.ts, items/resolveEffectiveThumbnailUrl.ts)
 * so the same link reads the same everywhere. Pure - unit-tested without a browser.
 */

import { lockedContextSearch } from './itemOpenGrant.ts';
import { imageCacheKey } from './stableImageUri.ts';

/** A short-lived read URL of an uploaded image (the Backend's RepresentativeImage). */
export interface ImageRef {
  readonly id?: number;
  readonly readUrl: string | null;
  readonly thumbnailReadUrl?: string | null;
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
  /** With a gated card: the Collection whose lock / share password stands before it, and which one (mobile ItemHistoryEntry). */
  readonly collectionId?: number | null;
  readonly collectionGate?: 'lock' | 'sharePassword' | null;
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
  readonly profileImageUrl?: string | null;
  /** The adder is this Collection's Owner (also when that is "me") - the server's own flag, mobile CollectionItemAdder. */
  readonly isCollectionOwner?: boolean;
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
  /** Emoji reactions to this link IN this Collection (counts per kind) and the caller's own - on the list row itself, so no per-card request. */
  readonly reactions?: readonly { readonly key: string; readonly count: number }[] | null;
  readonly myReaction?: string | null;
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
  /** The stable image-cache identity of thumbnailUrl when it is the person's own photo (lib/stableImageUri.ts), else null. */
  readonly thumbnailCacheKey?: string | null;
  /** When it was saved (Home / 보관함) or added to the Collection. */
  readonly timestampUtc: string;
  /** Where clicking it goes in this app - null when it cannot be opened here (a locked link). */
  readonly href: string | null;
  /** The saved original page (the 바로가기 action): an http(s) URL only, null for a locked link or an unusable stored value. */
  readonly externalUrl: string | null;
  /** Who added it, in a shared Collection only (see adderViewOf) - never on Home / 보관함 or in a personal Collection. */
  readonly adder?: LinkAdderView | null;
  /** A shared Collection's link: its reactions (the card's second line, only while there are any). Never on Home / 보관함. */
  readonly reactions?: { readonly collectionId: number; readonly row: { readonly reactions?: readonly { readonly key: string; readonly count: number }[] | null; readonly myReaction?: string | null } } | null;
}

/** Who added a link, as the card draws it: an avatar (a crown on its corner for the Collection's Owner), or the anonymous public link. */
export type LinkAdderView =
  | {
      readonly kind: 'person';
      readonly name: string;
      readonly profileImageUrl: string | null;
      readonly isCollectionOwner: boolean;
      readonly isMe: boolean;
    }
  | { readonly kind: 'publicLink' };

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
  const candidate = entry.coverImage?.thumbnailReadUrl || entry.coverImage?.readUrl
    || entry.representativeImage?.thumbnailReadUrl || entry.representativeImage?.readUrl
    || entry.previewImageUrl || null;
  return isSafeHttpUrl(candidate) ? candidate : null;
}

/** The stable cache identity of the picture thumbnailOf chose: the own photo's id and variant; an external preview has none. */
export function thumbnailKeyOf(entry: Pick<ItemHistoryEntry, 'coverImage' | 'representativeImage'>): string | null {
  const own = entry.coverImage?.thumbnailReadUrl || entry.coverImage?.readUrl ? entry.coverImage : entry.representativeImage?.thumbnailReadUrl || entry.representativeImage?.readUrl ? entry.representativeImage : null;
  if (!own) {
    return null;
  }
  return imageCacheKey(own.id, own.thumbnailReadUrl ? 'thumb' : 'main');
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

/** The Collection's page with its share panel open (a card's 공유 action) - the page reads `?panel=share` once. */
export function collectionShareHref(collectionId: number): string {
  return `${collectionHref(collectionId)}?panel=share`;
}

/** Another member's link in a shared Collection: the read-only shared view, always IN that Collection (mobile CollectionSharedItem). */
export function sharedItemHref(collectionId: number, itemId: number): string {
  return `/collections/${collectionId}/items/${itemId}`;
}

/**
 * A Home / 보관함 row. A link behind a Collection lock carries nothing of itself: like the mobile app it opens only IN its Collection
 * (`?lockedBy=`), after that Collection's password - the link's page asks for it and reads with the grant, never without the context.
 * A card that names no Collection (an older API) stays closed.
 */
export function historyLinkView(entry: ItemHistoryEntry): LinkView {
  if (entry.isCollectionLocked) {
    const href = typeof entry.collectionId === 'number' && entry.collectionId > 0 ? `${itemHref(entry.id)}${lockedContextSearch(entry.collectionId)}` : null;
    return { id: entry.id, locked: true, title: { kind: 'locked' }, memo: null, site: null, siteId: null, thumbnailUrl: null, timestampUtc: entry.savedAtUtc, href, externalUrl: null };
  }
  return {
    id: entry.id,
    locked: false,
    title: displayTitleOf(entry.title, entry.url),
    memo: entry.memo?.trim() || null,
    site: siteOf(entry.url),
    siteId: siteIdOf(entry.url),
    thumbnailUrl: thumbnailOf(entry),
    thumbnailCacheKey: thumbnailKeyOf(entry),
    timestampUtc: entry.savedAtUtc,
    href: itemHref(entry.id),
    externalUrl: isSafeHttpUrl(entry.url) ? entry.url : null,
  };
}

/**
 * The adder of a Collection link as a card shows it (mobile describeItemAdder): a person by avatar (a signed-in view always carries
 * the server's `isCollectionOwner`; `owner` also counts), or the anonymous public link. Null when the server could not say - no
 * invented face. The caller decides per Collection whether adders are shown at all (shouldShowLinkAdders).
 */
export function adderViewOf(adder: CollectionItemAdder | null | undefined): LinkAdderView | null {
  if (!adder) {
    return null;
  }
  if (adder.kind === 'publicLink') {
    return { kind: 'publicLink' };
  }
  if (adder.kind !== 'me' && !adder.jupleId) {
    return null;
  }
  return {
    kind: 'person',
    name: adder.displayName?.trim() || (adder.jupleId ?? ''),
    profileImageUrl: isSafeHttpUrl(adder.profileImageUrl) ? adder.profileImageUrl : null,
    isCollectionOwner: adder.isCollectionOwner === true || adder.kind === 'owner',
    isMe: adder.kind === 'me',
  };
}

/**
 * Adders mean something only where more than one person can add (mobile shouldShowItemAdders): a shared Collection, or one where a
 * link came in through its public link. A personal Collection (every link "me") stays quiet. Decided once for the whole list.
 */
export function shouldShowLinkAdders(
  collection: { readonly accessRole?: string; readonly hasCollaborators?: boolean; readonly isPublicShareActive?: boolean } | null,
  items: readonly { readonly addedBy?: CollectionItemAdder | null }[],
): boolean {
  const sharedWithMe = collection?.accessRole === 'contributor' || collection?.accessRole === 'viewer' || collection?.accessRole === 'submitter';
  if (sharedWithMe || collection?.hasCollaborators === true || collection?.isPublicShareActive === true) {
    return true;
  }
  return items.some(item => item.addedBy != null && item.addedBy.kind !== 'me');
}

/** A Collection's link: mine opens my Item Details; another member's opens the read-only shared view in this Collection. */
export function collectionLinkView(entry: CollectionItemEntry, collectionId: number, options?: { readonly showAdder?: boolean }): LinkView {
  const mine = entry.isMine !== false;
  return {
    id: entry.itemId,
    locked: false,
    title: displayTitleOf(entry.title, entry.url),
    memo: mine ? entry.memo?.trim() || null : null,
    site: siteOf(entry.url),
    siteId: siteIdOf(entry.url),
    thumbnailUrl: thumbnailOf(entry),
    thumbnailCacheKey: thumbnailKeyOf(entry),
    timestampUtc: entry.addedAtUtc,
    href: mine ? itemHref(entry.itemId) : sharedItemHref(collectionId, entry.itemId),
    externalUrl: isSafeHttpUrl(entry.url) ? entry.url : null,
    adder: options?.showAdder ? adderViewOf(entry.addedBy) : null,
    // Reactions exist only where other people are in the Collection (the same rule as the adders).
    reactions: options?.showAdder ? { collectionId, row: { reactions: entry.reactions, myReaction: entry.myReaction } } : null,
  };
}

/**
 * A Collection's own link opened from inside that Collection carries it in the route (`?collectionId=`), so its page can say 삭제 the
 * way mobile does there: 컬렉션에서 삭제 (only that membership). Another member's read-only shared view needs no such context.
 */
export function inCollectionContext(link: LinkView, collectionId: number): LinkView {
  return link.href?.startsWith('/items/') ? { ...link, href: `${link.href}?collectionId=${collectionId}` } : link;
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

/**
 * The 저장일 value of a link's details: the server's own saved / added instant (UTC, parsed once and formatted in the viewer's
 * locale and time zone - never shifted twice), or null when the server sent none or something that is not a date - the caller then
 * shows a plain dash. Never the client's current time.
 */
export function savedAtOf(utc: string | null | undefined, locale: string): { readonly iso: string; readonly text: string } | null {
  const time = typeof utc === 'string' && utc.trim() ? new Date(utc) : null;
  return time && !Number.isNaN(time.getTime()) ? { iso: time.toISOString(), text: formatLinkTimestamp(utc as string, locale, true) } : null;
}

/** Adds a page to what is loaded, never twice the same link (a page boundary can repeat one). */
export function appendUnique<T>(loaded: readonly T[], page: readonly T[], idOf: (entry: T) => number): readonly T[] {
  const seen = new Set(loaded.map(idOf));
  return [...loaded, ...page.filter(entry => !seen.has(idOf(entry)))];
}
