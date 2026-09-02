import { useState } from 'react';
import { Image, StyleSheet } from 'react-native';
import type { RepresentativeImage } from './api/imagesApi';

interface ItemRepresentativeThumbnailProps {
  readonly representativeImage: RepresentativeImage | null;
}

/**
 * Fixed small square thumbnail for a list row (Inbox/Wishlist/Archive). Renders nothing - not
 * even a placeholder - when there's no representative image, or when the given readUrl fails to
 * load: a broken thumbnail must never break the row, so failure just means "no thumbnail",
 * collapsing back to the existing text-only row layout.
 */
export function ItemRepresentativeThumbnail({
  representativeImage,
}: ItemRepresentativeThumbnailProps) {
  // Tracks the specific URL that failed, not just a boolean - a later refresh hands back a fresh
  // short-TTL SAS URL for the same Item, which deserves its own load attempt rather than staying
  // hidden forever because a previous URL once failed.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!representativeImage || representativeImage.readUrl === failedUrl) {
    return null;
  }

  return (
    <Image
      onError={() => setFailedUrl(representativeImage.readUrl)}
      source={{ uri: representativeImage.readUrl }}
      style={styles.thumbnail}
    />
  );
}

const styles = StyleSheet.create({
  thumbnail: {
    backgroundColor: '#E0E0E0',
    borderRadius: 8,
    height: 56,
    marginRight: 12,
    width: 56,
  },
});
