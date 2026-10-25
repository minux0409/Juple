import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useLayoutDirection } from '../i18n/layoutDirection';
import { BellIcon } from '../icons/BellIcon';
import { ChevronIcon } from '../icons/ChevronIcon';
import { CountBadge } from './CountBadge';
import { cardShadow, colors, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';

/** Leading bell: 18-20dp, in the row's blue. */
export const PENDING_ROW_ICON_SIZE = 18;

interface PendingActionRowProps {
  /** The visible one-line text, e.g. "받은 승인 요청 3" (the Owner's) or "보낸 승인 요청 3" (mine). */
  readonly label: string;
  /** What assistive technology says; the whole row is ONE button, the chevron is decorative. */
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
  /** The pending number, always a red count badge at the row's end (never a number inside `label`). */
  readonly count?: number;
  /**
   * 'action' (default): something I must answer - the light-blue emphasized card with a red count badge.
   * 'status': something I am only waiting for (my own sent requests) - a quiet neutral card, no badge, `statusText` at its end.
   */
  readonly variant?: 'action' | 'status';
  /** With variant 'status': the neutral text beside the chevron, e.g. "대기 2건". */
  readonly statusText?: string;
  readonly testID?: string;
  /** Outer spacing only - each screen decides its own gap above / below; the look itself never differs. */
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * The one pending status/action row (sent approvals, received approvals and received invitations) (leading bell): light-blue background, blue border and text, a compact one-line height and a
 * chevron toward the reading direction's end. The Owner's `받은 승인 요청 N` (Collection details) and the requester's
 * `보낸 승인 요청 N` (Collections screen and Collection details) are this same component - only the text and the
 * handler differ - so the two can never drift apart again.
 */
export function PendingActionRow({ label, accessibilityLabel, onPress, count = 0, variant = 'action', statusText, testID, style }: PendingActionRowProps) {
  const layoutDirection = useLayoutDirection();
  const isStatus = variant === 'status';
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, isStatus && styles.rowStatus, pressed && styles.pressed, style]}
      testID={testID}
    >
      {/* Decorative: the label already says it all, and the whole row is the one button. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.icon} testID={testID ? `${testID}-icon` : 'pending-action-row-icon'}>
        <BellIcon color={isStatus ? colors.textSecondary : colors.brandText} size={PENDING_ROW_ICON_SIZE} />
      </View>
      <Text numberOfLines={2} style={[styles.label, isStatus && styles.labelStatus]}>{label}</Text>
      {/* Badge, then the chevron: one end-aligned group, so the two never overlap. */}
      {isStatus ? (
        statusText ? <Text numberOfLines={1} style={styles.statusText} testID={testID ? `${testID}-status` : undefined}>{statusText}</Text> : null
      ) : (
        <CountBadge count={count} testID={testID ? `${testID}-badge` : undefined} />
      )}
      {/* Points toward the reading direction's end (mirrored under RTL). */}
      <ChevronIcon color={isStatus ? colors.textSecondary : colors.brandText} direction={layoutDirection === 'rtl' ? 'left' : 'right'} size={16} />
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  row: {
    alignItems: 'center',
    backgroundColor: colors.brandSoft,
    borderColor: colors.brandText,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...cardShadow,
  },
  // A status row (what I only wait for): the same height, rounding and spacing, but neutral and quiet next to an action row.
  rowStatus: { backgroundColor: colors.surface, borderColor: colors.inputBorder },
  pressed: { opacity: 0.7 },
  icon: { flexShrink: 0 },
  label: { color: colors.brandText, flex: 1, fontSize: 15, fontWeight: '700', minWidth: 0 },
  labelStatus: { color: colors.textPrimary, fontWeight: '600' },
  statusText: { color: colors.textSecondary, flexShrink: 0, fontSize: 13, fontWeight: '600' },
}));
