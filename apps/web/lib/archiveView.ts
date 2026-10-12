import { DATE_SECTION_PAGE_SIZE, type DateSection } from './savedLinks.ts';

/**
 * 보관함 for the signed-in Web app - the mobile Archive (DateHistoryScreen) read side, on the same API:
 *
 *  - 시간순 (newest first): GET /api/v1/items/history/sections - every non-empty 오늘 / 어제 / 이번 주 / month section with its exact
 *    count (the user's own calendar, computed by the server) - then each OPENED section's links, a page at a time, from
 *    GET /api/v1/items/history with that section's fromUtc / toUtc.
 *  - 이름순 (A-Z): the whole archive as ONE flat list in the server's name order (GET /api/v1/items/history?sort=name), page by page.
 *
 * The Archive offers only these two plain orders (mobile: "the two plain orders" - no direction flip here).
 */

export type ArchiveSort = 'time' | 'name';

/** The mobile flat (이름순) page size - ARCHIVE_SEARCH_PAGE_SIZE. */
export const ARCHIVE_FLAT_PAGE_SIZE = 30;

export const ARCHIVE_SORT_STORAGE_KEY = 'juple.web.archiveSort';

export function parseArchiveSort(stored: string | null): ArchiveSort {
  return stored === 'name' ? 'name' : 'time';
}

export const ARCHIVE_SECTIONS_PATH = '/api/v1/items/history/sections';

/** One section's next page - its own window, its own cursor. */
export function archiveSectionPagePath(section: Pick<DateSection, 'fromUtc' | 'toUtc'>, cursor: string | null): string {
  const query = new URLSearchParams({ limit: String(DATE_SECTION_PAGE_SIZE), fromUtc: section.fromUtc });
  if (section.toUtc) {
    query.set('toUtc', section.toUtc);
  }
  if (cursor) {
    query.set('cursor', cursor);
  }
  return `/api/v1/items/history?${query.toString()}`;
}

/** 이름순: the whole archive A-Z on the server (titled by title, title-less by site, still-locked links last) - never with a window. */
export function archiveNamePagePath(cursor: string | null): string {
  const query = new URLSearchParams({ limit: String(ARCHIVE_FLAT_PAGE_SIZE), sort: 'name' });
  if (cursor) {
    query.set('cursor', cursor);
  }
  return `/api/v1/items/history?${query.toString()}`;
}

/** Shorter terms are not searched (mobile ARCHIVE_SEARCH_MIN_LENGTH: a 1-character contains search matches nearly everything). */
export const ARCHIVE_SEARCH_MIN_LENGTH = 2;
export const ARCHIVE_SEARCH_DEBOUNCE_MS = 300;

/** The trimmed term when it is long enough to search, else null (the normal Archive shows) - mobile normalizeArchiveQuery. */
export function normalizeArchiveQuery(raw: string): string | null {
  const term = raw.trim();
  return term.length >= ARCHIVE_SEARCH_MIN_LENGTH ? term : null;
}

/**
 * The archive as one flat server-paged list (mobile useArchiveSearch): a search over the WHOLE archive (title, link / site, own
 * memo) and / or 이름순 over it. The same query either way - only the order differs (newest first, or A-Z with sort=name). Never
 * combined with a date window.
 */
export function archiveFlatPagePath(options: { readonly term: string | null; readonly sort: ArchiveSort; readonly cursor: string | null }): string {
  const query = new URLSearchParams({ limit: String(ARCHIVE_FLAT_PAGE_SIZE) });
  if (options.term) {
    query.set('q', options.term);
  }
  if (options.sort === 'name') {
    query.set('sort', 'name');
  }
  if (options.cursor) {
    query.set('cursor', options.cursor);
  }
  return `/api/v1/items/history?${query.toString()}`;
}
