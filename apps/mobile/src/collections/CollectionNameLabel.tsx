import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { spacing, themedStyles } from '../theme/tokens';

interface CollectionNameLabelProps {
  readonly name: string;
  readonly textStyle: StyleProp<TextStyle>;
  /** Outer row style (alignment / max width / margins). */
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * A Collection's name as the browsing screens show it: the name alone, on one ellipsized line. Ownership is never marked beside a name -
 * the Owner (방장) of a SHARED Collection is marked by the crown on their avatar (see OwnerCrown), and a personal Collection has none.
 */
export function CollectionNameLabel({ name, textStyle, style }: CollectionNameLabelProps) {
  return (
    <View style={[styles.row, style]}>
      <Text numberOfLines={1} style={[textStyle, styles.name]}>{name}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, minWidth: 0 },
  name: { flexShrink: 1 },
}));
