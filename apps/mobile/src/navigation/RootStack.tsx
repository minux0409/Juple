import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ItemDetailsScreen } from '../screens/ItemDetailsScreen';
import { PurchaseDetailsScreen } from '../screens/PurchaseDetailsScreen';
import { PurchaseEditorScreen } from '../screens/PurchaseEditorScreen';
import type { Purchase } from '../purchases/api/purchasesApi';
import { MainTabs } from './MainTabs';

export type RootStackParamList = {
  MainTabs: undefined;
  ItemDetails: { itemId: number };
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
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen component={MainTabs} name="MainTabs" options={{ headerShown: false }} />
      <Stack.Screen component={ItemDetailsScreen} name="ItemDetails" options={{ title: '상세' }} />
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
    </Stack.Navigator>
  );
}
