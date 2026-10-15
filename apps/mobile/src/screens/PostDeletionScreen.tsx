import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

/** Shown after deletion and on restart until a fresh authorization completes. */
export function PostDeletionScreen() {
  const { t } = useTranslation();
  const { freshSignIn, freshSignUp, isSigningIn, error } = useAuth();

  return (
    <View style={styles.container} testID="post-deletion-screen">
      <Text style={styles.title}>{t('postDeletion.title')}</Text>
      <Text style={styles.body}>{t('postDeletion.message')}</Text>
      <Pressable accessibilityRole="button" disabled={isSigningIn} onPress={freshSignUp} style={styles.primary} testID="post-deletion-sign-up">
        {isSigningIn ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.primaryLabel}>{t('postDeletion.signUp')}</Text>}
      </Pressable>
      <Pressable accessibilityRole="button" disabled={isSigningIn} onPress={freshSignIn} style={styles.secondary} testID="post-deletion-sign-in">
        <Text style={styles.secondaryLabel}>{t('postDeletion.signIn')}</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: spacing.xl },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  body: { color: colors.textSecondary, fontSize: 16, lineHeight: 24, marginTop: spacing.md, textAlign: 'center' },
  primary: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radii.xl, justifyContent: 'center', marginTop: spacing.xl, minHeight: minTouchTarget + 4, width: '100%' },
  primaryLabel: { color: colors.surface, fontSize: 16, fontWeight: '700' },
  secondary: { alignItems: 'center', borderColor: colors.brand, borderRadius: radii.xl, borderWidth: 1, justifyContent: 'center', marginTop: spacing.md, minHeight: minTouchTarget + 4, width: '100%' },
  secondaryLabel: { color: colors.brand, fontSize: 16, fontWeight: '700' },
  error: { color: colors.danger, marginTop: spacing.md, textAlign: 'center' },
});
