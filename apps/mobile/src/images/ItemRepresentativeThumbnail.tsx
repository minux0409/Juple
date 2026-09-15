import { useState } from 'react';
import { Image, StyleSheet } from 'react-native';

interface ItemRepresentativeThumbnailProps {
  /**
   * Any already-resolved, renderable image URL - the first-uploaded ItemImage's signed read URL
   * (see RepresentativeImage), an explicit user-chosen cover's read URL, or an external metadata
   * PreviewImageUrl. This component only ever displays a URL; deciding which source wins for a
   * given row (see resolveEffectiveThumbnailUrl) is the caller's job.
   */
  readonly imageUrl: string | null;
}

/**
 * Fixed small square thumbnail for a list row (Inbox/Wishlist/Archive). Renders nothing - not
 * even a placeholder - when there's no image, or when the given URL fails to load: a broken
 * thumbnail must never break the row, so failure just means "no thumbnail", collapsing back to
 * the existing text-only row layout.
 */
export function ItemRepresentativeThumbnail({ imageUrl }: ItemRepresentativeThumbnailProps) {
  // Tracks the specific URL that failed, not just a boolean - a later refresh hands back a fresh
  // short-TTL SAS URL for the same Item, which deserves its own load attempt rather than staying
  // hidden forever because a previous URL once failed.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!imageUrl || imageUrl === failedUrl) {
    return null;
  }

  return (
    <Image
      onError={() => setFailedUrl(imageUrl)}
      source={{ uri: imageUrl }}
      style={styles.thumbnail}
    />
  );
}

const styles = StyleSheet.create({
  thumbnail: {
    backgroundColor: '#E0E0E0',
    borderRadius: 8,
    height: 56,
    marginEnd: 12,
    width: 56,
  },
});
