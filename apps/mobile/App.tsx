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
import { DailyInboxScreen } from './src/screens/DailyInboxScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import type { BackendAuthStatus, UserBootstrapStatus } from './src/auth/types';

const backendAuthMessages: Record<BackendAuthStatus, string | null> = {
  notChecked: null,
  checking: '서버 인증 확인 중...',
  valid: 'Juple API 인증도 정상적으로 완료되었습니다.',
  unauthorized: '서버에서 인증을 확인하지 못했습니다.',
  forbidden: '서버 접근 권한을 확인하지 못했습니다.',
  unavailable: '서버에 연결할 수 없습니다.',
};

const userBootstrapMessages: Record<UserBootstrapStatus, string | null> = {
  notStarted: null,
  checking: 'Juple 계정을 준비하고 있습니다...',
  ready: 'Juple 계정 준비도 완료되었습니다.',
  invalidDeviceSettings: '기기 지역 설정을 확인할 수 없습니다.',
  unavailable: 'Juple 계정을 준비할 수 없습니다.',
};

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
  const {
    isInitializing,
    isAuthenticated,
    backendAuthStatus,
    userBootstrapStatus,
  } = useAuth();

  if (isInitializing) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  if (
    isAuthenticated &&
    backendAuthStatus === 'valid' &&
    userBootstrapStatus === 'ready'
  ) {
    return <DailyInboxScreen />;
  }

  if (isAuthenticated) {
    return <AuthenticatedPlaceholder />;
  }

  return <SignInScreen />;
}

/** Verifies the auth round trip only; replaced by the real App Shell/Home later. */
function AuthenticatedPlaceholder() {
  const { signOut, backendAuthStatus, userBootstrapStatus } = useAuth();
  const backendAuthMessage = backendAuthMessages[backendAuthStatus];
  const userBootstrapMessage = userBootstrapMessages[userBootstrapStatus];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Juple</Text>
      <Text style={styles.message}>로그인되었습니다.</Text>
      <Text style={styles.subMessage}>
        인증 연결이 정상적으로 완료되었습니다.
      </Text>
      {backendAuthMessage ? (
        <Text style={styles.backendAuthMessage}>{backendAuthMessage}</Text>
      ) : null}
      {userBootstrapMessage ? (
        <Text style={styles.userBootstrapMessage}>{userBootstrapMessage}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={signOut}
        style={styles.signOutButton}>
        <Text style={styles.signOutLabel}>로그아웃</Text>
      </Pressable>
    </View>
  );
        style={styles.signOutButton}>
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
  backendAuthMessage: {
    marginTop: 8,
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
  },
  userBootstrapMessage: {
    marginTop: 8,
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
