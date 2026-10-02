/**
 * Juple Mobile
 *
 * @format
 */

import { NavigationContainer } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { AppToastProvider } from './src/components/AppToast';
import { useCategorySnapshotBootstrapSync } from './src/categories/useCategorySnapshotBootstrapSync';
// Runs i18next.init() at module load, before RootStack ever renders, so there is no untranslated
// first frame - see src/i18n/index.ts.
import './src/i18n';
import { applyStoredLanguagePreference } from './src/i18n/languagePreference';
import { LayoutDirectionRoot, useLayoutDirection } from './src/i18n/layoutDirection';
import { linking } from './src/navigation/linking';
import { navigationRef } from './src/navigation/navigationRef';
import { NotificationBannerHost } from './src/notifications/NotificationBannerHost';
import { RootStack } from './src/navigation/RootStack';
import { usePushMessageHandling } from './src/push/usePushMessageHandling';
import { usePushRegistrationSync } from './src/push/usePushRegistrationSync';
import { applyStoredQuickSaveOnSharePreference } from './src/settings/quickSaveOnSharePreference';

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  // i18n/index.ts's synchronous init already resolves the device locale, so the very first frame
  // is never untranslated - this only waits on the persisted ko/en override (if any) before
  // AppNavigation/RootStack mount, so an already-rendered screen never jumps language mid-frame.
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

  // Re-syncs the quick-save-on-share preference to native SharedPreferences on every launch -
  // not gated on isLanguageReady since it doesn't affect anything screens render.
  useEffect(() => {
    applyStoredQuickSaveOnSharePreference();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      {/* The selected language's direction, applied to everything below and switched in place -
          see LayoutDirectionRoot. */}
      <LayoutDirectionRoot>
        {isLanguageReady ? (
          <AuthProvider>
            <PushRegistrationSync />
            <CategorySnapshotSync />
            <AppToastProvider>
              <AppNavigation />
              {/* Above the navigator: the in-app banner for a Push received in the foreground. */}
              <NotificationBannerHost />
            </AppToastProvider>
          </AuthProvider>
        ) : (
          <View style={styles.container}>
            <ActivityIndicator />
          </View>
        )}
      </LayoutDirectionRoot>
    </SafeAreaProvider>
  );
}

/** Headless - keeps the Push registration current and handles received/tapped Push, renders nothing. */
function PushRegistrationSync(): null {
  usePushRegistrationSync();
  usePushMessageHandling();
  return null;
}

/** Headless - runs useCategorySnapshotBootstrapSync's effects only, renders nothing. */
function CategorySnapshotSync(): null {
  useCategorySnapshotBootstrapSync();
  return null;
}

/**
 * NavigationContainer (and its `linking` prop) always mounts once the initial session check
 * settles - never gated behind isAuthenticated. A Collection Sharing deep link must reach
 * SharedCollectionScreen for a signed-out user too (see navigation/RootStack.tsx's own
 * isAuthenticated branching, which decides only which OTHER screens exist alongside it), and
 * React Navigation only resolves a deep link's initial URL once NavigationContainer exists.
 */
function AppNavigation() {
  const { isInitializing } = useAuth();
  // Headers, back buttons and gestures follow the app language too, not the native RTL flag.
  const direction = useLayoutDirection();

  if (isInitializing) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <NavigationContainer direction={direction} ref={navigationRef} linking={linking}>
      <RootStack />
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
});

export default App;
