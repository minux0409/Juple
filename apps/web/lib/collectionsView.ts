import { COLLECTION_ICON_KEYS, COLLECTION_ICON_MARKUP, type CollectionIconKey } from './collectionIconMarkup.ts';

/**
 * Collections for the signed-in Web app: the same list API, filters and tile look as the mobile Collections screen
 * (apps/mobile/src/screens/CollectionsScreen.tsx, collections/CategoryIconTile.tsx, collections/collectionColors.ts). Read-only in
 * this round. Only fields the API really returns are shown - name, the icon tile, item count, favorite, locked / shared status.
 */

/** Mirrors the fields of the Backend's Collection list row that the Web shows (see apps/mobile/src/collections/api/collectionsApi.ts). */
export interface CollectionSummary {
  readonly id: number;
  readonly name: string;
  readonly icon: string;
  readonly color: string | null;
  readonly iconImageUrl?: string | null;
  readonly itemCount: number;
  readonly isFavorite: boolean;
  readonly isLocked?: boolean;
  /** A member's view: the caller put THEIR OWN lock on this Collection (isLocked is then true for them too). Never reported to the Owner or other members. */
  readonly isMemberLocked?: boolean;
  readonly accessRole?: 'owner' | 'contributor' | 'viewer' | 'submitter';
  readonly hasCollaborators?: boolean;
  readonly isPublicShareActive?: boolean;
  /** Collaborative Collections: how many OTHER people are in it, and up to two of them (mobile participantPreview). */
  readonly otherParticipantCount?: number;
  readonly participantPreview?: readonly { readonly jupleId: string; readonly displayName: string | null; readonly role: string; readonly profileImageUrl?: string | null }[] | null;
  /**
   * The card's attention badge (mobile CountBadge): unread 새 링크 notifications + waiting approvals + (Owner) waiting join requests -
   * never reactions or comments. Its own meaning, never mixed with the bell's unread total.
   */
  readonly attentionCount?: number;
  readonly unreadNewLinkCount?: number;
  /** Owner only: proposed links (승인 후 추가) and people waiting to join - the Owner's received requests. */
  readonly pendingSubmissionCount?: number;
  readonly pendingJoinRequestCount?: number;
}

export interface CollectionsPage {
  readonly items: readonly CollectionSummary[];
  readonly nextCursor: string | null;
}

/** The mobile Collections filters, in its order: 즐겨찾기 / 전체 / 내 컬렉션 / 공유 컬렉션 (the API's scopes); it opens on 즐겨찾기. */
export const COLLECTION_FILTERS = ['favorites', 'all', 'owned', 'shared'] as const;
export type CollectionFilter = (typeof COLLECTION_FILTERS)[number];
export const DEFAULT_COLLECTION_FILTER: CollectionFilter = 'favorites';

/**
 * The selected filter lives in the address (`?tab=`), so it is part of the history: open a Collection from 공유 컬렉션, press Back and
 * the same tab is there again. Only a first visit (no / an unknown value) opens on 즐겨찾기. The values are the names a person sees.
 */
export const COLLECTION_TAB_PARAM = 'tab';
const COLLECTION_TAB_VALUES: Readonly<Record<CollectionFilter, string>> = { favorites: 'favorites', all: 'all', owned: 'mine', shared: 'shared' };

export function parseCollectionTab(value: string | null | undefined): CollectionFilter {
  const match = COLLECTION_FILTERS.find(filter => COLLECTION_TAB_VALUES[filter] === value);
  return match ?? DEFAULT_COLLECTION_FILTER;
}

/** The address parameter that carries the search text, so Back from a Collection returns to the same search (like the tab). */
export const COLLECTION_SEARCH_PARAM = 'q';
/** The server's limit (CollectionListSearch.MaxLength): a longer term is cut here, never sent as an error. */
export const COLLECTION_SEARCH_MAX_LENGTH = 100;
export const COLLECTION_SEARCH_DEBOUNCE_MS = 250;

/** The term as it is searched: trimmed, at most the server's length; blank means no search. */
export function normalizeCollectionSearch(value: string | null | undefined): string {
  return Array.from((value ?? '').trim()).slice(0, COLLECTION_SEARCH_MAX_LENGTH).join('').trim();
}

/** The address for a search term: blank removes the parameter; the tab and every other parameter are kept. */
export function collectionsSearchUrl(current: URL, term: string): URL {
  const next = new URL(current.href);
  const normalized = normalizeCollectionSearch(term);
  if (normalized === '') {
    next.searchParams.delete(COLLECTION_SEARCH_PARAM);
  } else {
    next.searchParams.set(COLLECTION_SEARCH_PARAM, normalized);
  }
  return next;
}

/** The address for a filter: the default carries no parameter; every other tab carries its own. Other parameters are kept. */
export function collectionsTabUrl(current: URL, filter: CollectionFilter): URL {
  const next = new URL(current.href);
  if (filter === DEFAULT_COLLECTION_FILTER) {
    next.searchParams.delete(COLLECTION_TAB_PARAM);
  } else {
    next.searchParams.set(COLLECTION_TAB_PARAM, COLLECTION_TAB_VALUES[filter]);
  }
  return next;
}

/** The mobile Collections view (categoryViewMode): List or Grid - Grid by default. A per-browser preference. */
export const COLLECTION_VIEW_MODES = ['list', 'grid'] as const;
export type CollectionViewMode = (typeof COLLECTION_VIEW_MODES)[number];
export const COLLECTION_VIEW_MODE_STORAGE_KEY = 'juple.web.collectionsViewMode';

