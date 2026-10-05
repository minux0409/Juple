import type { ComponentType } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InfoIcon } from '../icons/InfoIcon';
import { WifiOffIcon } from '../icons/WifiOffIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

export type ImportantStateVariant = 'offline' | 'loadFailed' | 'empty';

interface ImportantStateProps {
  /** offline: cannot reach the server; loadFailed: reached it but the load failed; empty: nothing here (no retry by default). */
  readonly variant?: ImportantStateVariant;
  /** What could not be loaded, as a full sentence ("컬렉션 목록을 불러오지 못했어요."). */
  readonly message: string;
  /** Overrides the variant's headline. */
  readonly title?: string;
  readonly icon?: ComponentType<{ readonly color?: string; readonly size?: number }>;
  /** Shows the retry button when given. */
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
  /** A tighter layout for nested sheets / popups. */
  readonly compact?: boolean;
  readonly testID?: string;
}

/**
 * The one presentation of a significant load failure / offline / empty state: a centered icon, a short
 * headline, the message and an optional retry - instead of a tiny left-aligned red line. Not for field
 * validation (those stay inline next to their field). Sized by content (never full-screen on its own),
 * so it fits a nested popup as well as a whole screen.
 */
export function ImportantState({ variant = 'loadFailed', message, title, icon, onRetry, retryLabel, compact = false, testID }: ImportantStateProps) {
  const { t } = useTranslation();
  const Icon = icon ?? (variant === 'offline' ? WifiOffIcon : InfoIcon);
  const headline = title ?? (variant === 'offline' ? t('importantState.offlineTitle') : variant === 'loadFailed' ? t('importantState.loadFailedTitle') : null);
  return (
    <View accessibilityLiveRegion="polite" style={[styles.container, compact && styles.containerCompact]} testID={testID ?? 'important-state'}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.iconCircle, compact && styles.iconCircleCompact]}>
        <Icon color={variant === 'empty' ? colors.textSecondary : colors.brand} size={compact ? 22 : 28} />
      </View>
      {headline ? <Text accessibilityRole="header" style={styles.title}>{headline}</Text> : null}
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry} testID={testID ? `${testID}-retry` : 'important-state-retry'}>
          <Text numberOfLines={2} style={styles.retryLabel}>{retryLabel ?? t('importantState.retry')}</Text>
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
