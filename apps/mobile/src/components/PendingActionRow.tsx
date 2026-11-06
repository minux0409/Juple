import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Pressable } from './Pressable';
import { useLayoutDirection } from '../i18n/layoutDirection';
import { BellIcon } from '../icons/BellIcon';
import { ChevronIcon } from '../icons/ChevronIcon';
import { cardShadow, colors, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';

/** Leading bell: 18-20dp, in the row's blue. */
export const PENDING_ROW_ICON_SIZE = 18;

interface PendingActionRowProps {
  /** The visible one-line text, e.g. "받은 승인 요청 3" (the Owner's) or "보낸 승인 요청 3" (mine). */
  readonly label: string;
  /** What assistive technology says; the whole row is ONE button, the chevron is decorative. */
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
  /** The pending number, shown as localized "대기 n건" at the row's end. */
  readonly count?: number;
  /**
   * 'action' (default): something I must answer - the emphasized card.
   * 'status': something I am only waiting for - a quiet neutral card. Both use the same pending text.
   */
  readonly variant?: 'action' | 'status';
  /** Optional explicit text beside the chevron; otherwise derived from count. */
  readonly statusText?: string;
  readonly testID?: string;
  /** Optional outer spacing set by the caller. */
  readonly style?: StyleProp<ViewStyle>;
  readonly compact?: boolean;
}

/**
 * Sent approvals, received approvals and received invitations share one bell/label/status/chevron
 * layout. Action rows keep their emphasis; every count uses the same localized pending text.
 */
export function PendingActionRow({ label, accessibilityLabel, onPress, count = 0, variant = 'action', statusText, testID, style, compact = false }: PendingActionRowProps) {
  const { t } = useTranslation();
  const layoutDirection = useLayoutDirection();
  const isStatus = variant === 'status';
  const pendingText = statusText ?? (count > 0 ? t('collections.myPendingStatus', { count }) : null);
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, compact && styles.compact, isStatus && styles.rowStatus, pressed && styles.pressed, style]}
      testID={testID}
    >
      {/* Decorative: the label already says it all, and the whole row is the one button. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.icon} testID={testID ? `${testID}-icon` : 'pending-action-row-icon'}>
        <BellIcon color={isStatus ? colors.textSecondary : colors.brandText} size={PENDING_ROW_ICON_SIZE} />
      </View>
      <Text numberOfLines={compact ? undefined : 2} style={[styles.label, compact && styles.compactLabel, isStatus && styles.labelStatus]}>{label}</Text>
      {/* The same end-aligned status for sent approvals, received approvals and invitations. */}
      {pendingText ? <Text numberOfLines={compact ? undefined : 1} style={[styles.statusText, compact && styles.compactStatus]} testID={testID ? `${testID}-status` : undefined}>{pendingText}</Text> : null}
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
  compact: { borderColor: colors.brandSoft, elevation: 0, shadowOpacity: 0 },
  compactLabel: { fontSize: 14 },
  compactStatus: { color: colors.brandText, flexShrink: 1, minWidth: 0, textAlign: 'auto' },
  pressed: { opacity: 0.7 },
  icon: { flexShrink: 0 },
  label: { color: colors.brandText, flex: 1, fontSize: 15, fontWeight: '700', minWidth: 0 },
  labelStatus: { color: colors.textPrimary, fontWeight: '600' },
  statusText: { color: colors.textSecondary, flexShrink: 0, fontSize: 13, fontWeight: '600' },
}));
