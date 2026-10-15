import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { NativeAuthSpikeScreen, nativeAuthSpikeAvailable } from '../auth/NativeAuthSpikeScreen';
import { ltrTextStyle } from '../theme/tokens';

export function SignInScreen() {
  const { t } = useTranslation();
  const { signIn, freshSignIn, forceFreshAuthenticationAfterDeletion, isSigningIn, error } = useAuth();
  const [showNativeSpike, setShowNativeSpike] = useState(false);

  if (showNativeSpike) {
    return <NativeAuthSpikeScreen onClose={() => setShowNativeSpike(false)} />;
  }

  return (
    <View style={styles.container}>
      {/* The Juple brand name is never translated or mirrored - see theme/tokens.ts's ltrTextStyle. */}
      <Text style={[styles.title, ltrTextStyle]}>Juple</Text>
      <Text style={styles.tagline}>
        {t('auth.taglineLine1')}
        {'\n'}
        {t('auth.taglineLine2')}
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={isSigningIn}
        onPress={forceFreshAuthenticationAfterDeletion ? freshSignIn : signIn}
        style={[styles.button, isSigningIn && styles.buttonDisabled]}
      >
        <Text style={styles.buttonLabel}>
          {isSigningIn ? t('auth.signingIn') : t('auth.signIn')}
        </Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {nativeAuthSpikeAvailable ? (
        <Pressable accessibilityRole="button" onPress={() => setShowNativeSpike(true)} style={styles.devEntry} testID="native-auth-spike-entry">
          <Text>Native Auth DEV spike</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 12,
  },
  tagline: {
    fontSize: 15,
    textAlign: 'center',
    color: '#666666',
    marginBottom: 32,
  },
  button: {
    backgroundColor: '#111111',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    marginTop: 16,
    color: '#C0392B',
    fontSize: 13,
    textAlign: 'center',
  },
  devEntry: { marginTop: 32, padding: 12 },
});
