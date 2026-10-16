import { ApiHttpError } from './appApi.ts';
import type { CollectionSummary } from './collectionsView.ts';
import { DATE_SECTION_PAGE_SIZE, type DateSection } from './savedLinks.ts';

/**
 * A Collection's own page for the signed-in Web app - the mobile CollectionDetailsScreen read side, on the same API:
 *
 *  - GET /api/v1/collections/{id}: name, icon / color / photo, link count, the caller's favorite mark, locked / shared state.
 *  - 시간순 ↓ newest / ↑ oldest: GET .../items/sections (the Collection's date sections by when each link was ADDED, exact counts),
 *    then an opened section's links from GET .../items?sort=dateDesc|dateAsc&fromUtc&toUtc, a page at a time.
 *  - 이름순 ↑ / ↓: SQL name order with an opaque keyset cursor, one bounded page at a time.
 *
 * A locked Collection (the Owner's lock, or a member's share password) answers 403 with a code: nothing of its content is shown,
 * and the Web does not unlock it in this round - the app does.
 */

/** GET /api/v1/collections/{id} - the list row's fields (collectionsView.ts) and the share-password flag. */
export interface CollectionDetail extends CollectionSummary {
  readonly isSharePasswordProtected?: boolean;
}

/** 시간순 ↓ newest / ↑ oldest, 이름순 ↑ title (A→Z) / ↓ titleDesc (Z→A) - mobile LinkSortOption. */
export type LinkSortOption = 'newest' | 'oldest' | 'title' | 'titleDesc';

export const COLLECTION_SORT_STORAGE_KEY = 'juple.web.collectionDetailsSort';

export function parseLinkSort(stored: string | null): LinkSortOption {
  return stored === 'oldest' || stored === 'title' || stored === 'titleDesc' ? stored : 'newest';
}

export const isNameSort = (sort: LinkSortOption): sort is 'title' | 'titleDesc' => sort === 'title' || sort === 'titleDesc';

/** Pressing 시간순: first press picks newest ↓; pressed again it flips ↓ ↔ ↑ (mobile nextDateSort). */
export const nextDateSort = (current: LinkSortOption): LinkSortOption => (current === 'newest' ? 'oldest' : 'newest');

/** Pressing 이름순: first press picks A→Z ↑; pressed again it flips ↑ ↔ ↓ (mobile nextNameSort). */
export const nextNameSort = (current: LinkSortOption): LinkSortOption => (current === 'title' ? 'titleDesc' : 'title');

const NAME_PAGE_LIMIT = 50;

export function collectionPath(collectionId: number): string {
  return `/api/v1/collections/${collectionId}`;
}

export function collectionSectionsPath(collectionId: number): string {
  return `/api/v1/collections/${collectionId}/items/sections`;
}

export function collectionSectionPagePath(
  collectionId: number,
  section: Pick<DateSection, 'fromUtc' | 'toUtc'>,
  direction: 'newest' | 'oldest',
  cursor: string | null,
): string {
  const query = new URLSearchParams({ limit: String(DATE_SECTION_PAGE_SIZE), sort: direction === 'oldest' ? 'dateAsc' : 'dateDesc', fromUtc: section.fromUtc });
  if (section.toUtc) {
    query.set('toUtc', section.toUtc);
  }
  if (cursor) {
    query.set('cursor', cursor);
  }
  return `/api/v1/collections/${collectionId}/items?${query.toString()}`;
}

/** One SQL/keyset page in the requested visible-name order. */
export function collectionNamePagePath(collectionId: number, direction: 'asc' | 'desc', cursor: string | null): string {
  const query = new URLSearchParams({ limit: String(NAME_PAGE_LIMIT), sort: direction === 'asc' ? 'nameAsc' : 'nameDesc' });
  if (cursor) {
    query.set('cursor', cursor);
  }
  return `/api/v1/collections/${collectionId}/items?${query.toString()}`;
}

/** Which password withholds the content: the Owner's lock, a member's share password, or none (any other answer). */
export function contentGateOf(error: unknown): 'lock' | 'sharePassword' | null {
  if (!(error instanceof ApiHttpError) || error.status !== 403) {
    return null;
  }
  return error.code === 'collectionLocked' ? 'lock' : error.code === 'sharePasswordRequired' ? 'sharePassword' : null;
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiHttpError && error.status === 404;
}
