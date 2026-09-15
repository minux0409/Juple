import type { ItemImage } from '../images/api/imagesApi';

/**
 * The single unified "사진" list shown to the user - deliberately erasing the old "대표 이미지 /
 * 추가 이미지" distinction from the UI while keeping the underlying storage semantics completely
 * separate (see each variant's own remarks): 'auto' is Item.PreviewImageUrl (metadata-derived,
 * external, never uploaded to Blob storage), 'uploaded' is one of the Item's own ItemImages
 * (already persisted to Blob storage), and 'staged' is a user-picked local asset on
 * NewLinkReviewScreen that has no server identity yet (the Item itself doesn't exist until Save).
 * Never merge these into one storage concept - only their on-screen presentation is unified.
 */
export type EffectiveImage =
  | { readonly kind: 'auto'; readonly url: string }
  | { readonly kind: 'uploaded'; readonly image: ItemImage }
  | { readonly kind: 'staged'; readonly stagedId: string; readonly localUri: string };

/**
 * Total effective images (auto preview + uploaded/staged) a single Item may show at once - see the
 * matching MaxEffectiveImagesPerItem on the backend (ItemImageStore). A soft cap only ever enforced
 * on new additions; an existing list already longer than this (legacy data, or a preview that
 * arrived after uploads had already filled both slots) is still rendered in full, never truncated
 * or otherwise lossy here.
 */
export const MAX_EFFECTIVE_IMAGES = 2;

/** Any already-resolved, renderable image URL for a given effective image - null only for an
 * 'uploaded' entry whose signed read URL failed to resolve server-side. */
export function effectiveImageUrl(image: EffectiveImage): string | null {
  switch (image.kind) {
    case 'auto':
      return image.url;
    case 'uploaded':
      return image.image.readUrl;
    case 'staged':
      return image.localUri;
  }
}

/** Stable across re-renders/reorders for the same underlying image - required for DragList/FlatList keying. */
export function effectiveImageKey(image: EffectiveImage): string {
  switch (image.kind) {
    case 'auto':
      return 'auto';
    case 'uploaded':
      return `uploaded-${image.image.id}`;
    case 'staged':
      return `staged-${image.stagedId}`;
  }
}

/** Only 'uploaded'/'staged' images can ever be deleted by the user - the auto preview has no
 * "remove" affordance in this round (see docs: no "clear preview image" UI). */
export function isDeletable(image: EffectiveImage): boolean {
  return image.kind !== 'auto';
}

/**
 * Builds the unified, already-ordered photo list for an existing Item: the auto-extracted preview
 * (if any) followed by the user's own uploaded images in their existing SortOrder, then - if
 * coverImageId names one of those uploaded images - moved so that image sits first. SortOrder
 * itself is never changed by this; CoverImageId is the *only* thing that controls display order
 * (see Item.CoverImageId's backend remarks), which is exactly what lets a reorder be undone by
 * dragging the same image back, or by clearing CoverImageId entirely.
 */
export function buildEffectiveImages(
  previewImageUrl: string | null,
  images: readonly ItemImage[],
  coverImageId: number | null,
): EffectiveImage[] {
  const base: EffectiveImage[] = [
    ...(previewImageUrl !== null ? [{ kind: 'auto', url: previewImageUrl } as const] : []),
    ...images.map(image => ({ kind: 'uploaded', image }) as const),
  ];

  if (coverImageId === null) {
    return base;
  }

  const frontIndex = base.findIndex(entry => entry.kind === 'uploaded' && entry.image.id === coverImageId);
  if (frontIndex <= 0) {
    return base;
  }

  const reordered = [...base];
  const [front] = reordered.splice(frontIndex, 1);
  reordered.unshift(front);
  return reordered;
}

/** Pure splice-based reorder, matching react-native-draglist's onReordered(fromIndex, toIndex) contract. */
export function reorderList<T>(list: readonly T[], fromIndex: number, toIndex: number): T[] {
  const reordered = [...list];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  return reordered;
}

/**
 * After a reorder, the CoverImageId that must be persisted (via setItemCoverImage) for the new
 * front position to actually stick - null when the front is the auto entry (or the list is
 * empty), which is also exactly what "drag auto back to the front" must send to fully clear a
 * previous override rather than leaving a stale one in place.
 */
export function coverImageIdForFront(list: readonly EffectiveImage[]): number | null {
  const front = list[0];
  return front?.kind === 'uploaded' ? front.image.id : null;
}
