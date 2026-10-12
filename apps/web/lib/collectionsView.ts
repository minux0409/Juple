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
}

export interface CollectionsPage {
  readonly items: readonly CollectionSummary[];
  readonly nextCursor: string | null;
}

/** The mobile Collections filters, in its order: 즐겨찾기 / 전체 / 내 컬렉션 / 공유 컬렉션 (the API's scopes); it opens on 즐겨찾기. */
export const COLLECTION_FILTERS = ['favorites', 'all', 'owned', 'shared'] as const;
export type CollectionFilter = (typeof COLLECTION_FILTERS)[number];
export const DEFAULT_COLLECTION_FILTER: CollectionFilter = 'favorites';

/** The mobile Collections view (categoryViewMode): List or Grid - Grid by default. A per-browser preference. */
export const COLLECTION_VIEW_MODES = ['list', 'grid'] as const;
export type CollectionViewMode = (typeof COLLECTION_VIEW_MODES)[number];
export const COLLECTION_VIEW_MODE_STORAGE_KEY = 'juple.web.collectionsViewMode';

export function parseCollectionViewMode(stored: string | null): CollectionViewMode {
  return stored === 'list' ? 'list' : 'grid';
}

/** The mobile screen's page size. */
export const COLLECTIONS_PAGE_SIZE = 24;

export function collectionsPath(filter: CollectionFilter, cursor?: string | null): string {
  const query = new URLSearchParams({ scope: filter, limit: String(COLLECTIONS_PAGE_SIZE) });
  if (cursor) {
    query.set('cursor', cursor);
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
