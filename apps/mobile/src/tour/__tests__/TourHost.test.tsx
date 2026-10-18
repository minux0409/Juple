import ReactTestRenderer, { act } from 'react-test-renderer';
import type { HostInstance } from 'react-native';
import { AccessibilityInfo, BackHandler, Text, View } from 'react-native';
import i18n from '../../i18n';
import { colors, darkColors, getActiveColorScheme, lightColors, setActiveColorScheme } from '../../theme/tokens';
import { TourHost } from '../TourHost';
import { endTour, getActiveTour, startTour } from '../tourController';
import { hasCompletedTour, tourCompletedKey } from '../tourPreference';
import { registerTourTarget, unregisterTourTarget } from '../tourTargets';
import { StyleSheet } from 'react-native';
import { DEFAULT_TOUR_TARGET_RADIUS, TOUR_SPOTLIGHT_PADDING } from '../tourPlacement';

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
}));
const mockNavigate = jest.fn();
jest.mock('../../navigation/navigationRef', () => ({
  navigationRef: { isReady: () => true, navigate: (...args: unknown[]) => mockNavigate(...args) },
}));

const fakeNode = (rect: { x: number; y: number; width: number; height: number }) =>
  ({ measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(rect.x, rect.y, rect.width, rect.height) }) as unknown as HostInstance;

const TARGETS: Record<string, { x: number; y: number; width: number; height: number }> = {
  'home.input': { x: 16, y: 120, width: 368, height: 56 },
  'tab.collections': { x: 120, y: 740, width: 60, height: 40 },
  'tab.history': { x: 200, y: 740, width: 60, height: 40 },
  'tab.myPage': { x: 300, y: 740, width: 60, height: 40 },
};
let registered: [string, HostInstance][] = [];

let backHandlers: (() => boolean)[] = [];
const hosts: ReactTestRenderer.ReactTestRenderer[] = [];

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
beforeEach(() => {
  // React Native's Jest View keeps measureInWindow on its prototype as a jest.fn; the overlay measures itself with it.
  (View as unknown as { prototype: { measureInWindow: jest.Mock } }).prototype.measureInWindow.mockImplementation((callback: (x: number, y: number, width: number, height: number) => void) => callback(0, 0, 400, 800));
  mockStore.clear();
  mockNavigate.mockClear();
  backHandlers = [];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    backHandlers.push(handler as () => boolean);
    return { remove: () => undefined };
  });
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  registered = Object.entries(TARGETS).map(([id, rect]) => [id, fakeNode(rect)] as [string, HostInstance]);
  registered.forEach(([id, node]) => registerTourTarget(id, node));
});
afterEach(() => {
  act(() => {
    endTour();
    hosts.splice(0).forEach(host => host.unmount());
  });
  registered.forEach(([id, node]) => unregisterTourTarget(id, node));
  jest.useRealTimers();
  jest.restoreAllMocks();
  setActiveColorScheme('light');
});

async function renderHost() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<TourHost />);
  });
  hosts.push(renderer);
  return renderer;
}
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
const exists = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID).length > 0;
const press = async (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => {
  const node = renderer.root.find(item => item.props.testID === testID && typeof item.props.onPress === 'function');
  await act(async () => {
    node.props.onPress();
  });
  await flush();
};
const texts = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children));
const start = async (id: string, options?: { userKey?: string }) => {
  await act(async () => {
    startTour(id, options);
  });
  await flush();
};

