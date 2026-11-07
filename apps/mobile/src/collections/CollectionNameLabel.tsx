import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { LockIcon } from '../icons/LockIcon';
import { colors, spacing, themedStyles } from '../theme/tokens';

/**
 * The small padlock shown right before the name of a locked Collection (instead of a badge on its picture). It never shrinks, so a long
 * name is ellipsized before the padlock goes; it is decoration for sighted users - the card's accessibility label says "locked".
 */
export function CollectionLockMark({ size = 12 }: { readonly size?: number }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.lock} testID="collection-name-lock">
      <LockIcon color={colors.textSecondary} size={size} strokeWidth={2} />
    </View>
  );
}

interface CollectionNameLabelProps {
  readonly name: string;
  readonly textStyle: StyleProp<TextStyle>;
  /** Outer row style (alignment / max width / margins). */
  readonly style?: StyleProp<ViewStyle>;
  /** A locked Collection: a small padlock at the very start of the name's line. */
  readonly isLocked?: boolean;
  /** Padlock size; match it to the name's font size. */
  readonly lockSize?: number;
}

/**
 * A Collection's name as the browsing screens show it: the name alone, on one ellipsized line, with a small padlock before it when the
 * Collection is locked. Ownership is never marked beside a name -
 * the Owner (방장) of a SHARED Collection is marked by the crown on their avatar (see OwnerCrown), and a personal Collection has none.
 */
export function CollectionNameLabel({ name, textStyle, style, isLocked = false, lockSize }: CollectionNameLabelProps) {
  return (
    <View style={[styles.row, style]}>
      {isLocked ? <CollectionLockMark size={lockSize} /> : null}
      <Text numberOfLines={1} style={[textStyle, styles.name]}>{name}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, minWidth: 0 },
  name: { flexShrink: 1 },
  lock: { flexShrink: 0 },
}));
