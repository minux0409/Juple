import type { ReactElement } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { SavedLinkViewMode, TrashViewMode } from '../settings/viewModePreference';
import { colors, radii } from '../theme/tokens';

type ToggleMode = SavedLinkViewMode | TrashViewMode;

interface ViewModeToggleProps<Mode extends ToggleMode> {
  readonly value: Mode;
  readonly onChange: (value: Mode) => void;
  /** Adds the third, image-only option (Home and the Archive); every other screen keeps List / Grid. */
  readonly showImage?: boolean;
  /** Adds the third, compact 3-column Grid option (deleted links only), drawn with the same nine-block glyph as Image view. */
  readonly showCompact?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}

function ListGlyph({ selected }: { readonly selected: boolean }) {
  return <View style={styles.listGlyph} testID="view-mode-list-glyph">{[0, 1, 2].map(index => <View key={index} style={[styles.listLine, selected && styles.glyphSelected]} />)}</View>;
}

function GridGlyph({ selected }: { readonly selected: boolean }) {
  return <View style={styles.gridGlyph} testID="view-mode-grid-glyph">{[0, 1, 2, 3].map(index => <View key={index} style={[styles.gridDot, selected && styles.glyphSelected]} />)}</View>;
}

/** Nine small blocks in 3 rows of 3 - clearly denser than the Grid glyph's four large ones, like the 3-column picture grid it selects. */
function ImageGlyph({ selected }: { readonly selected: boolean }) {
  return <View style={styles.imageGlyph} testID="view-mode-image-glyph">{Array.from({ length: 9 }, (_, index) => <View key={index} style={[styles.imageDot, selected && styles.glyphSelected]} />)}</View>;
}

/** Compact List / Grid (/ Image) presentation switch shared by link and Collection screens. */
export function ViewModeToggle<Mode extends ToggleMode = ToggleMode>({ value, onChange, showImage = false, showCompact = false, style }: ViewModeToggleProps<Mode>) {
  const hasThird = showImage || showCompact;
  const option = (mode: ToggleMode, label: string, glyph: ReactElement) => (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: value === mode }}
      hitSlop={hasThird ? { bottom: 4, top: 4 } : undefined}
      onPress={() => onChange(mode as Mode)}
      style={[styles.button, hasThird && styles.buttonWide, value === mode && styles.buttonSelected]}
    >
      {glyph}
    </Pressable>
  );
  return <View style={[styles.container, style]}>
    {option('list', 'List view', <ListGlyph selected={value === 'list'} />)}
    {option('grid', 'Grid view', <GridGlyph selected={value === 'grid'} />)}
    {showImage ? option('image', 'Image view', <ImageGlyph selected={value === 'image'} />) : null}
    {showCompact ? option('compact', 'Compact grid view', <ImageGlyph selected={value === 'compact'} />) : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, flexDirection: 'row', padding: 2 },
  button: { alignItems: 'center', borderRadius: radii.sm, height: 32, justifyContent: 'center', width: 32 },
  // With three options each keeps a full 44dp-wide, 44dp-tall (36 + hit slop) target.
  buttonWide: { height: 36, width: 44 },
  buttonSelected: { backgroundColor: colors.surface },
  listGlyph: { gap: 3, width: 16 },
  listLine: { backgroundColor: colors.textSecondary, borderRadius: 2, height: 2, width: 16 },
  gridGlyph: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, width: 13 },
  gridDot: { backgroundColor: colors.textSecondary, borderRadius: 1, height: 5, width: 5 },
  // 3 x 5dp blocks + 2 x 2.5dp gaps = 20dp each way.
  imageGlyph: { flexDirection: 'row', flexWrap: 'wrap', gap: 2.5, height: 20, width: 20 },
  imageDot: { backgroundColor: colors.textSecondary, borderRadius: 1, height: 5, width: 5 },
  glyphSelected: { backgroundColor: colors.brand },
});
