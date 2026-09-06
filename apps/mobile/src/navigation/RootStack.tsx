import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import type { BackendAuthStatus, UserBootstrapStatus } from '../auth/types';
import { ArchiveScreen } from '../screens/ArchiveScreen';
import { CollectionDetailsScreen } from '../screens/CollectionDetailsScreen';
import { ItemDetailsScreen } from '../screens/ItemDetailsScreen';
import { LanguageSettingsScreen } from '../screens/LanguageSettingsScreen';
import { PurchaseDetailsScreen } from '../screens/PurchaseDetailsScreen';
import { PurchaseEditorScreen } from '../screens/PurchaseEditorScreen';
import { PurchaseHistoryScreen } from '../screens/PurchaseHistoryScreen';
import { RecentlyOpenedLinksScreen } from '../screens/RecentlyOpenedLinksScreen';
import { RepeatPurchaseDetailsScreen } from '../screens/RepeatPurchaseDetailsScreen';
import { RepeatPurchaseEditorScreen } from '../screens/RepeatPurchaseEditorScreen';
import { RepeatPurchaseLogPurchaseScreen } from '../screens/RepeatPurchaseLogPurchaseScreen';
import { SharedCollectionScreen } from '../screens/SharedCollectionScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { WishlistScreen } from '../screens/WishlistScreen';
import type { Purchase } from '../purchases/api/purchasesApi';
import type { RepeatPurchase } from '../purchases/api/repeatPurchasesApi';
import { MainTabs } from './MainTabs';

export type RootStackParamList = {
  MainTabs: undefined;
  ItemDetails: { itemId: number };
  /** collectionId only - the screen fetches the current Collection and its Item list itself via GET. */
  CollectionDetails: { collectionId: number };
  LanguageSettings: undefined;
  /**
   * Not in the Bottom Tabs (see MainTabs) since the new 홈/기록/보관함/내 페이지 IA - kept reachable
   * here as a temporary, explicitly-labeled path (see CollectionsScreen/MyPageScreen) while
   * Wishlist/Archive/PurchaseHistory's own eventual Collection/Item-detail migration is still
   * only a future direction, not implemented in this pass.
   */
  Wishlist: undefined;
  Archive: undefined;
  PurchaseHistory: undefined;
  /** My Page → "최근 본 링크" - the screen fetches the current page itself via GET. */
  RecentlyOpenedLinks: undefined;
  /**
   * Create mode: itemId/initialProductName are both optional - present when reached from
   * ItemDetailsScreen (a suggested initial value only, never confirmed automatically), absent when
   * reached standalone from the Purchase History tab.
   * Edit mode: purchaseId + initialPurchase are both present (set together by PurchaseDetailsScreen)
   * and prefill the form; itemId/initialProductName are unused in this mode.
   */
  PurchaseEditor: {
    itemId?: number;
    initialProductName?: string;
    purchaseId?: number;
    initialPurchase?: Purchase;
  };
  /** purchaseId only - the screen fetches the current Purchase itself via GET. */
  PurchaseDetails: { purchaseId: number };
  /**
   * Create mode: itemId/initialProductName are both optional - present when reached from
   * ItemDetailsScreen (a suggested initial value only, never confirmed automatically, never
   * synced with Item.Title after this point; see RepeatPurchaseEditorScreen), absent when reached
   * standalone from the Repeat Purchase list (itemId=null).
   * Edit mode: repeatPurchaseId + initialRepeatPurchase are both present (set together by
   * RepeatPurchaseDetailsScreen) and prefill the form, including the hidden Reminder fields, which
   * must round-trip unchanged - see RepeatPurchaseEditorScreen.
   */
  RepeatPurchaseEditor: {
    itemId?: number;
    initialProductName?: string;
    repeatPurchaseId?: number;
    initialRepeatPurchase?: RepeatPurchase;
  };
  /** repeatPurchaseId only - the screen fetches the current RepeatPurchase itself via GET. */
  RepeatPurchaseDetails: { repeatPurchaseId: number };
  /**
   * initialRepeatPurchase is always passed by RepeatPurchaseDetailsScreen (its own just-loaded
   * state), supplying the current opaque version and the read-only ProductName to show - never
   * re-fetched here.
   */
  RepeatPurchaseLogPurchase: { repeatPurchaseId: number; initialRepeatPurchase: RepeatPurchase };
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
            component={WishlistScreen}
            name="Wishlist"
            options={{ title: t('nav.wishlist') }}
          />
          <Stack.Screen
            component={ArchiveScreen}
            name="Archive"
            options={{ title: t('nav.archive') }}
          />
          <Stack.Screen
            component={PurchaseHistoryScreen}
            name="PurchaseHistory"
            options={{ title: t('nav.purchaseHistory') }}
          />
          <Stack.Screen
            component={RecentlyOpenedLinksScreen}
            name="RecentlyOpenedLinks"
            options={{ title: t('nav.recentlyOpenedLinks') }}
          />
          <Stack.Screen
            component={PurchaseEditorScreen}
            name="PurchaseEditor"
            options={({ route }) => ({
              title:
                route.params.purchaseId !== undefined
                  ? t('nav.purchaseEditorEdit')
                  : t('nav.purchaseEditorCreate'),
            })}
          />
          <Stack.Screen
            component={PurchaseDetailsScreen}
            name="PurchaseDetails"
            options={{ title: t('nav.purchaseDetails') }}
          />
          <Stack.Screen
            component={RepeatPurchaseEditorScreen}
            name="RepeatPurchaseEditor"
            options={({ route }) => ({
              title:
                route.params.repeatPurchaseId !== undefined
                  ? t('nav.repeatPurchaseEditorEdit')
                  : t('nav.repeatPurchaseEditorCreate'),
            })}
          />
          <Stack.Screen
            component={RepeatPurchaseDetailsScreen}
            name="RepeatPurchaseDetails"
            options={{ title: t('nav.repeatPurchaseDetails') }}
          />
          <Stack.Screen
            component={RepeatPurchaseLogPurchaseScreen}
            name="RepeatPurchaseLogPurchase"
            options={{ title: t('nav.repeatPurchaseLogPurchase') }}
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
  const { signOut, backendAuthStatus, userBootstrapStatus } = useAuth();
  const backendAuthMessageKey = backendAuthMessageKeys[backendAuthStatus];
  const userBootstrapMessageKey = userBootstrapMessageKeys[userBootstrapStatus];

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
  placeholderSignOutButton: {
    marginTop: 24,
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
