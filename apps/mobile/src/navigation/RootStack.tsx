import { NoticesScreen } from '../screens/NoticesScreen';
import { NoticeDetailScreen } from '../screens/NoticeDetailScreen';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';
import { usePermissionOnboarding } from '../permissions/usePermissionOnboarding';
import { AccountManagementScreen } from '../screens/AccountManagementScreen';
import { CollectionDetailsScreen } from '../screens/CollectionDetailsScreen';
import { CollectionLockSettingsScreen } from '../screens/CollectionLockSettingsScreen';
import { CollectionShareScreen } from '../screens/CollectionShareScreen';
import { CustomerCenterScreen } from '../screens/CustomerCenterScreen';
import { HelpGuideScreen } from '../screens/HelpGuideScreen';
import { HelpGuideSectionScreen } from '../screens/HelpGuideSectionScreen';
import { SubscriptionScreen } from '../screens/SubscriptionScreen';
import { SupportInquiryDetailScreen } from '../screens/SupportInquiryDetailScreen';
import { SupportInquiryScreen } from '../screens/SupportInquiryScreen';
import { TutorialScreen } from '../screens/TutorialScreen';
import { OnboardingTourLauncher } from '../tour/OnboardingTourLauncher';
import { TourBackground } from '../tour/TourBackground';
import { TourHost } from '../tour/TourHost';
import { SubscriptionRequiredPrompt } from '../billing/SubscriptionRequiredPrompt';
import { MyCollectionSubmissionsScreen } from '../screens/MyCollectionSubmissionsScreen';
import { headerTitleWithIcon, screenIcons } from './screenIcons';
import { iosHeaderOptions } from './sheetHeader';
import { TermsAgreementScreen } from '../safety/TermsAgreementScreen';
import { TermsUnavailable } from '../safety/TermsUnavailable';
import { useTermsOnboarding } from '../safety/useTermsOnboarding';
import { FriendsScreen } from '../screens/FriendsScreen';
import { DataExportScreen } from '../screens/DataExportScreen';
import { DeleteAccountScreen } from '../screens/DeleteAccountScreen';
import { ItemDetailsScreen } from '../screens/ItemDetailsScreen';
import type { ItemOpenContext } from '../items/itemOpenGrant';
import { themedScreen, useTheme } from '../theme/ThemeContext';
import { LanguageSettingsScreen } from '../screens/LanguageSettingsScreen';
import { NewLinkReviewScreen } from '../screens/NewLinkReviewScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { ProfileEditScreen } from '../screens/ProfileEditScreen';
import { SharedCollectionEntry } from './SharedCollectionEntry';
import { SignInScreen } from '../screens/SignInScreen';
import { StartupProgressScreen } from '../screens/StartupProgressScreen';
import { TrashScreen } from '../screens/TrashScreen';
import { IncomingShareRouter } from '../share/IncomingShareRouter';
import { CollectionShortcutRouter } from '../shortcuts/CollectionShortcutRouter';
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
    collectionContext?: { readonly collectionId: number; readonly canRemove: boolean; readonly isCollectionOwner: boolean; readonly isCollaborative?: boolean; /** Another member's link: the same sheet, read-only (see ItemDetailsScreen isSharedView). */ readonly readOnly?: boolean };
    /** A comment notification: bring the comments into view once they are laid out (consumed once). */
    initialFocus?: 'comments';
    /** With initialFocus: the top-level comment whose thread is opened (a reply / heart notification). */
    initialFocusThreadRootId?: number | null;
    /**
     * Opened from a Home/Archive card gated by a Collection: the link is read IN that Collection's context (the server
     * enforces its lock). Only the Collection id and a one-time key travel here - the grant itself is handed over in
     * memory (see itemOpenGrant) and lives only as long as this popup.
     */
    openContext?: ItemOpenContext;
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
    openItem?: {
      readonly itemId: number;
      readonly focus: 'comments' | null;
      /** A reply / heart notification: the top-level comment whose thread is opened once the comments are here. */
      readonly commentRootId?: number | null;
      /** Somebody else's link: opened in the read-only shared view instead of the owner's ItemDetails. */
      readonly shared?: boolean;
    };
    /** A 승인 요청 notification: opens the Owner's 링크 승인 대기 popup over the Collection once its content is open. Consumed once. */
    openApprovals?: boolean;
    /** A join-request notification: once the content is open (lock gate passed), the 참여 요청 bottom sheet opens over the Collection. Consumed once. */
    openJoinRequests?: boolean;
    /**
     * The Collections list's long-press menu: 공유 (the same share entry as the header icon) and 수정 / 잠금 설정 / 삭제 / 나가기 are this screen's own dialogs (with its
     * password prompt for a locked Collection, its undo and its navigation back) - the list asks for one and this screen
     * opens it once the Collection is loaded, so no dialog or API call is duplicated. Consumed once; what the caller may do
     * is decided here from the Collection itself, never from this param.
     */
    pendingAction?: 'edit' | 'lock' | 'delete' | 'leave' | 'share';
  };
  /**
   * Owner-only sharing of one Collection, as a modal - one screen: 모든 사용자 (the public link),
   * 친구 초대 / ID 초대하기 (읽기 or 쓰기 per person), the people it is shared with and pending
   * invitations. Opening it never enables anything by itself.
   */
  CollectionShare: { collectionId: number };
  /** A signed-in public-link submitter's (not a member's) own waiting links. A member's 내 승인 대기 is a popup (ApprovalSubmissionSheet), not a screen. */
  MyCollectionSubmissions: { publicId: string };
  /** 친구: friends, friend requests and the signed-in user's private notes. Grants no Collection access. */
  Friends: { readonly openRequests?: true; readonly refreshToken?: number } | undefined;
  /** 알림: the signed-in user's Notification Inbox, newest first. */
  Notifications: undefined;
  /**
   * Reached only via IncomingShareRouter's explicit navigate call, never a prefilled tab - see that
   * file. preselectedCollectionId/initialTitle are just the starting values for editable fields, not
   * anything already persisted (no Item exists until this screen's own Save call).
   */
  NewLinkReview: {
    url: string;
    initialTitle: string | null;
    preselectedCollectionId: number | null;
    /** The Collection a share named was checked and is no longer usable: it was dropped (never replaced) - say so once on opening. */
    destinationUnavailable?: boolean;
  };
  LanguageSettings: undefined;
  /** 화면 모드: 시스템 설정 사용 / 라이트 / 다크 (this device only). */
  /** Settings > 컬렉션 잠금: the user's own locked Collections and the passwords this device remembers. */
  CollectionLockSettings: undefined;
  /** 내 페이지 > 프로필 편집: the profile photo and nickname (the Juple ID is shown read-only). */
  ProfileEdit: undefined;
  /** 설정 > 계정 관리: Juple ID, sign-in method, password management where the provider offers it, and account deletion. */
  AccountManagement: undefined;
  /** 계정 관리 > 계정 삭제: warning, a fresh sign-in, then typing the Juple ID - never a single tap. */
  DeleteAccount: undefined;
  /** 계정 관리 / 구독 > 데이터 내보내기: the person's own data as download links (shown only when the server enables export). */
  DataExport: undefined;
  Trash: undefined;
  /** 내 페이지 > 고객센터: tutorial replay, FAQ, 문의하기 (system mail app), legal documents and the app version. */
  CustomerCenter: undefined;
  /** 내 페이지 > 도움말: the Feature Guide - goal-based sections, plus a replay of the first-run tutorial. */
  HelpGuide: undefined;
  /** One Feature Guide section (sectionId is a GUIDE_SECTIONS id). */
  HelpGuideSection: { sectionId: string };
  /** 내 페이지 > 구독(내부 테스트): the monthly plan, store price, Subscribe and Restore. Registered only in builds that show the internal test entry. */
  Subscription: undefined;
  /** 고객센터 > 문의하기: write an inquiry (default) or read 문의내역. Sent inside the app - no mail app. */
  SupportInquiry: { initialTab?: 'write' | 'history' } | undefined;
  Notices: undefined;
  NoticeDetail: { noticeId: number };
  /** 문의내역 > one inquiry: its question and the answer. Only the caller's own inquiry opens (the server answers 404 otherwise). */
  SupportInquiryDetail: { inquiryId: number };
  /**
   * The tutorial. firstRun: shown once per person and tutorial version after sign-in (userKey = the person's key for
   * the completion record); replay: from 고객센터, records nothing.
   */
  Tutorial: undefined;
  /** Rendered instead of MainTabs while signed in but not yet backend-valid/bootstrapped - see this file's isReady branching. */
  AuthPending: undefined;
  /** Rendered instead of MainTabs while signed out - see this file's isReady branching. */
  SignIn: undefined;
  /** Rendered after sign-in until the current Terms are accepted (before the tutorial and Home). */
  TermsAgreement: undefined;
  /** The Terms status could not be read: retry or sign out - never a way past the Agreement. */
  TermsUnavailable: undefined;
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
  const { isAuthenticated, isInitializing, backendAuthStatus, userBootstrapStatus, signOut, entitlement } = useAuth();
  // The subscription screen (price, 구독하기, restore) exists only while the server says the paid program is live: with it off the
  // route is not registered at all, so no menu, notice, deep route or stray navigate() can reach a purchase.
  const isSubscriptionProgramLive = entitlement?.programEnabled === true;
  const isBootstrapComplete =
    isAuthenticated && backendAuthStatus === 'valid' && userBootstrapStatus === 'ready';

  // Terms come after sign-in and before everything else (tutorial, Home): the server's account state decides, per Terms version.
  const termsOnboarding = useTermsOnboarding(isBootstrapComplete);
  const isTermsAccepted = isBootstrapComplete && termsOnboarding.status === 'accepted';
  const isTermsRequired = isBootstrapComplete && termsOnboarding.status === 'required';
  const permissionReview = usePermissionOnboarding(isTermsAccepted);

  // Lets the Startup Progress UI's completed state (full bar, "준비가 완료되었습니다") register
  // on screen for READY_LINGER_MS before swapping to MainTabs - see that constant's own comment.
  const [showMainTabs, setShowMainTabs] = useState(false);
  useEffect(() => {
    if (!isTermsAccepted) {
      setShowMainTabs(false);
      return;
    }
    const timer = setTimeout(() => setShowMainTabs(true), READY_LINGER_MS);
    return () => clearTimeout(timer);
  }, [isTermsAccepted]);

  const isReady = isTermsAccepted && showMainTabs && permissionReview.status === 'done';
  // The headers (title, tint, background) are options computed here: reading the theme re-renders them on a change.
  useTheme();

  return (
    <>
      <TourBackground>
      <Stack.Navigator screenOptions={iosHeaderOptions()}>
        {isReady ? (
          <Stack.Group>
            <Stack.Screen component={themedScreen(MainTabs)} name="MainTabs" options={{ headerShown: false }} />
            {/* A bottom half-sheet over the screen it was opened from - never a full page: transparent, no header; the dimmed
                backdrop fades in while the sheet itself slides up (see ItemDetailsScreen). The system back button (and the
                sheet's own X / backdrop) close it. */}
            <Stack.Screen
              component={themedScreen(ItemDetailsScreen)}
              name="ItemDetails"
              options={{
                animation: 'fade',
                contentStyle: { backgroundColor: 'transparent' },
                headerShown: false,
                presentation: 'transparentModal',
                title: t('nav.itemDetails'),
              }}
            />
            <Stack.Screen
              component={themedScreen(CollectionDetailsScreen)}
              name="CollectionDetails"
              options={{ title: t('nav.collectionDetails'), ...headerTitleWithIcon(screenIcons.collectionDetails, t('nav.collectionDetails')) }}
            />
            {/* On iOS 'modal' is a page sheet with no back button of its own: the stack-wide back arrow (screenOptions) closes it
                like the swipe-down does (the screen keeps no unsaved draft to guard). Android shows a normal stack screen. */}
            <Stack.Screen
              component={themedScreen(CollectionShareScreen)}
              name="CollectionShare"
              options={{ presentation: 'modal', title: t('nav.collectionShare'), ...headerTitleWithIcon(screenIcons.collectionShare, t('nav.collectionShare')) }}
            />
            <Stack.Screen
              component={themedScreen(MyCollectionSubmissionsScreen)}
              name="MyCollectionSubmissions"
              options={{ title: t('nav.myCollectionSubmissions'), ...headerTitleWithIcon(screenIcons.link, t('nav.myCollectionSubmissions')) }}
            />
            <Stack.Screen
              component={themedScreen(FriendsScreen)}
              name="Friends"
              options={{ title: t('friends.title'), ...headerTitleWithIcon(screenIcons.friends, t('friends.title')) }}
            />
            <Stack.Screen
              component={themedScreen(NotificationsScreen)}
              name="Notifications"
              options={{ title: t('notifications.title'), ...headerTitleWithIcon(screenIcons.notifications, t('notifications.title')) }}
            />
            <Stack.Screen
              component={themedScreen(NewLinkReviewScreen)}
              name="NewLinkReview"
              // A dedicated compact full-screen editor (no modal, no bottom sheet): header, compact preview, quick Collections, sticky Save.
              options={{ title: t('item.saveDialogTitle'), ...headerTitleWithIcon(screenIcons.link, t('item.saveDialogTitle')) }}
            />
            <Stack.Screen
              component={themedScreen(LanguageSettingsScreen)}
              name="LanguageSettings"
              options={{ title: t('nav.languageSettings'), ...headerTitleWithIcon(screenIcons.language, t('nav.languageSettings')) }}
            />
            <Stack.Screen
              component={themedScreen(CollectionLockSettingsScreen)}
              name="CollectionLockSettings"
              options={{ title: t('nav.collectionLockSettings'), ...headerTitleWithIcon(screenIcons.collectionLock, t('nav.collectionLockSettings')) }}
            />
            <Stack.Screen component={themedScreen(TrashScreen)} name="Trash" options={{ title: t('nav.trash'), ...headerTitleWithIcon(screenIcons.trash, t('nav.trash')) }} />
            <Stack.Screen component={themedScreen(HelpGuideScreen)} name="HelpGuide" options={{ title: t('guide.title'), ...headerTitleWithIcon(screenIcons.help, t('guide.title')) }} />
            <Stack.Screen component={themedScreen(HelpGuideSectionScreen)} name="HelpGuideSection" options={({ route }) => ({ title: t(`guide.sections.${route.params.sectionId}.title`), ...headerTitleWithIcon(screenIcons.help, t(`guide.sections.${route.params.sectionId}.title`)) })} />
            <Stack.Screen component={themedScreen(CustomerCenterScreen)} name="CustomerCenter" options={{ title: t('customerCenter.title'), ...headerTitleWithIcon(screenIcons.customerCenter, t('customerCenter.title')) }} />
            {/* Always registered: an account whose free period ended is sent here to subscribe or restore. Only the My Page ENTRY is limited to internal-test builds. */}
            {isSubscriptionProgramLive ? (
              <Stack.Screen component={themedScreen(SubscriptionScreen)} name="Subscription" options={{ title: t('subscription.title'), ...headerTitleWithIcon(screenIcons.subscription, t('subscription.title')) }} />
            ) : null}
            <Stack.Screen component={themedScreen(NoticesScreen)} name="Notices" options={{ title: t('notices.title'), ...headerTitleWithIcon(screenIcons.notices, t('notices.title')) }} />
            <Stack.Screen component={themedScreen(NoticeDetailScreen)} name="NoticeDetail" options={{ title: t('notices.title'), ...headerTitleWithIcon(screenIcons.notices, t('notices.title')) }} />
            <Stack.Screen component={themedScreen(SupportInquiryScreen)} name="SupportInquiry" options={{ title: t('inquiry.title'), ...headerTitleWithIcon(screenIcons.customerCenter, t('inquiry.title')) }} />
            <Stack.Screen component={themedScreen(SupportInquiryDetailScreen)} name="SupportInquiryDetail" options={{ title: t('inquiry.detailTitle'), ...headerTitleWithIcon(screenIcons.customerCenter, t('inquiry.detailTitle')) }} />
            {/* Full-screen, no header: its own skip/close and Android back (see TutorialScreen); no swipe-back gesture, so a first run is always recorded. */}
            <Stack.Screen component={themedScreen(TutorialScreen)} name="Tutorial" options={{ animation: 'fade', gestureEnabled: false, headerShown: false, presentation: 'fullScreenModal' }} />
            <Stack.Screen component={themedScreen(ProfileEditScreen)} name="ProfileEdit" options={{ title: t('profile.edit'), ...headerTitleWithIcon(screenIcons.profileEdit, t('profile.edit')) }} />
            <Stack.Screen component={themedScreen(AccountManagementScreen)} name="AccountManagement" options={{ title: t('account.title'), ...headerTitleWithIcon(screenIcons.account, t('account.title')) }} />
            <Stack.Screen component={themedScreen(DeleteAccountScreen)} name="DeleteAccount" options={{ title: t('account.deleteTitle'), ...headerTitleWithIcon(screenIcons.deleteAccount, t('account.deleteTitle')) }} />
            <Stack.Screen component={themedScreen(DataExportScreen)} name="DataExport" options={{ title: t('dataExport.title'), ...headerTitleWithIcon(screenIcons.dataExport, t('dataExport.title')) }} />
          </Stack.Group>
        ) : isTermsRequired ? (
          <Stack.Screen name="TermsAgreement" options={{ headerShown: false, gestureEnabled: false }}>
            {() => (
              <TermsAgreementScreen
                isSaving={termsOnboarding.isSaving}
                onAccept={() => { termsOnboarding.accept().catch(() => undefined); }}
                saveFailed={termsOnboarding.saveFailed}
              />
            )}
          </Stack.Screen>
        ) : isBootstrapComplete && termsOnboarding.status === 'error' ? (
          <Stack.Screen name="TermsUnavailable" options={{ headerShown: false }}>
            {() => <TermsUnavailable onRetry={termsOnboarding.retry} onSignOut={() => { signOut().catch(() => undefined); }} />}
          </Stack.Screen>
        ) : isInitializing || isAuthenticated ? (
          <Stack.Screen
            component={themedScreen(StartupProgressScreen)}
            name="AuthPending"
            options={{ headerShown: false }}
          />
        ) : (
          <Stack.Screen component={themedScreen(SignInScreen)} name="SignIn" options={{ headerShown: false }} />
        )}
        <Stack.Screen
          name="SharedCollection"
          getId={({ params }) => params.publicId}
          options={{ title: t('nav.sharedCollection'), ...headerTitleWithIcon(screenIcons.collectionDetails, t('nav.sharedCollection')) }}
        >
          {props => (
            <SharedCollectionEntry
              {...props}
              ready={isReady || (!isInitializing && !isAuthenticated)}
              fallback={isTermsRequired ? (
                <TermsAgreementScreen
                  isSaving={termsOnboarding.isSaving}
                  onAccept={() => { termsOnboarding.accept().catch(() => undefined); }}
                  saveFailed={termsOnboarding.saveFailed}
                />
              ) : isBootstrapComplete && termsOnboarding.status === 'error' ? (
                <TermsUnavailable onRetry={termsOnboarding.retry} onSignOut={() => { signOut().catch(() => undefined); }} />
              ) : <StartupProgressScreen />}
            />
          )}
        </Stack.Screen>
      </Stack.Navigator>
      </TourBackground>
      {/*
        IncomingShareRouter only calls navigationRef imperatively (see that file) - it has no need
        to be a descendant of Stack.Navigator (which only ever renders its own Screen/Group
        children), so it's a plain sibling here instead. Gated on isReady because it navigates to
        NewLinkReview, a screen that only exists in the tree above once isReady is true.
      */}
      {isReady ? <IncomingShareRouter /> : null}
      {isReady ? <CollectionShortcutRouter /> : null}
      {isReady ? <OnboardingTourLauncher /> : null}
      {isReady ? <TourHost /> : null}
      {isReady ? <SubscriptionRequiredPrompt /> : null}
    </>
  );
}
