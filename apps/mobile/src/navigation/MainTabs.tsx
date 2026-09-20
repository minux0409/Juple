import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { ClockIcon } from '../icons/ClockIcon';
import { FolderIcon } from '../icons/FolderIcon';
import { HomeIcon } from '../icons/HomeIcon';
import { UserIcon } from '../icons/UserIcon';
import { CollectionsScreen } from '../screens/CollectionsScreen';
import { DailyInboxScreen } from '../screens/DailyInboxScreen';
import { DateHistoryScreen } from '../screens/DateHistoryScreen';
import { MyPageScreen } from '../screens/MyPageScreen';
import { colors, radii, spacing } from '../theme/tokens';

export type MainTabParamList = {
  Home: undefined;
  History: undefined;
  Collections: undefined;
  MyPage: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_ICON_SIZE = 22;

// Defined at module scope (not inline in MainTabs' render) so React Navigation always sees the
// same tabBarIcon function identity across renders - see the "no inline component" lint rule.
function tabIconColor(focused: boolean): string {
  return focused ? colors.brand : colors.textSecondary;
}

function renderHomeIcon({ focused }: { focused: boolean }) {
  return <HomeIcon color={tabIconColor(focused)} size={TAB_ICON_SIZE} />;
}

function renderHistoryIcon({ focused }: { focused: boolean }) {
  return <ClockIcon color={tabIconColor(focused)} size={TAB_ICON_SIZE} />;
}

function renderCollectionsIcon({ focused }: { focused: boolean }) {
  return <FolderIcon color={tabIconColor(focused)} size={TAB_ICON_SIZE} />;
}

function renderMyPageIcon({ focused }: { focused: boolean }) {
  return <UserIcon color={tabIconColor(focused)} size={TAB_ICON_SIZE} />;
}

export function MainTabs() {
  const { t } = useTranslation();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelPosition: 'below-icon',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        tabBarItemStyle: {
          borderRadius: radii.md,
          overflow: 'hidden',
          marginHorizontal: spacing.xs,
        },
        // No explicit height/padding here - the default height already accounts for the bottom
        // safe-area inset (see this repo's own rule against duplicating inset handling); this only
        // adds the white background + subtle top shadow the redesign calls for.
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.inputBorder,
          borderTopWidth: 1,
          elevation: 8,
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.05,
          shadowRadius: 6,
        },
      }}
    >
      <Tab.Screen
        component={DailyInboxScreen}
        name="Home"
        options={{ tabBarLabel: t('tabs.home'), tabBarIcon: renderHomeIcon }}
      />
      <Tab.Screen
        component={DateHistoryScreen}
        name="History"
        options={{ tabBarLabel: t('tabs.history'), tabBarIcon: renderHistoryIcon }}
      />
      <Tab.Screen
        component={CollectionsScreen}
        name="Collections"
        options={{ tabBarLabel: t('tabs.collections'), tabBarIcon: renderCollectionsIcon }}
      />
      <Tab.Screen
        component={MyPageScreen}
        name="MyPage"
        options={{ tabBarLabel: t('tabs.myPage'), tabBarIcon: renderMyPageIcon }}
      />
    </Tab.Navigator>
  );
}
