/**
 * Juple Mobile
 *
 * @format
 */

import { NavigationContainer } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
// Runs i18next.init() at module load, before AuthGate/RootStack ever render, so there is no
// untranslated first frame - see src/i18n/index.ts.
import './src/i18n';
import { applyStoredLanguagePreference } from './src/i18n/languagePreference';
import { RootStack } from './src/navigation/RootStack';
import { SignInScreen } from './src/screens/SignInScreen';
import type { BackendAuthStatus, UserBootstrapStatus } from './src/auth/types';

const backendAuthMessageKeys: Record<BackendAuthStatus, string | null> = {
  notChecked: null,
  checking: 'auth.backendChecking',
  valid: 'auth.backendValid',
  unauthorized: 'auth.backendUnauthorized',
  forbidden: 'auth.backendForbidden',
  unavailable: 'auth.backendUnavailable',
};

const userBootstrapMessageKeys: Record<UserBootstrapStatus, string | null> = {
  notStarted: null,
  checking: 'auth.bootstrapChecking',
  ready: 'auth.bootstrapReady',
  invalidDeviceSettings: 'auth.bootstrapInvalidDeviceSettings',
  unavailable: 'auth.bootstrapUnavailable',
};

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  // i18n/index.ts's synchronous init already resolves the device locale, so the very first frame
  // is never untranslated - this only waits on the persisted ko/en override (if any) before
  // AuthGate/RootStack mount, so an already-rendered screen never jumps language mid-frame.
  const [isLanguageReady, setIsLanguageReady] = useState(false);

  useEffect(() => {
    let isMounted = true;
    applyStoredLanguagePreference().finally(() => {
      if (isMounted) {
        setIsLanguageReady(true);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      {isLanguageReady ? (
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      ) : (
        <View style={styles.container}>
          <ActivityIndicator />
        </View>
      )}
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
    return (
      <NavigationContainer>
        <RootStack />
      </NavigationContainer>
    );
  }

  if (isAuthenticated) {
    return <AuthenticatedPlaceholder />;
  }

  return <SignInScreen />;
}

/** Verifies the auth round trip only; replaced by the real App Shell/Home later. */
function AuthenticatedPlaceholder() {
  const { t } = useTranslation();
  const { signOut, backendAuthStatus, userBootstrapStatus } = useAuth();
  const backendAuthMessageKey = backendAuthMessageKeys[backendAuthStatus];
  const userBootstrapMessageKey = userBootstrapMessageKeys[userBootstrapStatus];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Juple</Text>
      <Text style={styles.message}>{t('auth.loggedIn')}</Text>
      <Text style={styles.subMessage}>{t('auth.authConnected')}</Text>
      {backendAuthMessageKey ? (
        <Text style={styles.backendAuthMessage}>{t(backendAuthMessageKey)}</Text>
      ) : null}
      {userBootstrapMessageKey ? (
        <Text style={styles.userBootstrapMessage}>{t(userBootstrapMessageKey)}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={signOut}
        style={styles.signOutButton}
      >
        <Text style={styles.signOutLabel}>{t('auth.logout')}</Text>
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
