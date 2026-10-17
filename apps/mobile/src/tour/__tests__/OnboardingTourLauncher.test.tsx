import ReactTestRenderer, { act } from 'react-test-renderer';
import { getMyProfile } from '../../api/profileApi';
import { navigationRef } from '../../navigation/navigationRef';
import { OnboardingTourLauncher } from '../OnboardingTourLauncher';
import { startTour } from '../tourController';
import { measureTourTarget } from '../tourTargets';

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
}));
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => jest.fn() }));
jest.mock('../../api/profileApi', () => ({ getMyProfile: jest.fn() }));
let mockPendingShare: { id: string } | null = null;
jest.mock('../../share/useIncomingShare', () => ({ useIncomingShare: () => ({ pendingShare: mockPendingShare }) }));
jest.mock('../../navigation/navigationRef', () => ({
  navigationRef: { isReady: jest.fn(), getRootState: jest.fn(), navigate: jest.fn() },
}));
jest.mock('../tourController', () => ({ startTour: jest.fn(() => true) }));
jest.mock('../tourTargets', () => ({ measureTourTarget: jest.fn() }));

const nav = navigationRef as unknown as { isReady: jest.Mock; getRootState: jest.Mock };
const measure = measureTourTarget as jest.Mock;
const rootTop = (name: string) => ({ index: 0, routes: [{ name }] });
const READY = { x: 16, y: 120, width: 360, height: 56 };

function profile(jupleId: string) {
  jest.mocked(getMyProfile).mockResolvedValue({ jupleId, displayName: null } as never);
}
async function mount() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<OnboardingTourLauncher />);
  });
  return renderer;
}
async function tick(ms = 300) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockStore.clear();
  mockPendingShare = null;
  nav.isReady.mockReturnValue(true);
  nav.getRootState.mockReturnValue(rootTop('MainTabs'));
  measure.mockResolvedValue(READY);
});
afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe('OnboardingTourLauncher - who gets the automatic tour', () => {
  it('a new person (no record of the old tutorial or of this tour) gets the main tour once Home can be measured', async () => {
    profile('JUPLE-1');
    await mount();
    await tick();
    expect(startTour).toHaveBeenCalledTimes(1);
    expect(startTour).toHaveBeenCalledWith('mainOnboarding', { userKey: 'JUPLE-1' });
    await tick(2000);
    expect(startTour).toHaveBeenCalledTimes(1);
  });

  it.each(['juple.tutorial.completed.v1.JUPLE-1', 'juple.tutorial.completed.v2.JUPLE-1', 'juple.tour.completed.mainOnboarding.v1.JUPLE-1'])(
    'an existing person (%s) never gets it',
    async key => {
      mockStore.set(key, 'true');
      profile('JUPLE-1');
      await mount();
      await tick(3000);
      expect(startTour).not.toHaveBeenCalled();
    },
  );

  it("another person's record on the same device does not count for this person", async () => {
    mockStore.set('juple.tutorial.completed.v2.JUPLE-OTHER', 'true');
    mockStore.set('juple.tour.completed.mainOnboarding.v1.JUPLE-OTHER', 'true');
    profile('JUPLE-2');
    await mount();
    await tick();
    expect(startTour).toHaveBeenCalledWith('mainOnboarding', { userKey: 'JUPLE-2' });
  });

  it('a profile that cannot be loaded starts nothing', async () => {
    jest.mocked(getMyProfile).mockRejectedValue(new Error('offline'));
    await mount();
    await tick(3000);
    expect(startTour).not.toHaveBeenCalled();
  });
});

describe('OnboardingTourLauncher - when it starts', () => {
  it('waits for Home to be measurable instead of a fixed delay, then starts', async () => {
    measure.mockResolvedValue(null);
    profile('JUPLE-1');
    await mount();
    await tick(1500);
    expect(startTour).not.toHaveBeenCalled();
    measure.mockResolvedValue(READY);
    await tick();
    expect(startTour).toHaveBeenCalledTimes(1);
    expect(measure).toHaveBeenCalledWith('home.input');
  });

  it('waits while the main tabs are not in front (a shared Collection, the review, the terms)', async () => {
    nav.getRootState.mockReturnValue(rootTop('SharedCollection'));
    profile('JUPLE-1');
    await mount();
    await tick(1500);
    expect(startTour).not.toHaveBeenCalled();
    nav.getRootState.mockReturnValue(rootTop('MainTabs'));
    await tick();
    expect(startTour).toHaveBeenCalledTimes(1);
  });

  it('waits while a share from another app is pending, and while navigation is not ready', async () => {
    mockPendingShare = { id: 'p' };
    nav.isReady.mockReturnValue(false);
    profile('JUPLE-1');
    const renderer = await mount();
    await tick(1500);
    expect(startTour).not.toHaveBeenCalled();
    nav.isReady.mockReturnValue(true);
    await tick();
    expect(startTour).not.toHaveBeenCalled();
    mockPendingShare = null;
    await act(async () => {
      renderer.update(<OnboardingTourLauncher />);
    });
    await tick();
    expect(startTour).toHaveBeenCalledTimes(1);
  });

  it('stops checking after unmount and gives up after a long wait (the next launch tries again)', async () => {
    measure.mockResolvedValue(null);
    profile('JUPLE-1');
    const renderer = await mount();
    await tick(125_000);
    measure.mockResolvedValue(READY);
    await tick(2000);
    expect(startTour).not.toHaveBeenCalled();
    renderer.unmount();
  });
});

describe('OnboardingTourLauncher - polling lifecycle', () => {
  it('stops polling once the tour has started (no further measures)', async () => {
    profile('JUPLE-1');
    await mount();
    await tick();
    expect(startTour).toHaveBeenCalledTimes(1);
    const calls = measure.mock.calls.length;
    await tick(3000);
    expect(measure.mock.calls.length).toBe(calls);
  });

  it('never stacks measures: a slow answer is awaited, not queued behind the next tick', async () => {
    let release!: (value: unknown) => void;
    measure.mockReturnValue(new Promise(resolve => { release = resolve; }));
    profile('JUPLE-1');
    await mount();
    await tick(3000);
    expect(measure).toHaveBeenCalledTimes(1);
    release(null);
    await tick();
  });

  it('stops measuring after the give-up time, and after unmount', async () => {
    measure.mockResolvedValue(null);
    profile('JUPLE-1');
    const renderer = await mount();
    await tick(125_000);
    const calls = measure.mock.calls.length;
    await tick(5000);
    expect(measure.mock.calls.length).toBe(calls);

    const other = await mount();
    await act(async () => {
      other.unmount();
    });
    const afterUnmount = measure.mock.calls.length;
    await tick(5000);
    expect(measure.mock.calls.length).toBe(afterUnmount);
    renderer.unmount();
  });
});
