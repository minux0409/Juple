import type { LinkSortOption } from '../settings/sortPreference';
import type { CollectionItemEntry } from './api/collectionsApi';

/**
 * Pure client-side re-sort of a Collection's already-fetched item pages (the server itself has no
 * sort query parameter - see getCollectionItems/useCollectionItems, which always returns newest-
 * added-first) - applied fresh over the full accumulated `items` array on every render, so it stays
 * correct regardless of how many pages loadMore has pulled in so far. 'newest'/'oldest' sort by
 * addedAtUtc (an ISO 8601 string, so plain lexicographic comparison already sorts chronologically);
 * 'title' does a locale-aware compare, with title-less items (SavedLinkRow's own hostname-fallback
 * case) sorted after every titled item rather than mixed in arbitrarily.
 */
export function sortCollectionItems(
  items: readonly CollectionItemEntry[],
  sort: LinkSortOption,
): readonly CollectionItemEntry[] {
  const sorted = [...items];
  switch (sort) {
    case 'newest':
      sorted.sort((a, b) => b.addedAtUtc.localeCompare(a.addedAtUtc));
      break;
    case 'oldest':
      sorted.sort((a, b) => a.addedAtUtc.localeCompare(b.addedAtUtc));
      break;
    case 'title':
      sorted.sort((a, b) => {
        if (a.title === null && b.title === null) {
          return 0;
        }
        if (a.title === null) {
          return 1;
        }
        if (b.title === null) {
          return -1;
        }
        return a.title.localeCompare(b.title);
      });
      break;
  }
  return sorted;
}
