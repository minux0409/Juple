import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';

export function SignInScreen() {
  const { signIn, isSigningIn, error } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Juple</Text>
      <Text style={styles.tagline}>
        발견한 것들을 모아두고,{'\n'}나중에 다시 꺼내보세요.
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={isSigningIn}
        onPress={signIn}
        style={[styles.button, isSigningIn && styles.buttonDisabled]}
      >
        <Text style={styles.buttonLabel}>
          {isSigningIn ? '로그인 중...' : '로그인 / 회원가입'}
        </Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
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
});
