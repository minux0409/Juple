import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { CollectionDetailsScreen } from '../screens/CollectionDetailsScreen';
import { ItemDetailsScreen } from '../screens/ItemDetailsScreen';
import { LanguageSettingsScreen } from '../screens/LanguageSettingsScreen';
import { NewLinkReviewScreen } from '../screens/NewLinkReviewScreen';
import { SharedCollectionScreen } from '../screens/SharedCollectionScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { StartupProgressScreen } from '../screens/StartupProgressScreen';
import { IncomingShareRouter } from '../share/IncomingShareRouter';
import { MainTabs } from './MainTabs';

/**
 * Keeps the completed Startup Progress step ("준비가 완료되었습니다" at a full bar) on screen
 * briefly instead of swapping to MainTabs the instant bootstrap finishes - long enough to read,
 * short enough to never feel like a delay. Never used to fake progress, only to let a real,
 * already-reached completion register before navigating away.
 */
const READY_LINGER_MS = 450;

export type RootStackParamList = {
  MainTabs: undefined;
  ItemDetails: { itemId: number };
  /** collectionId only - the screen fetches the current Collection and its Item list itself via GET. */
  CollectionDetails: { collectionId: number };
  /**
   * Reached only via IncomingShareRouter's explicit navigate call, never a prefilled tab - see that
   * file. preselectedCollectionId/initialTitle are just the starting values for editable fields, not
   * anything already persisted (no Item exists until this screen's own Save call).
   */
  NewLinkReview: {
    url: string;
    initialTitle: string | null;
    preselectedCollectionId: number | null;
  };
  LanguageSettings: undefined;
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
  const { isAuthenticated, isInitializing, backendAuthStatus, userBootstrapStatus } = useAuth();
  const isBootstrapComplete =
    isAuthenticated && backendAuthStatus === 'valid' && userBootstrapStatus === 'ready';

  // Lets the Startup Progress UI's completed state (full bar, "준비가 완료되었습니다") register
  // on screen for READY_LINGER_MS before swapping to MainTabs - see that constant's own comment.
  const [showMainTabs, setShowMainTabs] = useState(false);
  useEffect(() => {
    if (!isBootstrapComplete) {
      setShowMainTabs(false);
      return;
    }
    const timer = setTimeout(() => setShowMainTabs(true), READY_LINGER_MS);
    return () => clearTimeout(timer);
  }, [isBootstrapComplete]);

  const isReady = isBootstrapComplete && showMainTabs;

  return (
    <>
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
              component={NewLinkReviewScreen}
              name="NewLinkReview"
              options={{ title: t('nav.newLinkReview') }}
            />
            <Stack.Screen
              component={LanguageSettingsScreen}
              name="LanguageSettings"
              options={{ title: t('nav.languageSettings') }}
            />
          </Stack.Group>
        ) : isInitializing || isAuthenticated ? (
          <Stack.Screen
            component={StartupProgressScreen}
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
      {/*
        IncomingShareRouter only calls navigationRef imperatively (see that file) - it has no need
        to be a descendant of Stack.Navigator (which only ever renders its own Screen/Group
        children), so it's a plain sibling here instead. Gated on isReady because it navigates to
        NewLinkReview, a screen that only exists in the tree above once isReady is true.
      */}
      {isReady ? <IncomingShareRouter /> : null}
    </>
  );
}
