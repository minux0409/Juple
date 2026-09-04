import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { CollectionsScreen } from '../screens/CollectionsScreen';
import { DailyInboxScreen } from '../screens/DailyInboxScreen';
import { DateHistoryScreen } from '../screens/DateHistoryScreen';
import { MyPageScreen } from '../screens/MyPageScreen';

export type MainTabParamList = {
  Home: undefined;
  History: undefined;
  Collections: undefined;
  MyPage: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBarIcon: () => null }}>
      <Tab.Screen component={DailyInboxScreen} name="Home" options={{ tabBarLabel: '홈' }} />
      <Tab.Screen component={DateHistoryScreen} name="History" options={{ tabBarLabel: '기록' }} />
      <Tab.Screen
        component={CollectionsScreen}
        name="Collections"
        options={{ tabBarLabel: '보관함' }}
      />
      <Tab.Screen component={MyPageScreen} name="MyPage" options={{ tabBarLabel: '내 페이지' }} />
    </Tab.Navigator>
  );
}
