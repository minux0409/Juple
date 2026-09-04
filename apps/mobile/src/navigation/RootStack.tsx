import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ArchiveScreen } from '../screens/ArchiveScreen';
import { ItemDetailsScreen } from '../screens/ItemDetailsScreen';
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
  return (
    <Stack.Navigator>
      <Stack.Screen component={MainTabs} name="MainTabs" options={{ headerShown: false }} />
      <Stack.Screen component={ItemDetailsScreen} name="ItemDetails" options={{ title: '상세' }} />
      <Stack.Screen component={WishlistScreen} name="Wishlist" options={{ title: '위시리스트' }} />
      <Stack.Screen component={ArchiveScreen} name="Archive" options={{ title: '보관' }} />
      <Stack.Screen
        component={PurchaseHistoryScreen}
        name="PurchaseHistory"
        options={{ title: '구매내역' }}
      />
      <Stack.Screen
        component={PurchaseEditorScreen}
        name="PurchaseEditor"
        options={({ route }) => ({
          title: route.params.purchaseId !== undefined ? '구매 기록 수정' : '구매 기록 추가',
        })}
      />
      <Stack.Screen
        component={PurchaseDetailsScreen}
        name="PurchaseDetails"
        options={{ title: '구매 기록 상세' }}
      />
      <Stack.Screen
        component={RepeatPurchaseEditorScreen}
        name="RepeatPurchaseEditor"
        options={({ route }) => ({
          title: route.params.repeatPurchaseId !== undefined ? '반복 구매 수정' : '반복 구매 추가',
        })}
      />
      <Stack.Screen
        component={RepeatPurchaseDetailsScreen}
        name="RepeatPurchaseDetails"
        options={{ title: '반복 구매 상세' }}
      />
      <Stack.Screen
        component={RepeatPurchaseLogPurchaseScreen}
        name="RepeatPurchaseLogPurchase"
        options={{ title: '구매 완료' }}
      />
    </Stack.Navigator>
  );
}
