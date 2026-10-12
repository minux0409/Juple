import { formatJupleId } from './accountDisplay.ts';
import type { CollectionSummary } from './collectionsView.ts';
import { isSafeHttpUrl, type CollectionItemAdder, type ImageRef } from './savedLinks.ts';

/**
 * A link's own page for the signed-in Web app - the mobile ItemDetailsScreen read side, on the same API:
 *
 *  - GET /api/v1/items/{id}: title, URL, memo, when it was saved, the automatic preview image and the cover choice.
 *  - GET /api/v1/items/{id}/images: the user's own photo(s) - with the preview they decide the one 대표 사진.
 *  - GET /api/v1/collections?itemId={id}&scope=all: every Collection the link is in (mine and the shared ones), all pages.
 *
 * Another member's link in a shared Collection is a different, read-only view (mobile CollectionSharedItemScreen):
 * GET /api/v1/collections/{collectionId}/items/{itemId} - title, URL, preview image and who added it; never a memo or a photo.
 */

/** Mirrors GET /api/v1/items/{id} (apps/mobile items/api/itemsApi.ts ItemDetails). */
export interface ItemDetails {
  readonly id: number;
  readonly url: string;
  readonly title: string | null;
  readonly memo: string | null;
  readonly savedAtUtc: string;
  readonly previewImageUrl: string | null;
  readonly coverImage: ImageRef | null;
}

/** Mirrors one row of GET /api/v1/items/{id}/images (apps/mobile images/api/imagesApi.ts ItemImage) - the fields used here. */
export interface ItemImage {
  readonly id: number;
  readonly readUrl: string | null;
}

/** Mirrors GET /api/v1/collections/{id}/items/{itemId} (apps/mobile collectionsApi.ts SharedCollectionItem). */
export interface SharedCollectionItem {
  readonly itemId: number;
  readonly url: string;
  readonly title: string | null;
  readonly previewImageUrl: string | null;
  readonly addedAtUtc: string;
  readonly isMine: boolean;
  readonly addedBy?: CollectionItemAdder | null;
}

export function itemPath(itemId: number): string {
  return `/api/v1/items/${itemId}`;
}

export function itemImagesPath(itemId: number): string {
  return `/api/v1/items/${itemId}/images`;
}

/**
 * A read of the link IN the Collection that locks its Home / 보관함 card (mobile itemReadContextRequest): the server applies that
 * Collection's CURRENT gate first and needs this opening's grant for it. Without a context it is the plain read.
 */
export function itemReadPath(itemId: number, lockedBy: number | null): string {
  return lockedBy === null ? itemPath(itemId) : `${itemPath(itemId)}?collectionId=${lockedBy}`;
}

export function itemImagesReadPath(itemId: number, lockedBy: number | null): string {
  return lockedBy === null ? itemImagesPath(itemId) : `${itemImagesPath(itemId)}?collectionId=${lockedBy}`;
}

/** The mobile membership page size (itemMemberships.ts). */
const MEMBERSHIP_PAGE_LIMIT = 50;

/** Every Collection the link is in - scope 'all' (the owned scope alone would leave the shared ones out), drained page by page. */
export function itemCollectionsPath(itemId: number, cursor: string | null): string {
  const query = new URLSearchParams({ itemId: String(itemId), scope: 'all', limit: String(MEMBERSHIP_PAGE_LIMIT) });
  if (cursor) {
    query.set('cursor', cursor);
  }
  return `/api/v1/collections?${query.toString()}`;
}

export interface CollectionsPageOf {
  readonly items: readonly CollectionSummary[];
  readonly nextCursor: string | null;
}

export function sharedItemPath(collectionId: number, itemId: number): string {
  return `/api/v1/collections/${collectionId}/items/${itemId}`;
}

/**
 * The one 대표 사진 (mobile representativePhoto.ts): the user's own photo when there is one (the chosen cover, else the first), otherwise
 * the link's automatic preview image, otherwise none. Only an http(s) read URL is ever shown.
 */
/** The photo the person can change or delete (mobile resolveRepresentativePhoto 'uploaded'): the chosen cover, else the first; none = no own photo. */
export function ownPhotoOf(images: readonly ItemImage[], coverImageId: number | null | undefined): ItemImage | null {
  return images.find(image => image.id === coverImageId) ?? images[0] ?? null;
}

export function representativePhotoUrl(previewImageUrl: string | null, images: readonly ItemImage[], coverImageId: number | null | undefined): string | null {
  const own = images.find(image => image.id === coverImageId) ?? images[0];
  const url = own ? own.readUrl : previewImageUrl;
  return isSafeHttpUrl(url) ? url : null;
}

/**
 * Who added a link, as words (mobile describeItemAdder / personLabel): a person by display name, else their public Juple ID; a
 * 모든 사용자-link add is never identified. Null when the server did not say.
 */
export type AdderLabel = { readonly kind: 'me' } | { readonly kind: 'publicLink' } | { readonly kind: 'person'; readonly name: string };

export function adderLabel(adder: CollectionItemAdder | null | undefined): AdderLabel | null {
  if (!adder) {
    return null;
  }
  if (adder.kind === 'publicLink') {
    return { kind: 'publicLink' };
  }
  if (adder.kind === 'me') {
    return { kind: 'me' };
  }
  if (!adder.jupleId) {
    return null;
  }
  return { kind: 'person', name: adder.displayName?.trim() || formatJupleId(adder.jupleId) };
}
