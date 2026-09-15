import type { RepresentativeImage } from '../images/api/imagesApi';

export interface EffectiveThumbnailSourceItem {
  readonly coverImage: RepresentativeImage | null;
  readonly previewImageUrl: string | null;
  readonly representativeImage: RepresentativeImage | null;
}

/**
 * Priority for a saved link's single "at a glance" thumbnail: the user's own explicit cover
 * choice first (see ItemDetailsScreen's cover picker), then the auto-extracted link-preview image
 * from URL metadata (see Item.PreviewImageUrl), then the first user-uploaded image (the existing
 * "representative image" concept), then no thumbnail at all. Deliberately a plain pure function
 * (not a component) so this exact ordering is unit-testable with no rendering involved, and so
 * SavedLinkRow only needs to render one already-resolved URL - see
 * ItemRepresentativeThumbnail/resolveSavedLinkPrimaryText for the same shape of decision elsewhere
 * in this module.
 */
export function resolveEffectiveThumbnailUrl(item: EffectiveThumbnailSourceItem): string | null {
  return item.coverImage?.readUrl ?? item.previewImageUrl ?? item.representativeImage?.readUrl ?? null;
}
