import type { CollectionSummary } from './collectionsView.ts';

/**
 * Home's summary - only numbers the API gives exactly, never an estimate. ONE read (GET /api/v1/home/summary) gives:
 *
 *  - the exact number of Collections in the 전체 / 즐겨찾기 / 공유 컬렉션 scopes (the same definitions as the Collections list's
 *    scopes, counted by the server - not "the whole list happened to fit in one page");
 *  - the first few favorite Collections (newest first), the shortcuts Home shows: just what a tile and its link count need.
 *
 * It replaced three full lists (scope all / favorites / shared, limit 50) that Home read only for those numbers and tiles.
 * Today's link count stays its own read (items/history/count).
 */
export const HOME_SUMMARY_PATH = '/api/v1/home/summary';

/** How many favorite Collections Home shows as shortcuts (the server's own limit is the same; the page never shows more). */
export const FAVORITE_SHORTCUT_COUNT = 6;

export interface HomeCollectionsSummary {
  readonly all: number;
  readonly favorites: number;
  readonly shared: number;
  readonly favoriteShortcuts: readonly CollectionSummary[];
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function shortcut(raw: unknown): CollectionSummary | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const entry = raw as Record<string, unknown>;
  const itemCount = count(entry.itemCount);
  if (typeof entry.id !== 'number' || typeof entry.name !== 'string' || typeof entry.icon !== 'string' || itemCount === null) {
    return null;
  }
  return {
    id: entry.id,
    name: entry.name,
    icon: entry.icon,
    color: typeof entry.color === 'string' ? entry.color : null,
    iconImageUrl: typeof entry.iconImageUrl === 'string' ? entry.iconImageUrl : null,
    itemCount,
    // Only favorites are listed here.
    isFavorite: true,
  };
}

/** The API's answer, checked. Anything that is not a well-formed summary is no summary (Home then shows no numbers - never guesses). */
export function parseHomeSummary(raw: unknown): HomeCollectionsSummary | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const body = raw as Record<string, unknown>;
  const all = count(body.collectionCount);
  const favorites = count(body.favoriteCollectionCount);
  const shared = count(body.sharedCollectionCount);
  if (all === null || favorites === null || shared === null || !Array.isArray(body.favoriteCollections)) {
    return null;
  }
  const favoriteShortcuts = body.favoriteCollections
    .map(shortcut)
    .filter((entry): entry is CollectionSummary => entry !== null)
    .slice(0, FAVORITE_SHORTCUT_COUNT);
  return { all, favorites, shared, favoriteShortcuts };
}
