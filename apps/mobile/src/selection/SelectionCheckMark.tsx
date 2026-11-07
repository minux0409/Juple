import { View, type StyleProp, type ViewStyle } from 'react-native';
import { CheckIcon } from '../icons/CheckIcon';
import { colors, themedStyles } from '../theme/tokens';

const SIZE = 24;

interface SelectionCheckMarkProps {
  readonly selected: boolean;
  /** Placement only. The default is the top-start corner of the card. */
  readonly style?: StyleProp<ViewStyle>;
  /** Diameter; default 24. */
  readonly size?: number;
  readonly testID?: string;
}

/**
 * The gallery-style mark drawn on a card while selecting: a filled brand circle with a white check when chosen, an empty ring on a
 * soft backing otherwise (so an unchosen card is plainly selectable, on a photo as well as on a flat card). Decoration only - the
 * pressable around it carries the checkbox role and state. It sits in the card's corner and never covers the card's text.
 */
export function SelectionCheckMark({ selected, style, size = SIZE, testID }: SelectionCheckMarkProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.base, { borderRadius: size / 2, height: size, width: size }, selected ? styles.selected : styles.unselected, style]}
      testID={testID}
    >
      {selected ? <CheckIcon color={colors.surface} size={Math.round(size * 0.58)} strokeWidth={3} /> : null}
    </View>
  );
}

/** The frame a chosen card gets (placed on the card's own container so the mark and the outline agree). */
export const selectedCardFrame = themedStyles(() => ({
  frame: { borderColor: colors.brand, borderWidth: 2 },
}));

const styles = themedStyles(() => ({
  base: { alignItems: 'center', borderRadius: SIZE / 2, height: SIZE, justifyContent: 'center', position: 'absolute', start: 8, top: 8, width: SIZE, zIndex: 3 },
  selected: { backgroundColor: colors.brand, borderColor: colors.surface, borderWidth: 2 },
  unselected: { backgroundColor: 'rgba(0,0,0,0.25)', borderColor: '#FFFFFF', borderWidth: 2 },
}));
