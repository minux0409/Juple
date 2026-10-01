import type { ItemImage } from '../images/api/imagesApi';

/**
 * An Item's one representative photo (대표 사진): the user's own photo when there is one, otherwise
 * the link's automatic preview image, otherwise none. The same order every card uses (see
 * resolveEffectiveThumbnailUrl), so the photo shown here is the one shown everywhere.
 */
export type RepresentativePhoto =
  | { readonly kind: 'uploaded'; readonly image: ItemImage }
  | { readonly kind: 'auto'; readonly url: string };

/**
 * An Item has at most one photo of its own now; one saved when two were allowed may still list
 * more - then the cover (else the first) is the one shown and acted on, and changing or deleting
 * it leaves the Item with exactly one or none (the server normalizes the rest away).
 */
export function resolveRepresentativePhoto(
  previewImageUrl: string | null,
  images: readonly ItemImage[],
  coverImageId: number | null,
): RepresentativePhoto | null {
  const own = images.find(image => image.id === coverImageId) ?? images[0];
  if (own) {
    return { kind: 'uploaded', image: own };
  }
  return previewImageUrl ? { kind: 'auto', url: previewImageUrl } : null;
}

export function representativePhotoUrl(photo: RepresentativePhoto | null): string | null {
  if (!photo) {
    return null;
  }
  return photo.kind === 'uploaded' ? photo.image.readUrl : photo.url;
}
