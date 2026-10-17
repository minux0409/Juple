import type { ReactNode } from 'react';
import { Image, View } from 'react-native';
import { useStableImageUri } from './stableImageUri';
import { colors, themedStyles } from '../theme/tokens';

interface ItemRepresentativeThumbnailProps {
  /**
   * Any already-resolved, renderable image URL - the first-uploaded ItemImage's signed read URL
   * (see RepresentativeImage), an explicit user-chosen cover's read URL, or an external metadata
   * PreviewImageUrl. This component only ever displays a URL; deciding which source wins for a
   * given row (see resolveEffectiveThumbnailUrl) is the caller's job.
   */
  readonly imageUrl: string | null;
  /** The photo's stable image-cache identity (resolveEffectiveThumbnail) - the kept URI then comes from the image cache. */
  readonly cacheKey?: string | null;
  /**
   * What fills the same 60 x 60 slot when there is no picture, or it fails to load. Without it the slot collapses to nothing (the
   * text-only row). A row that must keep its media area - so a selection mark never lands on its title - passes one.
   */
  readonly fallback?: ReactNode;
}

/**
 * Fixed small square thumbnail for a list row (Inbox/Wishlist/Archive). Without a `fallback` it renders
 * nothing when there's no image, or when the given URL fails to load: a broken thumbnail must never break
 * the row, so failure just means "no thumbnail", collapsing back to the text-only row layout. With a
 * `fallback` the same square is kept and the fallback is drawn in it.
 */
export function ItemRepresentativeThumbnail({ imageUrl, cacheKey, fallback }: ItemRepresentativeThumbnailProps) {
  // The kept URI for this photo first, then (once) this response's fresh short-TTL URL; a later refresh hands back a new fresh
  // URL, which gets its own attempt rather than staying hidden forever because an earlier one failed.
  const { uri, onError } = useStableImageUri(cacheKey, imageUrl);

  if (!uri) {
    return fallback ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.thumbnail, styles.fallback]} testID="saved-link-thumbnail-placeholder">{fallback}</View> : null;
  }

  return (
    <Image
      onError={onError}
      source={{ uri }}
      style={styles.thumbnail}
    />
  );
}

const styles = themedStyles(() => ({
  thumbnail: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 14,
    height: 60,
    marginEnd: 12,
    width: 60,
  },
  fallback: { alignItems: 'center', justifyContent: 'center' },
}));
