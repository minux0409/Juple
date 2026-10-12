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
