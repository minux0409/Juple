import { BottomTabBar, createBottomTabNavigator, type BottomTabBarButtonProps, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Pressable } from '../components/Pressable';
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
import { CollectionsStack, type CollectionsStackParamList } from './CollectionsStack';
import { SelectionBarProvider } from '../selection/SelectionBarContext';
import { SelectionBarSlot } from '../selection/SelectionActionBar';

export type MainTabParamList = {
  Home: undefined;
  History: undefined;
  /** The 컬렉션 tab is a stack of its own: the Collections list and one Collection on top (see CollectionsStack). */
  Collections: NavigatorScreenParams<CollectionsStackParamList> | undefined;
  MyPage: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_ICON_SIZE = 22;

const styles = themedStyles(() => ({
  // Fills the tab's cell, so the tour spotlights the whole tab - icon and label together - not only the icon.
  tabTarget: { flex: 1 },
}));

// Defined at module scope (not inline in MainTabs' render) so React Navigation always sees the
// same tabBarIcon function identity across renders - see the "no inline component" lint rule.
function tabIconColor(focused: boolean): string {
  return focused ? colors.brandText : colors.textSecondary;
}

// Selected: the solid icon in the brand colour; the others: the outline. Same size and place either way.
function renderHomeIcon({ focused }: { focused: boolean }) {
  return <screenIcons.home color={tabIconColor(focused)} filled={focused} size={TAB_ICON_SIZE} />;
}

function renderHistoryIcon({ focused }: { focused: boolean }) {
  return <screenIcons.archive color={tabIconColor(focused)} cutoutColor={colors.surface} filled={focused} size={TAB_ICON_SIZE} />;
}

function renderCollectionsIcon({ focused }: { focused: boolean }) {
  return <screenIcons.collections color={tabIconColor(focused)} filled={focused} size={TAB_ICON_SIZE} />;
}

function renderMyPageIcon({ focused }: { focused: boolean }) {
  return <screenIcons.myPage color={tabIconColor(focused)} filled={focused} size={TAB_ICON_SIZE} />;
}

// A tab that a guided tour can spotlight: the target is the whole tab button (the bar's cells are navigator-owned, so the button
// is wrapped rather than measured).
function TourTabButton({ tourId, href: _href, pressOpacity: _pressOpacity, hoverEffect: _hoverEffect, android_ripple: _ripple, ...props }: BottomTabBarButtonProps & { readonly tourId: string }) {
  // No extra margin around a tab: it fills its cell, so the ring sits exactly on the tab's edges (its 2pt stroke drawn inside).
  const target = useTourTarget(tourId, { radius: radii.md, padding: 0 });
  return (
    <View {...target} style={styles.tabTarget}>
      <Pressable {...props} />
    </View>
  );
}

// Home has no tour target, but it is pressed like the others: the app Pressable's state layer (not the navigator's own button,
// whose Android ripple and iOS fade would differ from the other three tabs). The navigator's android_ripple is dropped on every tab
// so Android never shows a ripple on top of the state layer.
function renderHomeButton({ href: _href, pressOpacity: _pressOpacity, hoverEffect: _hoverEffect, android_ripple: _ripple, ...props }: BottomTabBarButtonProps) {
  return <Pressable {...props} />;
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

/**
 * The tab bar slot: the ordinary tab bar, or - while a screen is in multi-selection mode - that screen's floating action bar in its place
 * (the same slot, so the list above ends where it begins). The tab bar's own look and animation are untouched.
 */
function JupleTabBar(props: BottomTabBarProps) {
  return <SelectionBarSlot fallback={<BottomTabBar {...props} />} />;
}

function renderTabBar(props: BottomTabBarProps) {
  return <JupleTabBar {...props} />;
}

export function MainTabs() {
  const { t } = useTranslation();
  const { counts } = useAttentionSnapshot();
  const badge = (count: number) => count > 0 ? formatBadgeCount(count) : undefined;
  useTheme();

  return (
    <SelectionBarProvider>
    <Tab.Navigator
      tabBar={renderTabBar}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandText,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelPosition: 'below-icon',
        // A text field never shares the space above the keyboard with the tab bar (Android windows that resize would otherwise lift
        // the bar onto the keyboard, e.g. under a Collection's search or password field).
        tabBarHideOnKeyboard: true,
        tabBarBadgeStyle: { backgroundColor: colors.badge, color: colors.onBadge, fontSize: 11, fontWeight: '700' },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        // The selected tab is told by its solid brand-coloured icon (and label) alone - no background behind it; every tab has the
        // same margins and size whether it is selected or not, so switching tabs never moves anything.
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
        options={{ tabBarLabel: t('tabs.home'), tabBarIcon: renderHomeIcon, tabBarButton: renderHomeButton, tabBarBadge: badge(counts.home) }}
      />
      <Tab.Screen
        component={themedScreen(DateHistoryScreen)}
        name="History"
        options={{ tabBarLabel: t('tabs.history'), tabBarIcon: renderHistoryIcon, tabBarButton: renderHistoryButton, tabBarBadge: badge(counts.archive) }}
      />
      <Tab.Screen
        component={themedScreen(CollectionsStack)}
        name="Collections"
        options={{ tabBarLabel: t('tabs.collections'), tabBarIcon: renderCollectionsIcon, tabBarButton: renderCollectionsButton, tabBarBadge: badge(counts.collections) }}
      />
      <Tab.Screen
        component={themedScreen(MyPageScreen)}
        name="MyPage"
        options={{ tabBarLabel: t('tabs.myPage'), tabBarIcon: renderMyPageIcon, tabBarButton: renderMyPageButton, tabBarBadge: badge(counts.myPage) }}
      />
    </Tab.Navigator>
    </SelectionBarProvider>
  );
}