export function parseCollectionViewMode(stored: string | null): CollectionViewMode {
  return stored === 'list' ? 'list' : 'grid';
}

/** The mobile screen's page size. */
export const COLLECTIONS_PAGE_SIZE = 24;

export function collectionsPath(filter: CollectionFilter, cursor?: string | null, search?: string | null): string {
  const query = new URLSearchParams({ scope: filter, limit: String(COLLECTIONS_PAGE_SIZE) });
  if (cursor) {
    query.set('cursor', cursor);
  }
  // The text search is the server's (GET /api/v1/collections?q=): names and the Collection's own links, over everything the person can
  // reach, with the same scope and paging - never matched in the browser against the pages loaded so far.
  const term = normalizeCollectionSearch(search);
  if (term !== '') {
    query.set('q', term);
  }
  return `/api/v1/collections?${query.toString()}`;
}

// ---- the tile (pastel background + icon) - exactly the mobile app's values -------------------------------------------------

interface ColorTile {
  readonly background: string;
  readonly icon: string;
}

/** The preset colors (backend CollectionColor names) - apps/mobile/src/collections/collectionColors.ts COLLECTION_COLOR_TILES. */
const COLLECTION_COLOR_TILES: Readonly<Record<string, ColorTile>> = {
  Blue: { background: '#EAF1FE', icon: '#5478B0' },
  Mint: { background: '#EAF5EE', icon: '#5C9878' },
  Rose: { background: '#FBEDEE', icon: '#B97278' },
  Amber: { background: '#FBF3DE', icon: '#B0924E' },
  Purple: { background: '#F1EBF7', icon: '#8A72A8' },
  Peach: { background: '#FBEEE6', icon: '#BD8863' },
  Teal: { background: '#E6F5F3', icon: '#4E9690' },
  Slate: { background: '#EDF1F5', icon: '#6B7A8F' },
  Coral: { background: '#FDEDEA', icon: '#C86B5D' },
  Lime: { background: '#F0F7E7', icon: '#729B45' },
  Sky: { background: '#EAF6FC', icon: '#4D92B7' },
  Indigo: { background: '#ECEEFA', icon: '#6574B7' },
  Lavender: { background: '#F5EFFA', icon: '#9473B1' },
  Sand: { background: '#F7F1E7', icon: '#A48257' },
};

/** A Collection with no color chosen: the id-deterministic pastel - apps/mobile/src/theme/tokens.ts categoryTilePalette. */
const FALLBACK_PALETTE: readonly ColorTile[] = [
  { background: '#EAF1FE', icon: '#5478B0' },
  { background: '#FBEDEE', icon: '#B97278' },
  { background: '#FBF3DE', icon: '#B0924E' },
  { background: '#EAF5EE', icon: '#5C9878' },
  { background: '#F1EBF7', icon: '#8A72A8' },
  { background: '#FBEEE6', icon: '#BD8863' },
];

function componentToHex(component: number): string {
  return Math.round(component).toString(16).padStart(2, '0').toUpperCase();
}

/** The tile for a Collection: its preset color, its custom #RRGGBB (icon darkened like mobile), else the id-deterministic pastel. */
export function collectionTile(color: string | null, collectionId: number): ColorTile {
  if (color && Object.hasOwn(COLLECTION_COLOR_TILES, color)) {
    return COLLECTION_COLOR_TILES[color];
  }
  if (color && /^#[0-9A-F]{6}$/i.test(color)) {
    const [r, g, b] = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
    const darken = (value: number) => Math.max(0, value - 72);
    return { background: color.toUpperCase(), icon: `#${componentToHex(darken(r))}${componentToHex(darken(g))}${componentToHex(darken(b))}` };
  }
  return FALLBACK_PALETTE[Math.abs(collectionId) % FALLBACK_PALETTE.length];
}

/** An unknown / legacy icon value falls back to Folder - never guessed (mobile resolveCollectionIconKey). */
export function collectionIconKey(icon: string): CollectionIconKey {
  return (COLLECTION_ICON_KEYS as readonly string[]).includes(icon) ? (icon as CollectionIconKey) : 'Folder';
}

export function collectionIconMarkup(icon: string): string {
  return COLLECTION_ICON_MARKUP[collectionIconKey(icon)];
}

// ---- status - the mobile CollectionStatusBadges rules (collections/collectionAccess.ts) -------------------------------------

export function isCollectionLocked(collection: Pick<CollectionSummary, 'isLocked'>): boolean {
  return collection.isLocked === true;
}

/** Shared with me (any non-owner role), or mine with collaborators / an active public link. */
export function isCollectionShared(collection: Pick<CollectionSummary, 'accessRole' | 'hasCollaborators' | 'isPublicShareActive'>): boolean {
  const sharedWithMe = collection.accessRole === 'contributor' || collection.accessRole === 'viewer' || collection.accessRole === 'submitter';
  return sharedWithMe || collection.hasCollaborators === true || collection.isPublicShareActive === true;
}

/** An uploaded icon photo is shown only when it is an http(s) URL (a short-lived read URL from the API). */
export function collectionIconImage(collection: Pick<CollectionSummary, 'iconImageUrl'>): string | null {
  const url = collection.iconImageUrl;
  if (!url) {
    return null;
  }
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/** Whether a Grid card has anything under its name: attention, locked, shared or other participants (the favorite star sits on the cover). */
export function hasGridStatus(collection: CollectionSummary): boolean {
  const shown = collection.participantPreview?.length ?? 0;
  const others = collection.otherParticipantCount ?? shown;
  return (collection.attentionCount ?? 0) > 0 || isCollectionLocked(collection) || isCollectionShared(collection) || (others > 0 && shown > 0);
}
