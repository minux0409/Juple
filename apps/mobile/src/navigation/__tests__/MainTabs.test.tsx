import { NavigationContainer } from '@react-navigation/native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../../i18n';
import { MainTabs } from '../MainTabs';

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
