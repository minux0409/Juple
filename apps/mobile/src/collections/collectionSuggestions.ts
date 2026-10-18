import type { Collection, CollectionLinkSuggestion, CollectionSearchSuggestions } from './api/collectionsApi';
import { resolveSiteInfo } from '../items/resolveSiteInfo';
import { isHttpUrl } from '../share/resolveIncomingShare';
import type { KnownSiteId } from '../items/resolveSiteInfo';

/**
 * The quick suggestions under the Collections search box, shaped for a phone: at most this many of each kind are drawn (the server
 * sends up to four of each). A help to jump somewhere; the list below stays the complete answer for the same text.
 */
export const COLLECTION_SUGGESTION_LIMIT = 3;
/** Links: a Collection's own links are what people look for, so more are drawn (the server sends up to eight, any number from one Collection). */
export const LINK_SUGGESTION_LIMIT = 6;

export type CollectionSuggestionRow =
  | { readonly kind: 'collection'; readonly key: string; readonly collection: Collection }
  | {
      readonly kind: 'link';
      readonly key: string;
      readonly link: CollectionLinkSuggestion;
      readonly title: string;
      /** "Collection · host", the second line. */
      readonly detail: string;
      readonly siteId: KnownSiteId | null;
      /** The original page, only when it is a plain http(s) address - anything else (javascript:, data:, file:, ...) gets no button at all. */
      readonly externalUrl: string | null;
    };

export function linkSuggestionDetail(link: Pick<CollectionLinkSuggestion, 'collectionName' | 'hostname'>): string {
  return link.hostname ? `${link.collectionName} · ${link.hostname}` : link.collectionName;
}

export function suggestionRows(suggestions: CollectionSearchSuggestions | null): {
  readonly collections: readonly CollectionSuggestionRow[];
  readonly links: readonly CollectionSuggestionRow[];
} {
  if (suggestions === null) {
    return { collections: [], links: [] };
  }
  return {
    collections: suggestions.collections.slice(0, COLLECTION_SUGGESTION_LIMIT).map(collection => ({ kind: 'collection' as const, key: `c${collection.id}`, collection })),
    links: suggestions.links.slice(0, LINK_SUGGESTION_LIMIT).map(link => ({
      kind: 'link' as const,
      key: `l${link.collectionId}-${link.itemId}`,
      link,
      title: link.title,
      detail: linkSuggestionDetail(link),
      siteId: link.hostname ? resolveSiteInfo(`https://${link.hostname}`).id : null,
      externalUrl: isHttpUrl(link.url) ? link.url : null,
    })),
  };
}

/** A result belongs to exactly one (tab, text): the answer of another pair is never drawn. */
export function suggestionKey(scope: string, term: string): string {
  return `${scope}\u0000${term}`;
}
