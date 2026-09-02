import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ItemDetailsScreen } from '../screens/ItemDetailsScreen';
import { PurchaseEditorScreen } from '../screens/PurchaseEditorScreen';
import { MainTabs } from './MainTabs';

export type RootStackParamList = {
  MainTabs: undefined;
  ItemDetails: { itemId: number };
  /**
   * Create-only for now (see PurchaseEditorScreen). itemId/initialProductName are both optional -
   * present when reached from ItemDetailsScreen (a suggested initial value only, never confirmed
   * automatically), absent when reached standalone from the Purchase History tab.
   */
  PurchaseEditor: { itemId?: number; initialProductName?: string };
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
        options={{ title: '구매 기록 추가' }}
      />
    </Stack.Navigator>
  );
}
