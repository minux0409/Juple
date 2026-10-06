import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { InfoIcon } from '../icons/InfoIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

/**
 * A refresh (or "load more") failed while what was already loaded is still on screen: a compact, non-blocking status
 * row - "불러오지 못했어요 [다시 시도]" - under/over the content, which stays usable. Never a red line and never a
 * replacement for the content (that is LoadFailureState, for a load that has nothing to show yet).
 */
export function RefreshFailureNotice({ onRetry, testID }: { readonly onRetry?: () => void; readonly testID?: string }) {
  const { t } = useTranslation();
  return (
    <View accessibilityLiveRegion="polite" style={styles.row} testID={testID ?? 'refresh-failure-notice'}>
      <InfoIcon color={colors.textSecondary} size={16} />
      <Text numberOfLines={2} style={styles.text}>{t('importantState.loadFailedTitle')}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry} testID={`${testID ?? 'refresh-failure-notice'}-retry`}>
          <Text numberOfLines={1} style={styles.retryLabel}>{t('importantState.retry')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.sm,
    marginVertical: spacing.xs,
    paddingStart: spacing.md,
  },
  text: { color: colors.textSecondary, flex: 1, fontSize: 13, minWidth: 0, paddingVertical: spacing.sm },
  retry: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  retryLabel: { color: colors.brand, fontSize: 14, fontWeight: '600' },
});