describe('TourHost - flow', () => {
  it('renders nothing until a tour starts, then shows the first step with its progress', async () => {
    const renderer = await renderHost();
    expect(exists(renderer, 'tour-overlay')).toBe(false);
    await start('mainOnboarding');
    expect(exists(renderer, 'tour-overlay')).toBe(true);
    expect(exists(renderer, 'tour-spotlight')).toBe(true);
    expect(texts(renderer)).toContain(i18n.t('tour.steps.home.title'));
    expect(texts(renderer)).toContain('1 / 5');
    expect(exists(renderer, 'tour-previous')).toBe(false);
  });

  it('moves with 다음 / 이전 and ends with 완료', async () => {
    const renderer = await renderHost();
    await start('mainOnboarding');
    await press(renderer, 'tour-next');
    expect(texts(renderer)).toContain(i18n.t('tour.steps.share.title'));
    expect(exists(renderer, 'tour-spotlight')).toBe(false);
    await press(renderer, 'tour-previous');
    expect(texts(renderer)).toContain(i18n.t('tour.steps.home.title'));
    for (let i = 0; i < 4; i += 1) {
      await press(renderer, 'tour-next');
    }
    expect(texts(renderer)).toContain('5 / 5');
    expect(texts(renderer)).toContain(i18n.t('tour.done'));
    await press(renderer, 'tour-next');
    expect(getActiveTour()).toBeNull();
    expect(exists(renderer, 'tour-overlay')).toBe(false);
  });

  it('건너뛰기 ends the tour at any step', async () => {
    const renderer = await renderHost();
    await start('collections');
    await press(renderer, 'tour-skip');
    expect(getActiveTour()).toBeNull();
  });

  it('Android back skips the tour instead of leaving the app or the screen', async () => {
    const renderer = await renderHost();
    await start('mainOnboarding');
    expect(backHandlers.length).toBeGreaterThan(0);
    let handled = false;
    await act(async () => {
      handled = backHandlers[backHandlers.length - 1]();
    });
    expect(handled).toBe(true);
    expect(getActiveTour()).toBeNull();
    expect(exists(renderer, 'tour-overlay')).toBe(false);
  });

  it('a step that lives on another screen navigates there first (route change)', async () => {
    await renderHost();
    await start('friends');
    expect(mockNavigate).toHaveBeenCalledWith('MainTabs', { screen: 'MyPage' });
  });
});

describe('TourHost - persistence', () => {
  it('remembers finishing OR skipping the automatic tour, per person and version, on this device only', async () => {
    const renderer = await renderHost();
    expect(await hasCompletedTour('mainOnboarding', 1, 'JUPLE-1')).toBe(false);
    await start('mainOnboarding', { userKey: 'JUPLE-1' });
    await press(renderer, 'tour-skip');
    expect(mockStore.get(tourCompletedKey('mainOnboarding', 1, 'JUPLE-1'))).toBe('true');
    expect(await hasCompletedTour('mainOnboarding', 1, 'JUPLE-1')).toBe(true);
    expect(await hasCompletedTour('mainOnboarding', 1, 'JUPLE-2')).toBe(false);
    expect(await hasCompletedTour('mainOnboarding', 2, 'JUPLE-1')).toBe(false);
  });

  it('a tour started from Help records nothing and can run again and again', async () => {
    const renderer = await renderHost();
    await start('saveLink');
    await press(renderer, 'tour-skip');
    await start('saveLink');
    expect(exists(renderer, 'tour-overlay')).toBe(true);
    await press(renderer, 'tour-skip');
    expect(mockStore.size).toBe(0);
  });

  it('an unknown guide id starts nothing', () => {
    expect(startTour('doesNotExist')).toBe(false);
    expect(getActiveTour()).toBeNull();
  });

  it('a storage failure counts as completed, so a tour never loops', async () => {
    const storage = jest.requireMock('@react-native-async-storage/async-storage') as { getItem: jest.Mock };
    storage.getItem.mockRejectedValueOnce(new Error('disk'));
    expect(await hasCompletedTour('mainOnboarding', 1, 'JUPLE-1')).toBe(true);
  });
});

