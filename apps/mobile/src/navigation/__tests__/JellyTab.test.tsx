import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { AccessibilityInfo, Animated } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../../i18n';
import { HomeIcon } from '../../icons/HomeIcon';
import { MainTabs, type MainTabParamList } from '../MainTabs';

jest.mock('../../screens/DailyInboxScreen', () => ({ DailyInboxScreen: () => null }));
jest.mock('../../screens/DateHistoryScreen', () => ({ DateHistoryScreen: () => null }));
jest.mock('../../screens/CollectionsScreen', () => ({ CollectionsScreen: () => null }));
jest.mock('../../screens/MyPageScreen', () => ({ MyPageScreen: () => null }));

const metrics = { frame: { x: 0, y: 0, width: 360, height: 720 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

async function renderTabs() {
  const ref = createNavigationContainerRef<MainTabParamList>();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <NavigationContainer ref={ref}><MainTabs /></NavigationContainer>
      </SafeAreaProvider>,
    );
  });
  return { renderer, ref };
}

/** The Animated.spring / Animated.timing calls made by the jelly tab itself (the tab bar animates its own things too). */
function jellyCalls(method: 'spring' | 'timing') {
  const original = Animated[method] as (...args: never[]) => unknown;
  const calls: [unknown, { useNativeDriver: boolean; duration?: number }][] = [];
  jest.spyOn(Animated, method).mockImplementation(((...args: never[]) => {
    if (/[\\/]navigation[\\/]JellyTab\.tsx/.test(new Error().stack ?? '')) {
      calls.push(args as never);
    }
    return original(...args);
  }) as never);
  return calls;
}

afterEach(() => jest.restoreAllMocks());

describe('the jelly tab bar', () => {
  it('renders the four tabs; the start needs no animation and only the selected icon look pops', async () => {
    const spring = jellyCalls('spring');
    const timing = jellyCalls('timing');
    const { renderer } = await renderTabs();
    expect(spring).toHaveLength(0);
    expect(timing).toHaveLength(0);
    const homeIcons = renderer.root.findAllByType(HomeIcon as never);
    const wrappersWithScale = homeIcons.filter(icon => {
      const transform = icon.parent?.props.style?.transform as { scale?: unknown }[] | undefined;
      return Array.isArray(transform) && transform.some(entry => 'scale' in entry);
    });
    expect(wrappersWithScale.map(icon => icon.props.filled)).toEqual([true]);
  });

  it('choosing a tab pops the new icon natively and never waits for the blob: the navigation is immediate', async () => {
    const spring = jellyCalls('spring');
    const timing = jellyCalls('timing');
    const { ref } = await renderTabs();
    await act(async () => { ref.navigate('Collections'); });
    expect(ref.getCurrentRoute()?.name).toBe('CollectionsHome');
    // The icon pop and the old icon's settle run on the native driver. (The blob itself - two JS-driven edge springs - starts only once
    // the bar has measured the tabs, which a test renderer cannot do.)
    const native = [...spring, ...timing].filter(([, config]) => config.useNativeDriver === true);
    expect(native.length).toBeGreaterThan(0);
  });

  it('fast repeated tab changes just restart the motion - the selection always ends on the last tab', async () => {
    const { ref } = await renderTabs();
    await act(async () => {
      ref.navigate('Collections');
      ref.navigate('History');
      ref.navigate('MyPage');
      ref.navigate('Home');
      ref.navigate('MyPage');
    });
    expect(ref.getCurrentRoute()?.name).toBe('MyPage');
  });

  it('respects Reduce Motion: no icon pop, the selection just moves', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const { ref } = await renderTabs();
    const spring = jellyCalls('spring');
    const timing = jellyCalls('timing');
    await act(async () => { ref.navigate('History'); });
    expect(ref.getCurrentRoute()?.name).toBe('History');
    expect(spring).toHaveLength(0);
    expect(timing).toHaveLength(0);
  });
});
