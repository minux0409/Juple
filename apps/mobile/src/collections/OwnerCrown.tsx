import { View } from 'react-native';
import { CrownIcon } from '../icons/CrownIcon';
import { colors } from '../theme/tokens';

/**
 * The Owner marker next to a name: a vector crown (never an emoji, whose glyph differs per platform),
 * decorative only - the role line under the name already says 소유자 to assistive technology.
 */
export function OwnerCrown() {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="participant-owner-crown">
      <CrownIcon color={colors.warning} size={16} strokeWidth={2} />
    </View>
  );
}
