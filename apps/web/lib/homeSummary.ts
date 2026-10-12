import type { CollectionFilter, CollectionsPage } from './collectionsView.ts';

/**
 * Home's summary - only numbers the API gives exactly, never an estimate:
 *
 *  - 오늘 저장한 링크: GET /api/v1/items/history/count (an exact count of today's window).
 *  - 컬렉션 / 즐겨찾기 / 공유 컬렉션: the Collections list has NO total count, so a number is shown only when the whole list
 *    came back in one page (no next cursor); otherwise that card is left out rather than guessed.
 *
 * The 즐겨찾기 page also gives Home's shortcuts (the first few favorite Collections, in the API's order).
 */

/** Large enough that most people's lists fit in one page (the API's own page cap still applies). */
export const SUMMARY_PAGE_SIZE = 50;

/** How many favorite Collections Home shows as shortcuts. */
export const FAVORITE_SHORTCUT_COUNT = 6;

export function summaryCollectionsPath(scope: CollectionFilter): string {
  return `/api/v1/collections?${new URLSearchParams({ scope, limit: String(SUMMARY_PAGE_SIZE) }).toString()}`;
}

/** The exact number of Collections in this scope - or null when there are more pages (then no number is shown). */
export function exactCollectionCount(page: Pick<CollectionsPage, 'items' | 'nextCursor'>): number | null {
  return page.nextCursor === null ? page.items.length : null;
}
