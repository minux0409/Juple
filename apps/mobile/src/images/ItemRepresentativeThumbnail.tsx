import { Image, StyleSheet } from 'react-native';
import { useStableImageUri } from './stableImageUri';

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
}

/**
 * Fixed small square thumbnail for a list row (Inbox/Wishlist/Archive). Renders nothing - not
 * even a placeholder - when there's no image, or when the given URL fails to load: a broken
 * thumbnail must never break the row, so failure just means "no thumbnail", collapsing back to
 * the existing text-only row layout.
 */
export function ItemRepresentativeThumbnail({ imageUrl, cacheKey }: ItemRepresentativeThumbnailProps) {
  // The kept URI for this photo first, then (once) this response's fresh short-TTL URL; a later refresh hands back a new fresh
  // URL, which gets its own attempt rather than staying hidden forever because an earlier one failed.
  const { uri, onError } = useStableImageUri(cacheKey, imageUrl);

  if (!uri) {
    return null;
  }

  return (
    <Image
      onError={onError}
      source={{ uri }}
      style={styles.thumbnail}
    />
  );
}

const styles = StyleSheet.create({
  thumbnail: {
    backgroundColor: '#E7ECF3',
    borderRadius: 14,
    height: 60,
    marginEnd: 12,
    width: 60,
  },
});
