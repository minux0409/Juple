import type { RepresentativeImage } from '../images/api/imagesApi';

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
 */
export function resolveEffectiveThumbnailUrl(item: EffectiveThumbnailSourceItem): string | null {
  return item.coverImage?.readUrl ?? item.representativeImage?.readUrl ?? item.previewImageUrl ?? null;
}
