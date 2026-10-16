import type { RepresentativeImage } from '../images/api/imagesApi';
import { usablePreviewImageUrl } from './usablePreviewImageUrl';

export interface EffectiveThumbnailSourceItem {
  readonly coverImage: RepresentativeImage | null;
  readonly previewImageUrl: string | null;
  readonly representativeImage: RepresentativeImage | null;
}

/**
 * Priority for a saved link's single "at a glance" thumbnail - its 대표 사진: the user's own photo
 * first (the cover, which the server sets whenever a photo is added; else the first photo of an
 * Item saved before that, the existing "representative image"), then the auto-extracted
 * link-preview image from URL metadata (see Item.PreviewImageUrl), then no thumbnail at all. The
 * same order ItemDetails/NewLinkReview show (see representativePhoto.ts). Deliberately a plain pure function
 * (not a component) so this exact ordering is unit-testable with no rendering involved, and so
 * SavedLinkRow only needs to render one already-resolved URL - see
 * ItemRepresentativeThumbnail/resolveSavedLinkPrimaryText for the same shape of decision elsewhere
 * in this module.
 *
 * An automatic preview that is an already-expired Meta CDN URL (see metaPreviewExpiry.ts) counts as no preview: the card
 * shows its fallback right away instead of requesting a picture the CDN is certain to refuse. The user's own photos are
 * never affected - they come first and are Juple's own read URLs.
 */
export function resolveEffectiveThumbnailUrl(item: EffectiveThumbnailSourceItem, nowMs: number = Date.now()): string | null {
  const ownPhoto = item.coverImage?.thumbnailReadUrl ?? item.coverImage?.readUrl
    ?? item.representativeImage?.thumbnailReadUrl ?? item.representativeImage?.readUrl;
  if (ownPhoto != null) {
    return ownPhoto;
  }
  return usablePreviewImageUrl(item.previewImageUrl, nowMs);
}
