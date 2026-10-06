import type { ComponentType } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InfoIcon } from '../icons/InfoIcon';
import { BrokenLinkIcon } from '../icons/BrokenLinkIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

/**
 * offline: the server could not be reached; loadFailed: it was reached but the load failed. Both are a LOAD FAILURE and
 * always say the same thing everywhere ("불러오지 못했어요" / "기록을 불러올 수 없습니다." / "다시 시도") - only the icon
 * tells them apart. notice: a definitive state that is not a failure to load (not found, locked, owner only, signed out)
 * with its own specific message. empty: nothing here.
 */
export type ImportantStateVariant = 'offline' | 'loadFailed' | 'notice' | 'empty';

interface ImportantStateProps {
  readonly variant?: ImportantStateVariant;
  /**
   * notice / empty only: the specific sentence. Ignored for a load failure - its text is the app-wide standard, never
   * screen-specific (no "컬렉션 목록을..." / "친구를..." variants).
   */
  readonly message?: string;
  /** notice / empty only: an optional headline. */
  readonly title?: string;
  readonly icon?: ComponentType<{ readonly color?: string; readonly size?: number }>;
  /** Shows the retry button when given ("다시 시도" - the same label everywhere). */
  readonly onRetry?: () => void;
  /** A tighter layout for nested sheets / popups. */
  readonly compact?: boolean;
  readonly testID?: string;
}

export function isLoadFailureVariant(variant: ImportantStateVariant): boolean {
  return variant === 'offline' || variant === 'loadFailed';
}

/**
 * The one presentation of a significant load failure / definitive state / empty state: a centered icon, a short
 * headline, the message and an optional retry - instead of a tiny left-aligned red line. Not for field validation (those
 * stay inline next to their field) nor for an operation's result (a message dialog). Sized by content (never
 * full-screen on its own), so it fits a nested popup as well as a whole screen.
 */
export function ImportantState({ variant = 'loadFailed', message, title, icon, onRetry, compact = false, testID }: ImportantStateProps) {
  const { t } = useTranslation();
  const isFailure = isLoadFailureVariant(variant);
  // Offline / no connection: a broken chain link - never a Wi-Fi or signal glyph. Decorative (hidden from screen readers):
  // the text below already says what happened.
  const Icon = icon ?? (variant === 'offline' ? BrokenLinkIcon : InfoIcon);
  const headline = isFailure ? t('importantState.loadFailedTitle') : title ?? null;
  const body = isFailure ? t('importantState.loadFailedMessage') : message ?? null;
  return (
    <View accessibilityLiveRegion="polite" style={[styles.container, compact && styles.containerCompact]} testID={testID ?? 'important-state'}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.iconCircle, compact && styles.iconCircleCompact]}>
        <Icon color={variant === 'empty' ? colors.textSecondary : colors.brand} size={compact ? 22 : 28} />
      </View>
      {headline ? <Text accessibilityRole="header" style={styles.title}>{headline}</Text> : null}
      {body ? <Text style={styles.message}>{body}</Text> : null}
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry} testID={testID ? `${testID}-retry` : 'important-state-retry'}>
          <Text numberOfLines={2} style={styles.retryLabel}>{t('importantState.retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', alignSelf: 'stretch', gap: spacing.sm, justifyContent: 'center', padding: spacing.xl },
  containerCompact: { gap: spacing.xs, padding: spacing.lg },
  iconCircle: { alignItems: 'center', backgroundColor: colors.brandSoft, borderRadius: 28, height: 56, justifyContent: 'center', width: 56 },
  iconCircleCompact: { borderRadius: 22, height: 44, width: 44 },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  message: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retry: {
    alignItems: 'center',
    borderColor: colors.brand,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.lg,
  },
  retryLabel: { color: colors.brand, fontSize: 15, fontWeight: '600', textAlign: 'center' },
});
