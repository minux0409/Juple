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

const pills = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(node => node.props.testID === 'jelly-tab-pill' && typeof node.type === 'string');

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

describe('the jelly tab indicator', () => {
  it('every tab has its pill behind the icon (both looks of the icon read the same motion); the start needs no animation', async () => {
    const spring = jellyCalls('spring');
    const timing = jellyCalls('timing');
    const { renderer } = await renderTabs();
    // One blob per tab button (behind icon and label).
    expect(pills(renderer)).toHaveLength(4);
    expect(spring).toHaveLength(0);
    expect(timing).toHaveLength(0);
    // Only the selected look of an icon pops (its wrapper scales); the unselected look never does.
    const homeIcons = renderer.root.findAllByType(HomeIcon as never);
    const wrappersWithScale = homeIcons.filter(icon => {
      const transform = icon.parent?.props.style?.transform as { scale?: unknown }[] | undefined;
      return Array.isArray(transform) && transform.some(entry => 'scale' in entry);
    });
    expect(wrappersWithScale.map(icon => icon.props.filled)).toEqual([true]);
  });

  it('choosing a tab springs the new pill and icon in and lets the old pill shrink away - on the native driver, without holding up the switch', async () => {
    const spring = jellyCalls('spring');
    const timing = jellyCalls('timing');
    const { ref } = await renderTabs();
    await act(async () => { ref.navigate('Collections'); });
    expect(ref.getCurrentRoute()?.name).toBe('CollectionsHome');
    // New tab: the pill flows in from the previous tab (travel), the pill, its squash and the icon pop settle with springs (4); the squash and pop start with a short press-in (2);
    // old tab: a timed shrink of its pill, squash and icon (3).
    expect(spring).toHaveLength(4);
    expect(timing).toHaveLength(6);
    for (const [, config] of [...spring, ...timing]) {
      expect(config.useNativeDriver).toBe(true);
    }
    // The longest timed step is short (the whole motion ~200-350ms).
    expect(Math.max(...timing.map(([, config]) => config.duration ?? 0))).toBeLessThanOrEqual(200);
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

  it('respects Reduce Motion: the pill moves straight to the new tab, no spring or timing', async () => {
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
