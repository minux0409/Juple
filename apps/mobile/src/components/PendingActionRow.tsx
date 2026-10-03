import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useLayoutDirection } from '../i18n/layoutDirection';
import { BellIcon } from '../icons/BellIcon';
import { ChevronIcon } from '../icons/ChevronIcon';
import { cardShadow, colors, minTouchTarget, radii, spacing } from '../theme/tokens';

/** Leading bell: 18-20dp, in the row's blue. */
export const PENDING_ROW_ICON_SIZE = 18;

interface PendingActionRowProps {
  /** The visible one-line text, e.g. "받은 승인 요청 3" (the Owner's) or "보낸 승인 요청 3" (mine). */
  readonly label: string;
  /** What assistive technology says; the whole row is ONE button, the chevron is decorative. */
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
  readonly testID?: string;
  /** Outer spacing only - each screen decides its own gap above / below; the look itself never differs. */
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * The one pending status/action row (leading bell): light-blue background, blue border and text, a compact one-line height and a
 * chevron toward the reading direction's end. The Owner's `받은 승인 요청 N` (Collection details) and the requester's
 * `보낸 승인 요청 N` (Collections screen and Collection details) are this same component - only the text and the
 * handler differ - so the two can never drift apart again.
 */
export function PendingActionRow({ label, accessibilityLabel, onPress, testID, style }: PendingActionRowProps) {
  const layoutDirection = useLayoutDirection();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, style]}
      testID={testID}
    >
      {/* Decorative: the label already says it all, and the whole row is the one button. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.icon} testID={testID ? `${testID}-icon` : 'pending-action-row-icon'}>
        <BellIcon color={colors.brand} size={PENDING_ROW_ICON_SIZE} />
      </View>
      <Text numberOfLines={2} style={styles.label}>{label}</Text>
      {/* Points toward the reading direction's end (mirrored under RTL). */}
      <ChevronIcon color={colors.brand} direction={layoutDirection === 'rtl' ? 'left' : 'right'} size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    backgroundColor: colors.brandSoft,
    borderColor: colors.brand,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...cardShadow,
  },
  pressed: { opacity: 0.7 },
  icon: { flexShrink: 0 },
  label: { color: colors.brand, flex: 1, fontSize: 15, fontWeight: '700', minWidth: 0 },
});