describe('TourHost - missing or unmeasurable targets', () => {
  it('shows the explanation centred, without a spotlight, when the target never appears', async () => {
    jest.useFakeTimers();
    registered.forEach(([id, node]) => unregisterTourTarget(id, node));
    const renderer = await renderHost();
    await act(async () => {
      startTour('saveLink');
    });
    for (let i = 0; i < 25; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
    }
    expect(exists(renderer, 'tour-spotlight')).toBe(false);
    expect(exists(renderer, 'tour-card')).toBe(true);
    expect(texts(renderer)).toContain(i18n.t('tour.steps.inputLink.title'));
    // The tour itself did not crash and can still be moved through.
    await press(renderer, 'tour-next');
    expect(texts(renderer)).toContain(i18n.t('tour.steps.reviewSave.title'));
  });

  it('treats a zero-size measurement like a missing target', async () => {
    jest.useFakeTimers();
    registerTourTarget('home.input', fakeNode({ x: 0, y: 0, width: 0, height: 0 }));
    const renderer = await renderHost();
    await act(async () => {
      startTour('saveLink');
    });
    for (let i = 0; i < 25; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
    }
    expect(exists(renderer, 'tour-spotlight')).toBe(false);
  });

  it('survives a measure call that throws', async () => {
    jest.useFakeTimers();
    registerTourTarget('home.input', { measureInWindow: () => { throw new Error('detached'); } } as unknown as HostInstance);
    const renderer = await renderHost();
    await act(async () => {
      startTour('saveLink');
    });
    for (let i = 0; i < 25; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
    }
    expect(exists(renderer, 'tour-card')).toBe(true);
  });
});

describe('TourHost - accessibility', () => {
  it('is a modal group for screen readers and announces the current step', async () => {
    const renderer = await renderHost();
    await start('mainOnboarding');
    const overlay = renderer.root.find(node => node.props.testID === 'tour-overlay');
    expect(overlay.props.accessibilityViewIsModal).toBe(true);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(expect.stringContaining(i18n.t('tour.steps.home.title')));
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(expect.stringContaining('1 / 5'));
  });

  it('the step title is a header and the buttons are buttons with text labels', async () => {
    const renderer = await renderHost();
    await start('mainOnboarding');
    const header = renderer.root.findAll(node => node.props.accessibilityRole === 'header');
    expect(header.length).toBeGreaterThan(0);
    for (const id of ['tour-skip', 'tour-next']) {
      expect(renderer.root.find(node => node.props.testID === id && typeof node.props.onPress === 'function').props.accessibilityRole).toBe('button');
    }
    expect(texts(renderer)).toContain(i18n.t('tutorial.skip'));
    expect(texts(renderer)).toContain(i18n.t('tutorial.next'));
  });
});

describe('TourHost - dark mode', () => {
  it('draws the scrim, card and spotlight with the active theme and leaves the target itself alone', async () => {
    setActiveColorScheme('dark');
    expect(getActiveColorScheme()).toBe('dark');
    const renderer = await renderHost();
    await start('mainOnboarding');
    const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(3).filter(Boolean) as object[]);
    const scrimStyles = renderer.root.findAll(node => typeof node.type === 'string' && flat(node.props.style).backgroundColor === 'rgba(0, 0, 0, 0.62)');
    expect(scrimStyles.length).toBeGreaterThan(0);
    const card = renderer.root.find(node => node.props.testID === 'tour-card');
    expect(flat(card.props.style).backgroundColor).not.toBe('#ffffff');
    // The ring is a border drawn AROUND the target; no node covers the target with a tint.
    const ring = renderer.root.find(node => node.props.testID === 'tour-spotlight');
    expect(flat(ring.props.style).backgroundColor).toBeUndefined();
  });
});

describe('TourHost - measuring', () => {
  it('measures a found target once, plus one settle re-measure - never repeatedly while nothing moves', async () => {
    jest.useFakeTimers();
    const node = { measureInWindow: jest.fn((cb: (...n: number[]) => void) => cb(16, 120, 368, 56)) };
    registerTourTarget('home.input', node as unknown as HostInstance);
    await renderHost();
    await act(async () => {
      startTour('saveLink');
    });
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(node.measureInWindow.mock.calls.length).toBeLessThanOrEqual(3);
  });
});

