import { NavigationContainer } from '@react-navigation/native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../../i18n';
import { MainTabs } from '../MainTabs';
import { StyleSheet } from 'react-native';
import { HomeIcon } from '../../icons/HomeIcon';
import { ArchiveIcon } from '../../icons/ArchiveIcon';
import { FolderIcon } from '../../icons/FolderIcon';
import { UserIcon } from '../../icons/UserIcon';
import { colors } from '../../theme/tokens';

// A true smoke test - no existing precedent in this repo for testing a Tab.Navigator, so this
// only asserts the navigator + all 4 tabBarIcon renderers mount without throwing. Each screen is
// stubbed out since exercising their own data-fetching/auth dependencies is out of scope here -
// each screen has (or will have) its own dedicated tests. Uses the real SafeAreaProvider (with
// fixed initialMetrics) rather than mocking react-native-safe-area-context piecemeal, since
// @react-navigation/bottom-tabs itself depends on several of its exports (SafeAreaInsetsContext,
// useSafeAreaFrame, etc.) that are easy to miss with a partial mock.
jest.mock('../../screens/DailyInboxScreen', () => ({ DailyInboxScreen: () => null }));
jest.mock('../../screens/DateHistoryScreen', () => ({ DateHistoryScreen: () => null }));
jest.mock('../../screens/CollectionsScreen', () => ({ CollectionsScreen: () => null }));
jest.mock('../../screens/MyPageScreen', () => ({ MyPageScreen: () => null }));

const initialMetrics = {
  frame: { x: 0, y: 0, width: 320, height: 640 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

test('renders all 4 tabs without throwing', async () => {
  await act(async () => {
    ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={initialMetrics}>
        <NavigationContainer>
          <MainTabs />
        </NavigationContainer>
      </SafeAreaProvider>,
    );
  });
});

test('the selected tab is the solid brand-coloured icon with no background behind it; the others are outlines - all the same size', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={initialMetrics}>
        <NavigationContainer>
          <MainTabs />
        </NavigationContainer>
      </SafeAreaProvider>,
    );
  });
  // The tab bar draws each tab's icon twice - the selected and the unselected look - and fades between them: the selected one is
  // always the SOLID brand-coloured icon, the other the grey outline, at one and the same size.
  for (const type of [HomeIcon, ArchiveIcon, FolderIcon, UserIcon]) {
    const copies = renderer.root.findAllByType(type as never);
    expect(copies.length).toBeGreaterThan(0);
    for (const icon of copies) {
      expect(icon.props.filled).toBe(icon.props.color === colors.brandText);
      expect([colors.brandText, colors.textSecondary]).toContain(icon.props.color);
    }
    expect(new Set(copies.map(icon => icon.props.size)).size).toBe(1);
  }
  // Home is the selected tab on start.
  expect(renderer.root.findAllByType(HomeIcon).some(icon => icon.props.filled === true)).toBe(true);
  // No grey selected background anywhere in the tab bar any more.
  const greyed = renderer.root.findAll(node => typeof node.type === 'string' && StyleSheet.flatten(node.props.style)?.backgroundColor === colors.surfaceMuted);
  expect(greyed).toHaveLength(0);
});
