import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { CollectionDetailsScreen } from '../screens/CollectionDetailsScreen';
import { CollectionsScreen } from '../screens/CollectionsScreen';
import { themedScreen, useTheme } from '../theme/ThemeContext';
import { headerTitleWithElement } from './screenIcons';
import { iosHeaderOptions } from './sheetHeader';

/**
 * collectionId only - the screen fetches the current Collection and its Item list itself via GET.
 * refreshToken is optional and only ever meaningful when this exact screen might already be the
 * focused one (e.g. a Merge Undo toast navigating back to the Collection it just merged into) -
 * mirrors CollectionsHome's own refreshToken param, needed because React Navigation does not
 * re-fire useFocusEffect for a `navigate` call that lands back on an already-focused screen.
 */
export type CollectionDetailsParams = {
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
 * The 컬렉션 tab's own stack: the Collections list and, on top of it, one Collection. Living inside the tab keeps the Juple tab bar
 * under a Collection with 컬렉션 selected; the other tabs keep their own state, and tapping 컬렉션 again while a Collection is open goes
 * back to the list (the stack's standard tab-press behavior). The link sheet, sharing and the other full-screen flows stay in the
 * root stack and still cover the tab bar.
 */
export type CollectionsStackParamList = {
  /**
   * filter/openShareRequests come from a tapped Collection invitation Push (see usePushMessageHandling): land on 공유 컬렉션 with
   * its 공유 요청 open. refreshToken reloads the list (e.g. after a Collection was deleted or left).
   */
  CollectionsHome: { refreshToken?: number; filter?: 'shared'; openShareRequests?: boolean } | undefined;
  CollectionDetails: CollectionDetailsParams;
};

const Stack = createNativeStackNavigator<CollectionsStackParamList>();

export function CollectionsStack() {
  const { t } = useTranslation();
  // The header options (title, tint, background) are computed here: reading the theme re-renders them on a change.
  useTheme();
  return (
    <Stack.Navigator screenOptions={iosHeaderOptions()}>
      <Stack.Screen component={themedScreen(CollectionsScreen)} name="CollectionsHome" options={{ headerShown: false }} />
      <Stack.Screen
        component={themedScreen(CollectionDetailsScreen)}
        name="CollectionDetails"
        // The header title is the Collection's own icon and name, set by the screen once loaded (no fixed "컬렉션" text).
        options={{ title: t('nav.collectionDetails'), ...headerTitleWithElement(<View />, true) }}
      />
    </Stack.Navigator>
  );
}