describe("TourHost - the spotlight ring follows the target's own corner radius", () => {
  const ringRadius = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    StyleSheet.flatten(renderer.root.find(node => node.props.testID === 'tour-spotlight' && typeof node.type === 'string').props.style).borderRadius;

  it('a target that declared a radius gets radius + padding (the Home input is a large rounded field)', async () => {
    registerTourTarget('home.input', registered.find(([id]) => id === 'home.input')![1], 20);
    const renderer = await renderHost();
    await start('mainOnboarding');
    expect(ringRadius(renderer)).toBe(20 + TOUR_SPOTLIGHT_PADDING);
  });

  it('a square target (radius 0) still gets the padding only; a target that declares nothing gets the default', async () => {
    registerTourTarget('home.input', registered.find(([id]) => id === 'home.input')![1], 0);
    const first = await renderHost();
    await start('mainOnboarding');
    expect(ringRadius(first)).toBe(TOUR_SPOTLIGHT_PADDING);
    act(() => endTour());
    registerTourTarget('home.input', registered.find(([id]) => id === 'home.input')![1]);
    await start('mainOnboarding');
    expect(ringRadius(first)).toBe(DEFAULT_TOUR_TARGET_RADIUS + TOUR_SPOTLIGHT_PADDING);
  });

  it('different targets get different radii on different steps', async () => {
    registerTourTarget('home.input', registered.find(([id]) => id === 'home.input')![1], 20);
    registerTourTarget('tab.collections', registered.find(([id]) => id === 'tab.collections')![1], 8);
    const renderer = await renderHost();
    await start('mainOnboarding');
    const homeRadius = ringRadius(renderer);
    await press(renderer, 'tour-next');
    await press(renderer, 'tour-next');
    expect(ringRadius(renderer)).not.toBe(homeRadius);
  });

  it('the position, size, scrim and hole of the spotlight are unchanged by the radius', async () => {
    registerTourTarget('home.input', registered.find(([id]) => id === 'home.input')![1], 20);
    const renderer = await renderHost();
    await start('mainOnboarding');
    const ring = StyleSheet.flatten(renderer.root.find(node => node.props.testID === 'tour-spotlight' && typeof node.type === 'string').props.style);
    expect(ring).toMatchObject({ left: 16 - TOUR_SPOTLIGHT_PADDING, top: 120 - TOUR_SPOTLIGHT_PADDING, width: 368 + 2 * TOUR_SPOTLIGHT_PADDING, height: 56 + 2 * TOUR_SPOTLIGHT_PADDING, borderWidth: 2 });
  });
});

