import { COLLECTION_SEARCH_DEBOUNCE_MS, normalizeCollectionSearch, type CollectionFilter, type CollectionSummary } from './collectionsView.ts';
import { collectionHref, isSafeHttpUrl, itemHref, sharedItemHref, siteIdOf, type KnownSiteId } from './savedLinks.ts';

/**
 * The quick suggestions under the Collections search box (GET /api/v1/collections/search-suggestions): a few Collections and a few
 * links. They are a help to jump somewhere - the list below the box stays the complete answer for the same text. The server decides
 * what may be offered (scope, access, locks); this file only shapes and orders what came back. Pure - unit-tested without a browser.
 */

/** One saved link that matched, with the Collection it was found in. No memo, no adder, no URL - the host is enough to recognise it. */
export interface CollectionLinkSuggestion {
  readonly itemId: number;
  readonly collectionId: number;
  readonly collectionName: string;
  readonly title: string;
  readonly hostname: string | null;
  /** The link is the caller's own Item (opened through its own screen) rather than another member's. */
  readonly isMine: boolean;
  /** The saved URL, for the "open original" button (only ever on a link the server may suggest). */
  readonly url: string;
}

export interface CollectionSuggestions {
  readonly collections: readonly CollectionSummary[];
  readonly links: readonly CollectionLinkSuggestion[];
}

/** The suggestions follow the typing after the same pause as the list, so one burst of keys is one request of each. */
export const COLLECTION_SUGGESTION_DEBOUNCE_MS = COLLECTION_SEARCH_DEBOUNCE_MS;

/** At most this many Collections are drawn (the server never sends more than 4). */
export const COLLECTION_SUGGESTION_LIMIT = 4;

/** At most this many links are drawn (the server never sends more than 8; any number of them may come from one Collection). */
export const LINK_SUGGESTION_LIMIT = 8;

export function collectionSuggestionsPath(filter: CollectionFilter, term: string): string {
  const query = new URLSearchParams({ scope: filter, q: normalizeCollectionSearch(term) });
  return `/api/v1/collections/search-suggestions?${query.toString()}`;
}

/** One row of the open panel, in the order it is drawn (Collections, then links) - the keyboard walks exactly this list. */
export type CollectionSuggestionRow =
  | { readonly kind: 'collection'; readonly key: string; readonly href: string; readonly collection: CollectionSummary }
  | {
      readonly kind: 'link';
      readonly key: string;
      readonly href: string;
      readonly title: string;
      /** "Collection · host", the second line. */
      readonly detail: string;
      readonly siteId: KnownSiteId | null;
      /** The original page, only when it is a plain http(s) address - anything else (javascript:, data:, file:, ...) gets no button at all. */
      readonly externalUrl: string | null;
    };

/** Where a link suggestion opens: the link itself, in its Collection (own link: its detail; another member's: the shared read-only view). */
export function linkSuggestionHref(link: Pick<CollectionLinkSuggestion, 'itemId' | 'collectionId' | 'isMine'>): string {
  return link.isMine ? itemHref(link.itemId) : sharedItemHref(link.collectionId, link.itemId);
}

export function linkSuggestionDetail(link: Pick<CollectionLinkSuggestion, 'collectionName' | 'hostname'>): string {
  return link.hostname ? `${link.collectionName} · ${link.hostname}` : link.collectionName;
}

export function suggestionRows(suggestions: CollectionSuggestions | null): { readonly collections: readonly CollectionSuggestionRow[]; readonly links: readonly CollectionSuggestionRow[] } {
  if (suggestions === null) {
    return { collections: [], links: [] };
  }
  return {
    collections: suggestions.collections.slice(0, COLLECTION_SUGGESTION_LIMIT).map(collection => ({
      kind: 'collection' as const,
      key: `c${collection.id}`,
      href: collectionHref(collection.id),
      collection,
    })),
    links: suggestions.links.slice(0, LINK_SUGGESTION_LIMIT).map(link => ({
      kind: 'link' as const,
      key: `l${link.collectionId}-${link.itemId}`,
      href: linkSuggestionHref(link),
      title: link.title,
      detail: linkSuggestionDetail(link),
      siteId: link.hostname ? siteIdOf(`https://${link.hostname}`) : null,
      externalUrl: isSafeHttpUrl(link.url) ? link.url : null,
    })),
  };
}

/** The next highlighted row for an arrow key: -1 = none; Down/Up wrap around the ends (Up from none goes to the last). */
export function nextSuggestionIndex(current: number, count: number, key: 'ArrowDown' | 'ArrowUp'): number {
  if (count <= 0) {
    return -1;
  }
  if (key === 'ArrowDown') {
    return current < 0 || current >= count - 1 ? 0 : current + 1;
  }
  return current <= 0 ? count - 1 : current - 1;
}

/** A result belongs to exactly one (tab, text): a late answer of another pair is never drawn. */
export function suggestionKey(filter: CollectionFilter, term: string): string {
  return `${filter}\u0000${normalizeCollectionSearch(term)}`;
}
