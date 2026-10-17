import ReactTestRenderer, { act } from 'react-test-renderer';
import type { HostInstance } from 'react-native';
import { AccessibilityInfo, BackHandler, Text, View } from 'react-native';
import i18n from '../../i18n';
import { getActiveColorScheme, setActiveColorScheme } from '../../theme/tokens';
import { TourHost } from '../TourHost';
import { endTour, getActiveTour, startTour } from '../tourController';
import { hasCompletedTour, tourCompletedKey } from '../tourPreference';
import { registerTourTarget, unregisterTourTarget } from '../tourTargets';

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