describe('TourHost - the dimmed area is rounded like the ring', () => {
  const node = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => renderer.root.findAll(item => item.props.testID === testID && typeof item.type === 'string');
  const ringRadius = (renderer: ReactTestRenderer.ReactTestRenderer) => StyleSheet.flatten(node(renderer, 'tour-spotlight')[0].props.style).borderRadius as number;
  const wedgeRingStyles = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    ['tl', 'tr', 'bl', 'br'].map(corner => {
      const box = node(renderer, `tour-corner-${corner}`)[0];
      return { box: StyleSheet.flatten(box.props.style), ring: StyleSheet.flatten(box.children.length ? (box.findAll(child => typeof child.type === 'string' && child !== box)[0]?.props.style) : undefined) };
    });
  const nodeFor = (id: string) => registered.find(([key]) => key === id)![1];

  it('a rounded target gets four corner pieces whose radius IS the ring radius (one value for both)', async () => {
    registerTourTarget('home.input', nodeFor('home.input'), 20);
    const renderer = await renderHost();
    await start('mainOnboarding');
    const radius = ringRadius(renderer);
    expect(radius).toBe(26);
    const pieces = wedgeRingStyles(renderer);
    expect(pieces).toHaveLength(4);
    for (const { box, ring } of pieces) {
      // The piece is the radius-sized corner square; its ring has the same radius as inner radius (border width) and 2x as outer.
      expect(box.width).toBe(radius);
      expect(box.height).toBe(radius);
      expect(ring.borderWidth).toBe(radius);
      expect(ring.width).toBe(4 * radius);
      expect(ring.borderRadius).toBe(2 * radius);
    }
  });

  it('a square target (radius 0) keeps a plain rectangle: the ring has the padding radius only and there is a corner piece for it too', async () => {
    registerTourTarget('home.input', nodeFor('home.input'), 0);
    const renderer = await renderHost();
    await start('mainOnboarding');
    expect(ringRadius(renderer)).toBe(6);
    expect(node(renderer, 'tour-corner-tl')[0].props.style).toBeDefined();
    expect(StyleSheet.flatten(node(renderer, 'tour-corner-tl')[0].props.style).width).toBe(6);
  });

  it('a pill is clamped to half the spotlight height, for the ring and the pieces alike', async () => {
    registerTourTarget('home.input', nodeFor('home.input'), 500);
    const renderer = await renderHost();
    await start('mainOnboarding');
    const half = (56 + 12) / 2;
    expect(ringRadius(renderer)).toBe(half);
    expect(StyleSheet.flatten(node(renderer, 'tour-corner-tl')[0].props.style).width).toBe(half);
  });

  it('a target that declares nothing uses the default radius for both', async () => {
    const renderer = await renderHost();
    await start('mainOnboarding');
    expect(ringRadius(renderer)).toBe(14);
    expect(StyleSheet.flatten(node(renderer, 'tour-corner-tl')[0].props.style).width).toBe(14);
  });

  it('the pieces follow the step: another target, another radius', async () => {
    registerTourTarget('home.input', nodeFor('home.input'), 20);
    registerTourTarget('tab.collections', nodeFor('tab.collections'), 8);
    const renderer = await renderHost();
    await start('mainOnboarding');
    const first = StyleSheet.flatten(node(renderer, 'tour-corner-tl')[0].props.style).width;
    await press(renderer, 'tour-next');
    await press(renderer, 'tour-next');
    expect(StyleSheet.flatten(node(renderer, 'tour-corner-tl')[0].props.style).width).not.toBe(first);
    expect(StyleSheet.flatten(node(renderer, 'tour-corner-tl')[0].props.style).width).toBe(ringRadius(renderer));
  });

  it('the dimming colour is the theme scrim (Light and Dark), the rectangles and the spotlight position are unchanged', async () => {
    registerTourTarget('home.input', nodeFor('home.input'), 20);
    for (const [scheme, palette] of [['light', lightColors], ['dark', darkColors]] as const) {
      setActiveColorScheme(scheme);
      const renderer = await renderHost();
      await start('mainOnboarding');
      const ring = wedgeRingStyles(renderer)[0].ring;
      expect(ring.borderColor).toBe(palette.scrim);
      expect(ring.borderColor).toBe(colors.scrim);
      const scrimRects = renderer.root.findAll(item => typeof item.type === 'string' && item.props.style !== undefined && StyleSheet.flatten(item.props.style).backgroundColor === palette.scrim);
      expect(scrimRects).toHaveLength(4);
      expect(StyleSheet.flatten(node(renderer, 'tour-spotlight')[0].props.style)).toMatchObject({ left: 10, top: 114, width: 380, height: 68 });
      act(() => endTour());
    }
  });

  it('the pieces never take a touch (the blocking hole is unchanged)', async () => {
    registerTourTarget('home.input', nodeFor('home.input'), 20);
    const renderer = await renderHost();
    await start('mainOnboarding');
    expect(node(renderer, 'tour-corner-tl')[0].props.pointerEvents).toBe('none');
  });
});
