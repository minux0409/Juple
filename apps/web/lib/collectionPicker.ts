/**
 * 컬렉션 검색 on the review page. The mobile picker has no search and GET /api/v1/collections has no search parameter, so this is a
 * plain filter of the destinations already loaded (every page of them) - no new endpoint, nothing sent. Matching is by the name the
 * person sees: case-insensitive, full-width / compatibility forms of the same text treated alike (NFKC), anywhere in the name.
 */
export const COLLECTION_SEARCH_DEBOUNCE_MS = 250;

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().trim();
}

export function filterCollectionsByName<T extends { readonly name: string }>(collections: readonly T[], query: string): readonly T[] {
  const needle = normalized(query);
  return needle ? collections.filter(collection => normalized(collection.name).includes(needle)) : collections;
}
