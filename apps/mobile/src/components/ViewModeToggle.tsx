import { Pressable, StyleSheet, View } from 'react-native';
import type { ViewMode } from '../settings/viewModePreference';
import { colors, radii, spacing } from '../theme/tokens';

interface ViewModeToggleProps {
  readonly value: ViewMode;
  readonly onChange: (value: ViewMode) => void;
}

function ListGlyph({ selected }: { readonly selected: boolean }) {
  return <View style={styles.listGlyph}>{[0, 1, 2].map(index => <View key={index} style={[styles.listLine, selected && styles.glyphSelected]} />)}</View>;
}

function GridGlyph({ selected }: { readonly selected: boolean }) {
  return <View style={styles.gridGlyph}>{[0, 1, 2, 3].map(index => <View key={index} style={[styles.gridDot, selected && styles.glyphSelected]} />)}</View>;
}

/** Compact Explorer-style presentation switch, shared by link/category screens and pickers. */
export function ViewModeToggle({ value, onChange }: ViewModeToggleProps) {
  return <View style={styles.container}>
    <Pressable accessibilityLabel="List view" accessibilityRole="button" accessibilityState={{ selected: value === 'list' }} onPress={() => onChange('list')} style={[styles.button, value === 'list' && styles.buttonSelected]}>
      <ListGlyph selected={value === 'list'} />
    </Pressable>
    <Pressable accessibilityLabel="Grid view" accessibilityRole="button" accessibilityState={{ selected: value === 'grid' }} onPress={() => onChange('grid')} style={[styles.button, value === 'grid' && styles.buttonSelected]}>
      <GridGlyph selected={value === 'grid'} />
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, flexDirection: 'row', padding: 2 },
  button: { alignItems: 'center', borderRadius: radii.sm, height: 32, justifyContent: 'center', width: 32 },
  buttonSelected: { backgroundColor: colors.surface },
  listGlyph: { gap: 3, width: 16 },
  listLine: { backgroundColor: colors.textSecondary, borderRadius: 2, height: 2, width: 16 },
  gridGlyph: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, width: 13 },
  gridDot: { backgroundColor: colors.textSecondary, borderRadius: 1, height: 5, width: 5 },
  glyphSelected: { backgroundColor: colors.brand },
});
