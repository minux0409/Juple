import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CloseIcon } from '../icons/CloseIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

/**
 * A non-blocking, dismissible one-line hint that sits inside a list's header (never a modal, never over content).
 * The text is announced as a plain label; the close control is a 44dp button.
 */
export function HintBanner({ message, onDismiss, testID }: { readonly message: string; readonly onDismiss: () => void; readonly testID: string }) {
  const { t } = useTranslation();
  return (
    <View accessibilityLiveRegion="polite" style={styles.banner} testID={testID}>
      <Text style={styles.message}>{message}</Text>
      <Pressable accessibilityLabel={t('common.close')} accessibilityRole="button" hitSlop={4} onPress={onDismiss} style={styles.close} testID={`${testID}-dismiss`}>
        <CloseIcon color={colors.textSecondary} size={18} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radii.md, columnGap: spacing.sm, flexDirection: 'row', marginBottom: spacing.sm, paddingStart: spacing.md },
  message: { color: colors.textPrimary, flex: 1, flexShrink: 1, fontSize: 14, lineHeight: 20, paddingVertical: spacing.sm },
  close: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, minWidth: minTouchTarget },
});
