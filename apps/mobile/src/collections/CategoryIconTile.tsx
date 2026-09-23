import { StyleSheet, View } from 'react-native';
import { isCustomCollectionColor, resolveCollectionColorKey, resolveCollectionColorTile, type CollectionColorValue } from './collectionColors';
import { resolveCollectionIconComponent } from './collectionIcons';
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
  /** Tile edge length in dp; the icon glyph itself is drawn at roughly 46% of this. */
  readonly size?: number;
}

/**
 * The one shared "pastel tile + category icon" rendering for a Collection - used everywhere a
 * Collection's icon is shown (Categories list, Category Details header, the New Link
 * Review/Item Details category picker) so the same Collection always looks identical regardless
 * of screen, instead of each screen computing its own tile color or falling back to a plain
 * outline icon with no tile at all.
 */
export function CategoryIconTile({ icon, collectionId, color, size = 40 }: CategoryIconTileProps) {
  const IconComponent = resolveCollectionIconComponent(icon);
  const explicitColor = color ?? null;
  const explicitColorKey = resolveCollectionColorKey(explicitColor);
  const tile = explicitColorKey || isCustomCollectionColor(explicitColor)
    ? resolveCollectionColorTile((explicitColorKey ?? explicitColor) as CollectionColorValue)
    : categoryTilePalette[Math.abs(collectionId) % categoryTilePalette.length];

  return (
    <View
      style={[
        styles.tile,
        {
          backgroundColor: tile.background,
          borderRadius: radii.md + Math.round(size / 8),
          height: size,
          width: size,
        },
      ]}
    >
      <IconComponent color={tile.icon} size={Math.round(size * 0.46)} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
