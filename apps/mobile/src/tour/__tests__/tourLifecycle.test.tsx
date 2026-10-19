import ReactTestRenderer, { act } from 'react-test-renderer';
import { View } from 'react-native';
import i18n from '../../i18n';
import { TourBackground } from '../TourBackground';
import { TourHost } from '../TourHost';
import { cancelTour, endTour, getActiveTour, startTour } from '../tourController';
import { TOUR_GUIDES, TOUR_TARGETS } from '../tourGuides';
import { hasCompletedTour } from '../tourPreference';
import { measureTourTarget, useTourTarget } from '../tourTargets';

const mockStore = new Map<string, string>();
const fs = jest.requireActual<{ readFileSync(file: string, encoding: string): string; readdirSync(dir: string, options: { withFileTypes: true }): { name: string; isDirectory(): boolean }[] }>('fs');
const path = jest.requireActual<{ join(...parts: string[]): string }>('path');

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
}));
jest.mock('../../navigation/navigationRef', () => ({ navigationRef: { isReady: () => false, navigate: jest.fn() } }));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
beforeEach(() => {
  mockStore.clear();
});
afterEach(() => {
  act(() => {
    cancelTour();
  });
});

const background = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.find(node => node.props.testID === 'tour-background' && typeof node.type === 'string');

describe('TourBackground - screen readers cannot reach the app behind a blocking step', () => {
  it('hides the background from TalkBack and VoiceOver while a tour runs, and gives it back when the tour ends', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <TourBackground>
          <View testID="app" />
        </TourBackground>,
      );
    });
    expect(background(renderer).props.importantForAccessibility).toBe('auto');
    expect(background(renderer).props.accessibilityElementsHidden).toBe(false);
    await act(async () => {
      startTour('saveLink');
    });
    expect(background(renderer).props.importantForAccessibility).toBe('no-hide-descendants');
    expect(background(renderer).props.accessibilityElementsHidden).toBe(true);
    await act(async () => {
      endTour();
    });
    expect(background(renderer).props.importantForAccessibility).toBe('auto');
    expect(background(renderer).props.accessibilityElementsHidden).toBe(false);
  });

  it('is restored by a cancelled tour as well (sign-out)', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<TourBackground><View /></TourBackground>);
    });
    await act(async () => {
      startTour('collections');
    });
    await act(async () => {
      cancelTour();
    });
    expect(background(renderer).props.importantForAccessibility).toBe('auto');
  });

  it('keeps the app reachable on a passThrough step (the person is asked to use the highlighted element)', async () => {
    const guides = TOUR_GUIDES as unknown as { id: string; version: number; steps: { key: string; interaction?: string }[] }[];
    guides.push({ id: 'testPassThrough', version: 1, steps: [{ key: 'home', interaction: 'passThrough' }] });
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<TourBackground><View /></TourBackground>);
    });
    await act(async () => {
      startTour('testPassThrough');
    });
    expect(background(renderer).props.importantForAccessibility).toBe('auto');
    guides.pop();
  });

  it('the overlay is outside the hidden wrapper, so it stays reachable', () => {
    const root = fs.readFileSync(path.join(__dirname, '..', '..', 'navigation', 'RootStack.tsx'), 'utf8');
    const wrapped = root.slice(root.indexOf('<TourBackground>'), root.indexOf('</TourBackground>'));
    expect(wrapped).toMatch(/<Stack\.Navigator[ >]/);
    expect(wrapped).not.toContain('<TourHost');
    expect(root).toMatch(/<TourHost \/>/);
  });
});

describe('tour lifecycle', () => {
  it('a tour that is cancelled (the app behind it went away) records nothing, so the next person is never affected', async () => {
    await act(async () => {
      startTour('mainOnboarding', { userKey: 'JUPLE-1' });
    });
    await act(async () => {
      cancelTour();
    });
    expect(getActiveTour()).toBeNull();
    expect(await hasCompletedTour('mainOnboarding', 1, 'JUPLE-1')).toBe(false);
    expect(mockStore.size).toBe(0);
  });

  it('unmounting the host (sign-out) cancels a running tour without recording it', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<TourHost />);
    });
    await act(async () => {
      startTour('mainOnboarding', { userKey: 'JUPLE-1' });
    });
    expect(getActiveTour()).not.toBeNull();
    await act(async () => {
      renderer.unmount();
    });
    expect(getActiveTour()).toBeNull();
    expect(mockStore.size).toBe(0);
  });

  it("completion is per person: finishing as one person does not finish it for the next account", async () => {
    await act(async () => {
      startTour('mainOnboarding', { userKey: 'JUPLE-1' });
    });
    await act(async () => {
      endTour();
    });
    expect(await hasCompletedTour('mainOnboarding', 1, 'JUPLE-1')).toBe(true);
    expect(await hasCompletedTour('mainOnboarding', 1, 'JUPLE-2')).toBe(false);
  });

  it('a manual run (Help) records nothing and does not overwrite a finished record', async () => {
    mockStore.set('juple.tour.completed.mainOnboarding.v1.JUPLE-1', 'true');
    await act(async () => {
      startTour('mainOnboarding');
    });
    await act(async () => {
      endTour();
    });
    expect([...mockStore.entries()]).toEqual([['juple.tour.completed.mainOnboarding.v1.JUPLE-1', 'true']]);
  });
});

