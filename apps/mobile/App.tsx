/**
 * Juple Mobile
 *
 * @format
 */

import { DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { AppToastProvider } from './src/components/AppToast';
import { AppUpdateGate } from './src/appUpdate/AppUpdateGate';
import { useCollectionShortcutBootstrapSync } from './src/categories/useCollectionShortcutBootstrapSync';
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
import { applyNativeAppearance, loadThemePreference, ThemeProvider, useTheme, type ThemePreference } from './src/theme/ThemeContext';
import { colors, themedStyles } from './src/theme/tokens';

function App() {
  // i18n/index.ts's synchronous init already resolves the device locale, so the very first frame
  // is never untranslated - this only waits on the persisted ko/en override (if any) before
  // AppNavigation/RootStack mount, so an already-rendered screen never jumps language mid-frame.
  const [isLanguageReady, setIsLanguageReady] = useState(false);
  // The device's saved appearance is read together with the language, BEFORE the first real frame: a saved Dark never flashes Light.
  const [themePreference, setThemePreference] = useState<ThemePreference | null>(null);

  useEffect(() => {
    let isMounted = true;
    Promise.all([applyStoredLanguagePreference(), loadThemePreference()]).then(([, preference]) => {
      applyNativeAppearance(preference);
      if (isMounted) {
        setThemePreference(preference);
        setIsLanguageReady(true);
      }
    }, () => {
      if (isMounted) {
        setThemePreference('system');
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
    <ThemeProvider initialPreference={themePreference ?? 'system'}>
    <SafeAreaProvider>
      <ThemedStatusBar />
      {/* The selected language's direction, applied to everything below and switched in place -
          see LayoutDirectionRoot. */}
      <LayoutDirectionRoot>
        {isLanguageReady && themePreference !== null ? (
          <AuthProvider>
            <PushRegistrationSync />
            <CollectionShortcutSync />
            <AppUpdateGate />
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
    </ThemeProvider>
  );
}

/** Status bar icons contrast with the app's own background (light icons on Dark); Android's edge-to-edge window draws the app's background behind the (transparent) bars. */
function ThemedStatusBar() {
  const { isDark } = useTheme();
  return <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />;
}

/** The navigation chrome (headers, tab bar, cards, borders) in the app's palette. */
function navigationTheme(isDark: boolean): Theme {
  return {
    ...DefaultTheme,
    dark: isDark,
    colors: {
      ...DefaultTheme.colors,
      primary: colors.brand,
      background: colors.background,
      card: colors.surface,
      text: colors.textPrimary,
      border: colors.divider,
      notification: colors.danger,
    },
  };
}

/** Headless - keeps the Push registration current and handles received/tapped Push, renders nothing. */
function PushRegistrationSync(): null {
  usePushRegistrationSync();
  usePushMessageHandling();
  return null;
}

/** Headless - runs useCollectionShortcutBootstrapSync's effects only, renders nothing. */
function CollectionShortcutSync(): null {
  useCollectionShortcutBootstrapSync();
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
  // Reading the theme re-renders the navigation chrome in place; the screens follow through the navigators' theme boundary. Nothing is remounted.
  const { isDark } = useTheme();

  if (isInitializing) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <NavigationContainer direction={direction} linking={linking} ref={navigationRef} theme={navigationTheme(isDark)}>
      <RootStack />
    </NavigationContainer>
  );
}

const styles = themedStyles(() => ({
  container: {
    backgroundColor: colors.background,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
}));

export default App;
