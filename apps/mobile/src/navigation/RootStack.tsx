import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { AccountManagementScreen } from '../screens/AccountManagementScreen';
import { CollectionDetailsScreen } from '../screens/CollectionDetailsScreen';
import { CollectionLockSettingsScreen } from '../screens/CollectionLockSettingsScreen';
import { CollectionShareScreen } from '../screens/CollectionShareScreen';
import { CollectionSubmissionsScreen } from '../screens/CollectionSubmissionsScreen';
import { FriendsScreen } from '../screens/FriendsScreen';
import { CollectionSharedItemScreen } from '../screens/CollectionSharedItemScreen';
import { DeleteAccountScreen } from '../screens/DeleteAccountScreen';
import { ItemDetailsScreen } from '../screens/ItemDetailsScreen';
import { LanguageSettingsScreen } from '../screens/LanguageSettingsScreen';
import { NewLinkReviewScreen } from '../screens/NewLinkReviewScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { ProfileEditScreen } from '../screens/ProfileEditScreen';
import { SharedCollectionScreen } from '../screens/SharedCollectionScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { StartupProgressScreen } from '../screens/StartupProgressScreen';
import { TrashScreen } from '../screens/TrashScreen';
import { IncomingShareRouter } from '../share/IncomingShareRouter';
import { MainTabs, type MainTabParamList } from './MainTabs';

/**
 * Keeps the completed Startup Progress step ("준비가 완료되었습니다" at a full bar) on screen
 * briefly instead of swapping to MainTabs the instant bootstrap finishes - long enough to read,
 * short enough to never feel like a delay. Never used to fake progress, only to let a real,
 * already-reached completion register before navigating away.
 */
const READY_LINGER_MS = 450;

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  /**
   * collectionContext: set only when opened from inside a Collection (CollectionDetailsScreen). The
   * delete action then means "remove from this Collection" - the saved link itself stays.
   * canRemove: whether THIS link may be removed from the Collection - the Owner any link, a member the
   * links they added themselves (a server rule too). It says nothing about owning the Collection.
   * isCollectionOwner: whether the caller owns the Collection - the only thing that grants deleting other
   * people's comments there. Never derived from canRemove or from owning the link.
   * isCollaborative: the Collection it was opened from has other people in it (and its
   * content is open) - only then does the link show that Collection's reactions and comments. They belong
   * to (Collection, link), so a link opened from Home, History or a private Collection shows none.
   */
  ItemDetails: {
    itemId: number;
    collectionContext?: { readonly collectionId: number; readonly canRemove: boolean; readonly isCollectionOwner: boolean; readonly isCollaborative?: boolean };
    /** A comment notification: bring the comments into view once they are laid out (consumed once). */
    initialFocus?: 'comments';
  };
  /**
   * collectionId only - the screen fetches the current Collection and its Item list itself via GET.
   * refreshToken is optional and only ever meaningful when this exact screen might already be the
   * focused one (e.g. a Merge Undo toast navigating back to the Collection it just merged into) -
   * mirrors CollectionsScreen's own refreshToken param, needed because React Navigation does not
   * re-fire useFocusEffect for a `navigate` call that lands back on an already-focused screen.
   */
  CollectionDetails: {
    collectionId: number;
    refreshToken?: number;
    /**
     * A reaction/comment notification on my link here: once the Collection's content is open (its
     * lock / share-password gate passed, as for any visit), that link opens IN this Collection - so
     * its reactions and comments show and the visit's unlock is reused. Consumed once.
     */
    openItem?: { readonly itemId: number; readonly focus: 'comments' | null };
  };
  /**
   * Owner-only sharing of one Collection, as a modal - one screen: 모든 사용자 (the public link),
   * 친구 초대 / ID 초대하기 (읽기 or 쓰기 per person), the people it is shared with and pending
   * invitations. Opening it never enables anything by itself.
   */
  CollectionShare: { collectionId: number };
  /** The Owner's 승인 대기 list of links proposed for this Collection (승인 후 추가). */
  CollectionSubmissions: { collectionId: number };
  /** 친구: friends, friend requests and the signed-in user's private notes. Grants no Collection access. */
  Friends: undefined;
  /** 알림: the signed-in user's Notification Inbox, newest first. */
  Notifications: undefined;
  /**
   * Read-only view of another member's link inside a Collection (never the owner-only
   * ItemDetails) - fetched through that Collection, so it carries no memo or uploaded photos.
   */
  /** isCollectionOwner: the caller owns the Collection (may delete any comment) - the server decides the same. */
  CollectionSharedItem: { collectionId: number; itemId: number; isCollectionOwner?: boolean };
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
  /** Settings > 컬렉션 잠금: the user's own locked Collections and the passwords this device remembers. */
  CollectionLockSettings: undefined;
  /** 내 페이지 > 프로필 편집: the profile photo and nickname (the Juple ID is shown read-only). */
  ProfileEdit: undefined;
  /** 설정 > 계정 관리: Juple ID, sign-in method, password management where the provider offers it, and account deletion. */
  AccountManagement: undefined;
  /** 계정 관리 > 계정 삭제: warning, a fresh sign-in, then typing the Juple ID - never a single tap. */
  DeleteAccount: undefined;
  Trash: undefined;
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
              component={CollectionShareScreen}
              name="CollectionShare"
              options={{ presentation: 'modal', title: t('nav.collectionShare') }}
            />
            <Stack.Screen
              component={CollectionSubmissionsScreen}
              name="CollectionSubmissions"
              options={{ title: t('nav.collectionSubmissions') }}
            />
            <Stack.Screen
              component={FriendsScreen}
              name="Friends"
              options={{ title: t('friends.title') }}
            />
            <Stack.Screen
              component={NotificationsScreen}
              name="Notifications"
              options={{ title: t('notifications.title') }}
            />
            <Stack.Screen
              component={CollectionSharedItemScreen}
              name="CollectionSharedItem"
              options={{ title: t('nav.collectionSharedItem') }}
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
            <Stack.Screen
              component={CollectionLockSettingsScreen}
              name="CollectionLockSettings"
              options={{ title: t('nav.collectionLockSettings') }}
            />
            <Stack.Screen component={TrashScreen} name="Trash" options={{ title: t('nav.trash') }} />
            <Stack.Screen component={ProfileEditScreen} name="ProfileEdit" options={{ title: t('profile.edit') }} />
            <Stack.Screen component={AccountManagementScreen} name="AccountManagement" options={{ title: t('account.title') }} />
            <Stack.Screen component={DeleteAccountScreen} name="DeleteAccount" options={{ title: t('account.deleteTitle') }} />
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
