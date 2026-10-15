import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import { JupleBrandMark } from '../components/JupleBrandMark';

/** The Terms status could not be read. Never a way past the Agreement: the person retries or signs out. */
export function TermsUnavailable({ onRetry, onSignOut }: { readonly onRetry: () => void; readonly onSignOut: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.container} testID="terms-unavailable">
      <JupleBrandMark size="medium" style={styles.brand} />
      <Text style={styles.message}>{t('agreement.loadFailed')}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry} testID="terms-unavailable-retry">
        <Text style={styles.retryLabel}>{t('auth.retry')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onSignOut} style={styles.signOut} testID="terms-unavailable-signout">
        <Text style={styles.signOutLabel}>{t('auth.logout')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', backgroundColor: colors.surface, flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
  brand: { marginBottom: spacing.xl },
  message: { color: colors.textPrimary, fontSize: 16, textAlign: 'center' },
  retry: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radii.xl, justifyContent: 'center', marginTop: spacing.xl, minHeight: minTouchTarget, paddingHorizontal: spacing.xl },
  retryLabel: { color: colors.surface, fontSize: 16, fontWeight: '700' },
  signOut: { alignItems: 'center', justifyContent: 'center', marginTop: spacing.md, minHeight: minTouchTarget, paddingHorizontal: spacing.xl },
  signOutLabel: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
});
