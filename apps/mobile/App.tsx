/**
 * Juple Mobile
 *
 * @format
 */

import {
  ActivityIndicator,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { SignInScreen } from './src/screens/SignInScreen';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

/** Renders the screen matching the current authentication state. */
function AuthGate() {
  const { isInitializing, isAuthenticated } = useAuth();

  if (isInitializing) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  if (isAuthenticated) {
    return <AuthenticatedPlaceholder />;
  }

  return <SignInScreen />;
}

/** Verifies the auth round trip only; replaced by the real App Shell/Home later. */
function AuthenticatedPlaceholder() {
  const { signOut } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Juple</Text>
      <Text style={styles.message}>로그인되었습니다.</Text>
      <Text style={styles.subMessage}>
        인증 연결이 정상적으로 완료되었습니다.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={signOut}
        style={styles.signOutButton}>
        <Text style={styles.signOutLabel}>로그아웃</Text>
      </Pressable>
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
  message: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 6,
  },
  subMessage: {
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
  },
  signOutButton: {
    marginTop: 24,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderColor: '#111111',
  },
  signOutLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111111',
  },
});

export default App;
