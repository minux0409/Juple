import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ItemDetailsScreen } from '../screens/ItemDetailsScreen';
import { MainTabs } from './MainTabs';

export type RootStackParamList = {
  MainTabs: undefined;
  ItemDetails: { itemId: number };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen component={MainTabs} name="MainTabs" options={{ headerShown: false }} />
      <Stack.Screen component={ItemDetailsScreen} name="ItemDetails" options={{ title: '상세' }} />
    </Stack.Navigator>
  );
}
