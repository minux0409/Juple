import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { CheckIcon } from '../icons/CheckIcon';
import { colors } from '../theme/tokens';

const SIZE = 18;

interface SelectionIndicatorProps {
  readonly selected: boolean;
  /** Placement only (e.g. a tile's corner) - never the look. */
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

/**
 * The one "selected" mark in Juple's pickers: a small brand-filled circle with a white check (the Collection chooser's
 * badge). Unselected it is an empty ring of the same size, so a row's content never shifts when it is chosen. Purely
 * visual - the owning control carries the accessibility role and state.
 */
export function SelectionIndicator({ selected, style, testID }: SelectionIndicatorProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.base, selected ? styles.selected : styles.unselected, style]}
      testID={testID}
    >
      {selected ? <CheckIcon color={colors.surface} size={11} strokeWidth={3} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', borderRadius: SIZE / 2, height: SIZE, justifyContent: 'center', width: SIZE },
  selected: { backgroundColor: colors.brand, borderColor: colors.surface, borderWidth: 2 },
  unselected: { borderColor: colors.border, borderWidth: 2 },
});
