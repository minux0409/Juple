import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { ArchiveScreen } from '../screens/ArchiveScreen';
import { CollectionDetailsScreen } from '../screens/CollectionDetailsScreen';
import { ItemDetailsScreen } from '../screens/ItemDetailsScreen';
import { LanguageSettingsScreen } from '../screens/LanguageSettingsScreen';
import { PurchaseDetailsScreen } from '../screens/PurchaseDetailsScreen';
import { PurchaseEditorScreen } from '../screens/PurchaseEditorScreen';
import { PurchaseHistoryScreen } from '../screens/PurchaseHistoryScreen';
import { RepeatPurchaseDetailsScreen } from '../screens/RepeatPurchaseDetailsScreen';
import { RepeatPurchaseEditorScreen } from '../screens/RepeatPurchaseEditorScreen';
import { RepeatPurchaseLogPurchaseScreen } from '../screens/RepeatPurchaseLogPurchaseScreen';
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
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootStack() {
  const { t } = useTranslation();

  return (
    <Stack.Navigator>
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
    </Stack.Navigator>
  );
}
