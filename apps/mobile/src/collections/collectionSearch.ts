/** The server's limit for the Collections list search (CollectionListSearch.MaxLength). */
export const COLLECTION_SEARCH_MAX_LENGTH = 100;

/** The term as it is searched: trimmed, at most the server's length; blank means no search. */
export function normalizeCollectionSearch(value: string | null | undefined): string {
  return Array.from((value ?? '').trim()).slice(0, COLLECTION_SEARCH_MAX_LENGTH).join('').trim();
}
