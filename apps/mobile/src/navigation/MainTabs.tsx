import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();

  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBarIcon: () => null }}>
      <Tab.Screen
        component={DailyInboxScreen}
        name="Home"
        options={{ tabBarLabel: t('tabs.home') }}
      />
      <Tab.Screen
        component={DateHistoryScreen}
        name="History"
        options={{ tabBarLabel: t('tabs.history') }}
      />
      <Tab.Screen
        component={CollectionsScreen}
        name="Collections"
        options={{ tabBarLabel: t('tabs.collections') }}
      />
      <Tab.Screen
        component={MyPageScreen}
        name="MyPage"
        options={{ tabBarLabel: t('tabs.myPage') }}
      />
    </Tab.Navigator>
  );
}
