import { StyleSheet, View } from 'react-native';
import { resolveCollectionIconComponent } from './collectionIcons';
import { categoryTilePalette, radii } from '../theme/tokens';

interface CategoryIconTileProps {
  /** A Collection's `icon` wire value (see collectionsApi.ts) - unknown/legacy values fall back to Folder, never guessed. */
  readonly icon: string;
  /** Seeds the pastel background/icon tint from categoryTilePalette - the same seed everywhere a given Collection is shown, so it never picks a different color per screen. */
  readonly collectionId: number;
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
export function CategoryIconTile({ icon, collectionId, size = 40 }: CategoryIconTileProps) {
  const IconComponent = resolveCollectionIconComponent(icon);
  const tile = categoryTilePalette[Math.abs(collectionId) % categoryTilePalette.length];

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
