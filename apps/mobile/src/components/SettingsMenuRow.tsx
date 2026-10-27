import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Pressable } from './Pressable';
import { colors, minTouchTarget, spacing, themedStyles } from '../theme/tokens';

/** The existing My Page single-line menu geometry, shared by ordinary menu entries. */
export function SettingsMenuRow({
  icon,
  title,
  onPress,
  testID,
  badge,
  accessibilityLabel,
}: {
  icon: ReactNode;
  title: string;
  onPress: () => void;
  testID?: string;
  badge?: ReactNode;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      testID={testID}
      style={styles.row}
    >
      <View style={styles.icon}>{icon}</View>
      <Text style={styles.label}>{title}</Text>
      {badge}
    </Pressable>
  );
}
const styles = themedStyles(() => ({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
    marginEnd: spacing.sm + 2,
    width: 22,
  },
  label: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
  },
}));
