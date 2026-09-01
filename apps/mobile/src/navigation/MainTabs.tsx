import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ArchiveScreen } from '../screens/ArchiveScreen';
import { DailyInboxScreen } from '../screens/DailyInboxScreen';
import { WishlistScreen } from '../screens/WishlistScreen';

export type MainTabParamList = {
  Inbox: undefined;
  Wishlist: undefined;
  Archive: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBarIcon: () => null }}>
      <Tab.Screen component={DailyInboxScreen} name="Inbox" />
      <Tab.Screen component={WishlistScreen} name="Wishlist" />
      <Tab.Screen component={ArchiveScreen} name="Archive" />
    </Tab.Navigator>
  );
}
