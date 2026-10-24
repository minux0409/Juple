import type { AppApi } from './appApi.ts';
import { parseLinkSort, type LinkSortOption } from './collectionDetails.ts';
import { collectionsPath, type CollectionSummary, type CollectionsPage } from './collectionsView.ts';

/**
 * Home's 즐겨찾기: EVERY favorite Collection (the server's list of the 즐겨찾기 scope, page by page - never the first few the home summary
 * lists as shortcuts), shown in a box that scrolls inside itself, in the sort and view the person chose (kept per browser like the Collections
 * page's view). The Collections list itself has no sort control; the sort chips are the link lists' (시간순 / 이름순):
 * 시간순 is the server's own order (newest first) or its reverse, 이름순 is by name in the person's language.
 */
export const HOME_FAVORITES_SORT_STORAGE_KEY = 'juple.web.homeFavoritesSort';

/** The most pages read (50 each): a guard against a loop, far beyond any real number of favorites. */
export const FAVORITES_MAX_PAGES = 40;

export const parseFavoritesSort = parseLinkSort;

/** All of the person's favorite Collections, in the server's order. A page that fails fails the whole read (no half list shown as complete). */
export async function loadAllFavorites(api: AppApi, maxPages: number = FAVORITES_MAX_PAGES): Promise<readonly CollectionSummary[]> {
  const items: CollectionSummary[] = [];
  const seen = new Set<number>();
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const result: CollectionsPage = await api<CollectionsPage>({ path: collectionsPath('favorites', cursor, null) });
    for (const item of result.items) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    }
    if (!result.nextCursor) {
      return items;
    }
    cursor = result.nextCursor;
  }
  return items;
}

export function sortFavorites(items: readonly CollectionSummary[], sort: LinkSortOption, locale: string): readonly CollectionSummary[] {
  switch (sort) {
    case 'newest':
      return items;
    case 'oldest':
      return [...items].reverse();
    case 'title':
    case 'titleDesc': {
      const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
      const byName = [...items].sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id);
      return sort === 'title' ? byName : byName.reverse();
    }
  }
}
