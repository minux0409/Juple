import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { JupleBrandMark } from '../components/JupleBrandMark';
import { colors, themedStyles } from '../theme/tokens';

export function SignInScreen() {
  const { t } = useTranslation();
  const { signIn, isSigningIn, error } = useAuth();

  return (
    <View style={styles.container}>
      <JupleBrandMark size="large" style={styles.brand} />
      <Text style={styles.tagline}>
        {t('auth.taglineLine1')}
        {'\n'}
        {t('auth.taglineLine2')}
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={isSigningIn}
        onPress={signIn}
        style={[styles.button, isSigningIn && styles.buttonDisabled]}
      >
        <Text style={styles.buttonLabel}>
          {isSigningIn ? t('auth.signingIn') : t('auth.signIn')}
        </Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  brand: {
    marginBottom: 16,
  },
  tagline: {
    fontSize: 15,
    textAlign: 'center',
    color: colors.textSecondary,
    marginBottom: 32,
  },
  button: {
    backgroundColor: colors.textPrimary,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonLabel: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    marginTop: 16,
    color: colors.dangerText,
    fontSize: 13,
    textAlign: 'center',
  },
}));
