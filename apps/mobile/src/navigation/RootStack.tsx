import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import type { BackendAuthStatus, UserBootstrapStatus } from '../auth/types';
import { CollectionDetailsScreen } from '../screens/CollectionDetailsScreen';
import { ItemDetailsScreen } from '../screens/ItemDetailsScreen';
import { LanguageSettingsScreen } from '../screens/LanguageSettingsScreen';
import { RecentlyOpenedLinksScreen } from '../screens/RecentlyOpenedLinksScreen';
import { SharedCollectionScreen } from '../screens/SharedCollectionScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { MainTabs } from './MainTabs';

export type RootStackParamList = {
  MainTabs: undefined;
  ItemDetails: { itemId: number };
  /** collectionId only - the screen fetches the current Collection and its Item list itself via GET. */
  CollectionDetails: { collectionId: number };
  LanguageSettings: undefined;
  /** My Page → "최근 본 링크" - the screen fetches the current page itself via GET. */
  RecentlyOpenedLinks: undefined;
  /** Rendered instead of MainTabs while signed in but not yet backend-valid/bootstrapped - see this file's isReady branching. */
  AuthPending: undefined;
  /** Rendered instead of MainTabs while signed out - see this file's isReady branching. */
  SignIn: undefined;
  /**
   * Reachable regardless of authentication state (see this file's isReady branching below and
   * App.tsx, which mounts NavigationContainer/linking unconditionally) - a Collection Sharing link
   * (see navigation/linking.ts's `c/:publicId` mapping) must open for a signed-out user too.
   * publicId only; the screen resolves it via the anonymous Public API, never the authenticated
   * Collection API - see collections/api/publicCollectionsApi.ts.
   */
  SharedCollection: { publicId: string };
};

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

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Auth-gates the full app's screens via conditional Stack.Screen/Stack.Group children (React
 * Navigation's documented "authentication flows" pattern - see
 * https://reactnavigation.org/docs/auth-flow) rather than App.tsx rendering a completely separate
 * component tree with no NavigationContainer at all: SharedCollection must stay reachable via a
 * deep link no matter which branch below is active, and that only works if NavigationContainer
 * (and its `linking` prop - see App.tsx) is always mounted.
 */
export function RootStack() {
  const { t } = useTranslation();
  const { isAuthenticated, backendAuthStatus, userBootstrapStatus } = useAuth();
  const isReady =
    isAuthenticated && backendAuthStatus === 'valid' && userBootstrapStatus === 'ready';

  return (
    <Stack.Navigator>
      {isReady ? (
        <Stack.Group>
          <Stack.Screen component={MainTabs} name="MainTabs" options={{ headerShown: false }} />
          <Stack.Screen
            component={ItemDetailsScreen}
            name="ItemDetails"
            options={{ title: t('nav.itemDetails') }}
          />
          <Stack.Screen
            component={CollectionDetailsScreen}
            name="CollectionDetails"
            options={{ title: t('nav.collectionDetails') }}
          />
          <Stack.Screen
            component={LanguageSettingsScreen}
            name="LanguageSettings"
            options={{ title: t('nav.languageSettings') }}
          />
          <Stack.Screen
            component={RecentlyOpenedLinksScreen}
            name="RecentlyOpenedLinks"
            options={{ title: t('nav.recentlyOpenedLinks') }}
          />
        </Stack.Group>
      ) : isAuthenticated ? (
        <Stack.Screen
          component={AuthenticatedPlaceholder}
          name="AuthPending"
          options={{ headerShown: false }}
        />
      ) : (
        <Stack.Screen component={SignInScreen} name="SignIn" options={{ headerShown: false }} />
      )}
      <Stack.Screen
        component={SharedCollectionScreen}
        name="SharedCollection"
        options={{ title: t('nav.sharedCollection') }}
      />
    </Stack.Navigator>
  );
}

/** Verifies the auth round trip only; replaced by the real App Shell/Home later. */
function AuthenticatedPlaceholder() {
  const { t } = useTranslation();
  const { signOut, backendAuthStatus, userBootstrapStatus, retryBootstrap } = useAuth();
  const backendAuthMessageKey = backendAuthMessageKeys[backendAuthStatus];
  const userBootstrapMessageKey = userBootstrapMessageKeys[userBootstrapStatus];
  // Only backendAuthStatus can land here as 'unavailable' from a retryable state (a transient
  // failure restoring the session, or the Backend itself being briefly unreachable - see
  // AuthContext.tsx's runBootstrap) - userBootstrapStatus's own 'unavailable' means the device's
  // regional settings were rejected, which retrying with no changed input would not fix.
  const canRetry = backendAuthStatus === 'unavailable';

  return (
    <View style={styles.placeholderContainer}>
      <Text style={styles.placeholderTitle}>Juple</Text>
      <Text style={styles.placeholderMessage}>{t('auth.loggedIn')}</Text>
      <Text style={styles.placeholderSubMessage}>{t('auth.authConnected')}</Text>
      {backendAuthMessageKey ? (
        <Text style={styles.placeholderBackendAuthMessage}>{t(backendAuthMessageKey)}</Text>
      ) : null}
      {userBootstrapMessageKey ? (
        <Text style={styles.placeholderUserBootstrapMessage}>{t(userBootstrapMessageKey)}</Text>
      ) : null}
      {canRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={retryBootstrap}
          style={styles.placeholderRetryButton}
        >
          <Text style={styles.placeholderRetryLabel}>{t('auth.retry')}</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={signOut}
        style={styles.placeholderSignOutButton}
      >
        <Text style={styles.placeholderSignOutLabel}>{t('auth.logout')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholderContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  placeholderTitle: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 12,
  },
  placeholderMessage: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 6,
  },
  placeholderSubMessage: {
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
  },
  placeholderBackendAuthMessage: {
    marginTop: 8,
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
  },
  placeholderUserBootstrapMessage: {
    marginTop: 8,
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
  },
  placeholderRetryButton: {
    marginTop: 20,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 28,
    backgroundColor: '#111111',
  },
  placeholderRetryLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  placeholderSignOutButton: {
    marginTop: 12,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderColor: '#111111',
  },
  placeholderSignOutLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111111',
  },
});
