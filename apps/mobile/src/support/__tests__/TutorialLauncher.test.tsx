import ReactTestRenderer, { act } from 'react-test-renderer';
import { TutorialLauncher } from '../TutorialLauncher';
import { getMyProfile } from '../../api/profileApi';
import { navigationRef } from '../../navigation/navigationRef';
import { markTutorialCompleted } from '../../settings/tutorialPreference';

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
  navigationRef: { isReady: jest.fn(), getRootState: jest.fn(), navigate: jest.fn(), addListener: jest.fn() },
}));

const nav = navigationRef as unknown as { isReady: jest.Mock; getRootState: jest.Mock; navigate: jest.Mock; addListener: jest.Mock };
let stateListener: (() => void) | null = null;
const rootTop = (name: string) => ({ index: 0, routes: [{ name }] });

function profile(jupleId: string) {
  jest.mocked(getMyProfile).mockResolvedValue({ jupleId, displayName: null } as never);
}
async function mount() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<TutorialLauncher />);
  });
  return renderer;
}

beforeEach(() => {
  mockStore.clear();
  mockPendingShare = null;
  stateListener = null;
  nav.isReady.mockReturnValue(true);
  nav.getRootState.mockReturnValue(rootTop('MainTabs'));
  nav.addListener.mockImplementation((_event: string, listener: () => void) => {
    stateListener = listener;
    return () => undefined;
  });
});
afterEach(() => {
  jest.clearAllMocks();
});

describe('TutorialLauncher - tutorial v2 after v1', () => {
  it('a person who finished v1 is shown v2 once; the v1 record is neither reused nor migrated', async () => {
    mockStore.set('juple.tutorial.completed.v1.JUPLE-1', 'true');
    profile('JUPLE-1');
    await mount();
    expect(nav.navigate).toHaveBeenCalledWith('Tutorial', { mode: 'firstRun', userKey: 'JUPLE-1' });
    expect(mockStore.has('juple.tutorial.completed.v2.JUPLE-1')).toBe(false);
  });

  it('a person who already completed v2 is not shown it again', async () => {
    mockStore.set('juple.tutorial.completed.v2.JUPLE-1', 'true');
    profile('JUPLE-1');
    await mount();
    expect(nav.navigate).not.toHaveBeenCalled();
  });
});

describe('TutorialLauncher - first run', () => {
  it('shows the tutorial once for a person who has not finished it, keyed by their Juple ID', async () => {
    profile('JUPLE-1');
    await mount();
    expect(nav.navigate).toHaveBeenCalledTimes(1);
    expect(nav.navigate).toHaveBeenCalledWith('Tutorial', { mode: 'firstRun', userKey: 'JUPLE-1' });
  });

  it('renders nothing - it adds no screen of its own and waits for nothing', async () => {
    profile('JUPLE-1');
    const renderer = await mount();
    expect(renderer.toJSON()).toBeNull();
  });

  it('does not show again once completed (the next launch)', async () => {
    profile('JUPLE-1');
    await markTutorialCompleted('JUPLE-1');
    await mount();
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('another person on the same device still gets their own tutorial', async () => {
    await markTutorialCompleted('JUPLE-1');
    profile('JUPLE-2');
    await mount();
    expect(nav.navigate).toHaveBeenCalledWith('Tutorial', { mode: 'firstRun', userKey: 'JUPLE-2' });
  });

  it('a profile that cannot be read means no tutorial this time, without an error or blocking anything', async () => {
    jest.mocked(getMyProfile).mockRejectedValue(new Error('offline'));
    await expect(mount()).resolves.toBeDefined();
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('is only shown once, however often navigation changes afterwards', async () => {
    profile('JUPLE-1');
    await mount();
    await act(async () => {
      stateListener?.();
      stateListener?.();
    });
    expect(nav.navigate).toHaveBeenCalledTimes(1);
  });
});

describe('TutorialLauncher - never competes with where the app was asked to go', () => {
  it('a Collection share link in front is resolved first; the tutorial waits for the main tabs', async () => {
    nav.getRootState.mockReturnValue(rootTop('SharedCollection'));
    profile('JUPLE-1');
    await mount();
    expect(nav.navigate).not.toHaveBeenCalled();

    nav.getRootState.mockReturnValue(rootTop('MainTabs'));
    await act(async () => {
      stateListener?.();
    });
    expect(nav.navigate).toHaveBeenCalledTimes(1);
  });

  it('a pending incoming share is handled first (its review screen is not covered by the tutorial)', async () => {
    mockPendingShare = { id: 'share-1' };
    profile('JUPLE-1');
    await mount();
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('shows nothing while another screen (e.g. an item) is on top of the tabs', async () => {
    nav.getRootState.mockReturnValue(rootTop('ItemDetails'));
    profile('JUPLE-1');
    await mount();
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('is mounted by the root stack only once sign-in and bootstrap are complete (isReady), never in startup', () => {
    const source = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'navigation', 'RootStack.tsx'), 'utf8') as string;
    expect(source).toContain('{isReady ? <TutorialLauncher /> : null}');
  });
});