describe('tour targets - audit', () => {
  const srcDir = path.join(__dirname, '..', '..');
  const listFiles = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === '__tests__' || entry.name === 'tour' ? [] : listFiles(full);
      }
      return /\.tsx$/.test(entry.name) ? [full] : [];
    });
  const appSource = listFiles(srcDir).map(file => fs.readFileSync(file, 'utf8')).join('\n');

  it('has no duplicate ids', () => {
    const values = Object.values(TOUR_TARGETS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('every target is named by a guide step (nothing registered for no reason)', () => {
    const used = new Set(TOUR_GUIDES.flatMap(guide => guide.steps.map(step => step.targetId)));
    for (const [name, id] of Object.entries(TOUR_TARGETS)) {
      expect(used.has(id)).toBe(true);
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('every target is marked by exactly one screen element, and every step points at a defined target', () => {
    for (const key of Object.keys(TOUR_TARGETS)) {
      const marks = appSource.match(new RegExp(`TOUR_TARGETS\\.${key}\\b`, 'g')) ?? [];
      expect(marks).toHaveLength(1);
    }
    const defined = new Set<string>(Object.values(TOUR_TARGETS));
    for (const guide of TOUR_GUIDES) {
      for (const step of guide.steps) {
        if (step.targetId) {
          expect(defined.has(step.targetId)).toBe(true);
        }
      }
    }
  });
});

describe('tour targets - registry', () => {
  function Marked({ id, show }: { id: string; show: boolean }) {
    const target = useTourTarget(id);
    return show ? <View {...target} /> : null;
  }
  // React Native's Jest View keeps measureInWindow on its prototype as a jest.fn.
  const measureWith = (rect: [number, number, number, number]) =>
    (View as unknown as { prototype: { measureInWindow: jest.Mock } }).prototype.measureInWindow.mockImplementation((cb: (...n: number[]) => void) => cb(...rect));

  it('forgets an element when it goes away (no stale reference is measured afterwards)', async () => {
    measureWith([1, 2, 30, 40]);
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<Marked id="audit.one" show />);
    });
    expect(await measureTourTarget('audit.one')).toEqual({ x: 1, y: 2, width: 30, height: 40 });
    await act(async () => {
      renderer.update(<Marked id="audit.one" show={false} />);
    });
    expect(await measureTourTarget('audit.one')).toBeNull();
  });

  it('measures nothing for an unknown id or an element with no size', async () => {
    expect(await measureTourTarget('audit.unknown')).toBeNull();
    measureWith([0, 0, 0, 0]);
    await act(async () => {
      ReactTestRenderer.create(<Marked id="audit.empty" show />);
    });
    expect(await measureTourTarget('audit.empty')).toBeNull();
  });
});

describe('tour target layout signal (no polling)', () => {
  it('notifies only the subscribers of that target, and unsubscribes cleanly', () => {
    const { subscribeTourTargetLayout } = jest.requireActual('../tourTargets');
    const one = jest.fn();
    const other = jest.fn();
    const off = subscribeTourTargetLayout('perf.one', one);
    subscribeTourTargetLayout('perf.other', other)();
    function Marked() {
      const target = useTourTarget('perf.one');
      return <View {...target} />;
    }
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<Marked />);
    });
    renderer.root.findByType(View).props.onLayout();
    expect(one).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    off();
    renderer.root.findByType(View).props.onLayout();
    expect(one).toHaveBeenCalledTimes(1);
  });

  it('the tour host has no interval that re-measures targets', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'TourHost.tsx'), 'utf8');
    expect(source).not.toMatch(/setInterval/);
  });
});
