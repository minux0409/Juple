import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { CollectionsScreen } from '../screens/CollectionsScreen';
import { DailyInboxScreen } from '../screens/DailyInboxScreen';
import { DateHistoryScreen } from '../screens/DateHistoryScreen';
import { MyPageScreen } from '../screens/MyPageScreen';
import { themedScreen, useTheme } from '../theme/ThemeContext';
import { colors, radii, spacing, themedStyles } from '../theme/tokens';
import { TOUR_TARGETS } from '../tour/tourGuides';
import { useTourTarget } from '../tour/tourTargets';
import { screenIcons } from './screenIcons';
import { useAttentionSnapshot } from '../attention/attentionContext';
import { formatBadgeCount } from '../components/badgeCount';

export type MainTabParamList = {
  Home: undefined;
  History: undefined;
  /**
   * filter/openShareRequests come from a tapped Collection invitation Push (see
   * usePushMessageHandling): land on 공유 컬렉션 with its 공유 요청 open.
   */
  Collections: { refreshToken?: number; filter?: 'shared'; openShareRequests?: boolean } | undefined;
  MyPage: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_ICON_SIZE = 22;

const styles = themedStyles(() => ({
  tabIconTarget: { alignItems: 'center', justifyContent: 'center', padding: spacing.xs },
}));

// Defined at module scope (not inline in MainTabs' render) so React Navigation always sees the
// same tabBarIcon function identity across renders - see the "no inline component" lint rule.
function tabIconColor(focused: boolean): string {
  return focused ? colors.brandText : colors.textSecondary;
}

function renderHomeIcon({ focused }: { focused: boolean }) {
  return <screenIcons.home color={tabIconColor(focused)} size={TAB_ICON_SIZE} />;
}

// The tab icons that a guided tour can spotlight: the icon area is the tour target (the tab bar buttons are navigator-owned).
function TabIconTarget({ id, children }: { id: string; children: ReactNode }) {
  const target = useTourTarget(id, { radius: radii.md });
  return <View {...target} style={styles.tabIconTarget}>{children}</View>;
}

function renderHistoryIcon({ focused }: { focused: boolean }) {
  return <TabIconTarget id={TOUR_TARGETS.tabHistory}><screenIcons.archive color={tabIconColor(focused)} size={TAB_ICON_SIZE} /></TabIconTarget>;
}

function renderCollectionsIcon({ focused }: { focused: boolean }) {
  return <TabIconTarget id={TOUR_TARGETS.tabCollections}><screenIcons.collections color={tabIconColor(focused)} size={TAB_ICON_SIZE} /></TabIconTarget>;
}

function renderMyPageIcon({ focused }: { focused: boolean }) {
  return <TabIconTarget id={TOUR_TARGETS.tabMyPage}><screenIcons.myPage color={tabIconColor(focused)} size={TAB_ICON_SIZE} /></TabIconTarget>;
}

export function MainTabs() {
  const { t } = useTranslation();
  const { counts } = useAttentionSnapshot();
  const badge = (count: number) => count > 0 ? formatBadgeCount(count) : undefined;
  useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandText,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelPosition: 'below-icon',
        tabBarBadgeStyle: { backgroundColor: colors.danger, color: colors.onDanger, fontSize: 11, fontWeight: '700' },
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
        component={themedScreen(DailyInboxScreen)}
        name="Home"
        options={{ tabBarLabel: t('tabs.home'), tabBarIcon: renderHomeIcon, tabBarBadge: badge(counts.home) }}
      />
      <Tab.Screen
        component={themedScreen(DateHistoryScreen)}
        name="History"
        options={{ tabBarLabel: t('tabs.history'), tabBarIcon: renderHistoryIcon, tabBarBadge: badge(counts.archive) }}
      />
      <Tab.Screen
        component={themedScreen(CollectionsScreen)}
        name="Collections"
        options={{ tabBarLabel: t('tabs.collections'), tabBarIcon: renderCollectionsIcon, tabBarBadge: badge(counts.collections) }}
      />
      <Tab.Screen
        component={themedScreen(MyPageScreen)}
        name="MyPage"
        options={{ tabBarLabel: t('tabs.myPage'), tabBarIcon: renderMyPageIcon, tabBarBadge: badge(counts.myPage) }}
      />
    </Tab.Navigator>
  );
}
