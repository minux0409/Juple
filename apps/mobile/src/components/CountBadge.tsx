import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../theme/tokens';
import { formatBadgeCount } from './badgeCount';

/**
 * A small high-contrast count pill (1-99, then "99+") - the bell's unread total and a Collection
 * card's attention count. Never a button and never announced by itself: the control it sits on
 * carries the full count in its own accessibility label. Renders nothing for 0.
 */
export function CountBadge({ count, style, testID }: { readonly count: number; readonly style?: StyleProp<ViewStyle>; readonly testID?: string }) {
  if (count <= 0) {
    return null;
  }
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.badge, style]}
      testID={testID}
    >
      <Text allowFontScaling={false} numberOfLines={1} style={styles.text}>{formatBadgeCount(count)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1.5,
    height: 20,
    justifyContent: 'center',
    minWidth: 20,
    paddingHorizontal: 5,
  },
  text: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
});
