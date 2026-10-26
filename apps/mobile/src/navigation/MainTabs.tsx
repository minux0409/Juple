import { createBottomTabNavigator, type BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
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
  // Fills the tab's cell, so the tour spotlights the whole tab - icon, label and the selected background - not only the icon.
  tabTarget: { flex: 1 },
}));

// Defined at module scope (not inline in MainTabs' render) so React Navigation always sees the
// same tabBarIcon function identity across renders - see the "no inline component" lint rule.
function tabIconColor(focused: boolean): string {
  return focused ? colors.brandText : colors.textSecondary;
}

function renderHomeIcon({ focused }: { focused: boolean }) {
  return <screenIcons.home color={tabIconColor(focused)} size={TAB_ICON_SIZE} />;
}

function renderHistoryIcon({ focused }: { focused: boolean }) {
  return <screenIcons.archive color={tabIconColor(focused)} size={TAB_ICON_SIZE} />;
}

function renderCollectionsIcon({ focused }: { focused: boolean }) {
  return <screenIcons.collections color={tabIconColor(focused)} size={TAB_ICON_SIZE} />;
}

function renderMyPageIcon({ focused }: { focused: boolean }) {
  return <screenIcons.myPage color={tabIconColor(focused)} size={TAB_ICON_SIZE} />;
}

// A tab that a guided tour can spotlight: the target is the whole tab button (the bar's cells are navigator-owned, so the button
// is wrapped rather than measured).
function TourTabButton({ tourId, href: _href, pressOpacity: _pressOpacity, hoverEffect: _hoverEffect, ...props }: BottomTabBarButtonProps & { readonly tourId: string }) {
  const target = useTourTarget(tourId, { radius: radii.md });
  return (
    <View {...target} style={styles.tabTarget}>
      <Pressable {...props} />
    </View>
  );
}

function renderHistoryButton(props: BottomTabBarButtonProps) {
  return <TourTabButton {...props} tourId={TOUR_TARGETS.tabHistory} />;
}

function renderCollectionsButton(props: BottomTabBarButtonProps) {
  return <TourTabButton {...props} tourId={TOUR_TARGETS.tabCollections} />;
}

function renderMyPageButton(props: BottomTabBarButtonProps) {
  return <TourTabButton {...props} tourId={TOUR_TARGETS.tabMyPage} />;
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
        tabBarBadgeStyle: { backgroundColor: colors.badge, color: colors.onBadge, fontSize: 11, fontWeight: '700' },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        // The selected tab sits on a soft gray rounded background (the icon and label keep the brand color); every tab has the same
        // margins and size whether it is selected or not, so switching tabs never moves anything.
        tabBarActiveBackgroundColor: colors.surfaceMuted,
        tabBarItemStyle: {
          borderRadius: radii.md + 4,
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
        options={{ tabBarLabel: t('tabs.history'), tabBarIcon: renderHistoryIcon, tabBarButton: renderHistoryButton, tabBarBadge: badge(counts.archive) }}
      />
      <Tab.Screen
        component={themedScreen(CollectionsScreen)}
        name="Collections"
        options={{ tabBarLabel: t('tabs.collections'), tabBarIcon: renderCollectionsIcon, tabBarButton: renderCollectionsButton, tabBarBadge: badge(counts.collections) }}
      />
      <Tab.Screen
        component={themedScreen(MyPageScreen)}
        name="MyPage"
        options={{ tabBarLabel: t('tabs.myPage'), tabBarIcon: renderMyPageIcon, tabBarButton: renderMyPageButton, tabBarBadge: badge(counts.myPage) }}
      />
    </Tab.Navigator>
  );
}
