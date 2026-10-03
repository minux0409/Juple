import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { CrownIcon } from '../icons/CrownIcon';
import { colors, spacing } from '../theme/tokens';

interface CollectionNameLabelProps {
  readonly name: string;
  /** The current user owns this Collection (accessRole 'owner') - a crown goes before the name. Never inferred from sharing, favorites or roles. */
  readonly isOwner: boolean;
  readonly textStyle: StyleProp<TextStyle>;
  /** Outer row style (alignment / max width / margins) - the crown never changes the row's height. */
  readonly style?: StyleProp<ViewStyle>;
  readonly crownSize?: number;
  readonly testID?: string;
}

/**
 * A Collection's name as the browsing screens show it: `[crown] Name` for one I own, plain `Name` otherwise. The crown is a
 * vector glyph (never an emoji), keeps its place on the same line (the name shrinks and ellipsizes, never the crown) and is
 * decorative only - hidden from assistive technology (the card's own label says it is mine).
 */
export function CollectionNameLabel({ name, isOwner, textStyle, style, crownSize = 14, testID }: CollectionNameLabelProps) {
  return (
    <View style={[styles.row, style]}>
      {isOwner ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.crown} testID={testID}>
          <CrownIcon color={colors.warning} size={crownSize} strokeWidth={2} />
        </View>
      ) : null}
      <Text numberOfLines={1} style={[textStyle, styles.name]}>{name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, minWidth: 0 },
  crown: { flexShrink: 0 },
  name: { flexShrink: 1 },
});
