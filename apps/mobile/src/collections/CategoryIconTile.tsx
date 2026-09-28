import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { isCustomCollectionColor, resolveCollectionColorKey, resolveCollectionColorTile, type CollectionColorValue } from './collectionColors';
import { resolveCollectionIconComponent } from './collectionIcons';
import { replaceFailedCollectionIconUri, resolveCollectionIconUri } from './collectionIconImageCache';
import { categoryTilePalette, radii } from '../theme/tokens';

interface CategoryIconTileProps {
  /** A Collection's `icon` wire value (see collectionsApi.ts) - unknown/legacy values fall back to Folder, never guessed. */
  readonly icon: string;
  /** Seeds the pastel background/icon tint from categoryTilePalette when `color` is absent - the same seed everywhere a given Collection is shown, so it never picks a different color per screen. */
  readonly collectionId: number;
  /**
   * A Collection's explicit `color` wire value (see collectionsApi.ts), or null/undefined for a
   * Collection with no explicit color chosen yet - in that case this falls back to the same
   * collectionId-deterministic palette exactly as before this feature existed, so an existing
   * Collection's visual never changes just because Color became a real field.
   */
  readonly color?: string | null;
  /**
   * The Collection's icon photo (`iconImageUrl`, or a just-picked local photo in the editor's
   * preview). Shown filling the tile; if it is missing or fails to load (e.g. an expired link),
   * the built-in glyph is shown instead - never an empty tile.
   */
  readonly imageUrl?: string | null;
  /**
   * The photo's `iconImageVersion` - with it, the same photo keeps one URI across responses (see
   * collectionIconImageCache), so it comes from the image cache instead of flashing on every
   * refresh. Absent (a just-picked preview, an older server): imageUrl is shown as-is.
   */
  readonly imageVersion?: string | null;
  /** Tile edge length in dp; the icon glyph itself is drawn at roughly 46% of this. */
  readonly size?: number;
}

/**
 * The one shared "pastel tile + category icon" rendering for a Collection - used everywhere a
 * Collection's icon is shown (Categories list, Category Details header, the New Link
 * Review/Item Details category picker) so the same Collection always looks identical regardless
 * of screen, instead of each screen computing its own tile color or falling back to a plain
 * outline icon with no tile at all. A Collection's own photo, when it has one, takes the tile.
 */
export function CategoryIconTile({ icon, collectionId, color, imageUrl, imageVersion, size = 40 }: CategoryIconTileProps) {
  const [failedUris, setFailedUris] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    setFailedUris(new Set());
  }, [imageUrl]);

  const IconComponent = resolveCollectionIconComponent(icon);
  const explicitColor = color ?? null;
  const explicitColorKey = resolveCollectionColorKey(explicitColor);
  const tile = explicitColorKey || isCustomCollectionColor(explicitColor)
    ? resolveCollectionColorTile((explicitColorKey ?? explicitColor) as CollectionColorValue)
    : categoryTilePalette[Math.abs(collectionId) % categoryTilePalette.length];
  const borderRadius = radii.md + Math.round(size / 8);
  // The kept URI for this photo first; if it cannot load (evicted from the cache after its URL
  // expired, or a picked local file was cleaned up), this response's fresh URL; then the glyph.
  const keptUri = resolveCollectionIconUri(collectionId, imageVersion, imageUrl);
  const displayUri = [keptUri, imageUrl].find(uri => !!uri && !failedUris.has(uri)) ?? null;
  const showImage = displayUri !== null;
  const handleImageError = () => {
    if (!displayUri) {
      return;
    }
    if (imageUrl && displayUri !== imageUrl) {
      replaceFailedCollectionIconUri(collectionId, displayUri, imageUrl);
    }
    setFailedUris(previous => new Set(previous).add(displayUri));
  };

  return (
    <View
      style={[
        styles.tile,
        {
          backgroundColor: tile.background,
          borderRadius,
          height: size,
          width: size,
        },
      ]}
      testID={showImage ? 'collection-icon-image' : undefined}
    >
      {showImage ? (
        <Image
          onError={handleImageError}
          resizeMode="cover"
          source={{ uri: displayUri }}
          style={[styles.image, { borderRadius }]}
        />
      ) : (
        <IconComponent color={tile.icon} size={Math.round(size * 0.46)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    height: '100%',
    width: '100%',
  },
});
