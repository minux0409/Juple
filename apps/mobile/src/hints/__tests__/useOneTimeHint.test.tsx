import ReactTestRenderer, { act } from 'react-test-renderer';
import { HINT_VISIBLE_THRESHOLD_MS, useOneTimeHint, type OneTimeHint } from '../useOneTimeHint';
import type { HintId } from '../hintPreference';

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => {
    if (mockStore.get('__failRead') === 'true') {
      throw new Error('disk');
    }
    return mockStore.get(key) ?? null;
  }),
  setItem: jest.fn(async (key: string, value: string) => {
    if (mockStore.get('__failWrite') === 'true') {
      throw new Error('disk');
    }
    mockStore.set(key, value);
  }),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
}));
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => jest.fn() }));
const mockGetMyProfile = jest.fn();
jest.mock('../../api/profileApi', () => ({ getMyProfile: (...args: unknown[]) => mockGetMyProfile(...args) }));

let latest: Record<string, OneTimeHint> = {};
function Probe({ id, eligible, name }: { id: HintId; eligible: boolean; name: string }) {
  latest[name] = useOneTimeHint(id, eligible);
  return null;
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};
const seenKey = (id: HintId) => `juple.hint.${id}.v1.JUPLE-1`;

beforeEach(() => {
  jest.useFakeTimers();
  mockStore.clear();
  latest = {};
  mockGetMyProfile.mockReset();
  mockGetMyProfile.mockResolvedValue({ jupleId: 'JUPLE-1' });
});
afterEach(() => {
  jest.useRealTimers();
});

async function mount(id: HintId, eligible: boolean, name = 'a') {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<Probe eligible={eligible} id={id} name={name} />);
  });
  await flush();
  return renderer;
}

describe('useOneTimeHint', () => {
  it('shows an unseen hint when there is something to do it on', async () => {
    const renderer = await mount('savedLinkSwipe', true);
    expect(latest.a.isVisible).toBe(true);
    act(() => renderer.unmount());
  });

  it('shows nothing - and asks nobody who you are - for an empty list', async () => {
    const renderer = await mount('savedLinkSwipe', false);
    expect(latest.a.isVisible).toBe(false);
    expect(mockGetMyProfile).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it('leaving before the visibility threshold does not mark it seen', async () => {
    const renderer = await mount('savedLinkSwipe', true);
    act(() => {
      jest.advanceTimersByTime(HINT_VISIBLE_THRESHOLD_MS - 100);
    });
    act(() => renderer.unmount());
    act(() => {
      jest.advanceTimersByTime(HINT_VISIBLE_THRESHOLD_MS * 2);
    });
    await flush();
    expect(mockStore.has(seenKey('savedLinkSwipe'))).toBe(false);
  });

  it('staying visible past the threshold marks it seen', async () => {
    const renderer = await mount('savedLinkSwipe', true);
    await act(async () => {
      jest.advanceTimersByTime(HINT_VISIBLE_THRESHOLD_MS + 10);
    });
    await flush();
    expect(mockStore.get(seenKey('savedLinkSwipe'))).toBe('true');
    expect(latest.a.isVisible).toBe(false);
    act(() => renderer.unmount());
  });

  it('dismissing marks it seen immediately', async () => {
    const renderer = await mount('savedLinkSwipe', true);
    await act(async () => {
      latest.a.dismiss();
    });
    await flush();
    expect(mockStore.get(seenKey('savedLinkSwipe'))).toBe('true');
    expect(latest.a.isVisible).toBe(false);
    act(() => renderer.unmount());
  });

  it('performing the taught gesture marks it seen immediately', async () => {
    const renderer = await mount('collectionLongPress', true);
    await act(async () => {
      latest.a.markPerformed();
    });
    await flush();
    expect(mockStore.get(seenKey('collectionLongPress'))).toBe('true');
    expect(latest.a.isVisible).toBe(false);
    act(() => renderer.unmount());
  });

  it('a hint completed on Home also suppresses it on the Archive (one shared key)', async () => {
    const home = await mount('savedLinkSwipe', true, 'home');
    await act(async () => {
      latest.home.dismiss();
    });
    await flush();
    act(() => home.unmount());

    const archive = await mount('savedLinkSwipe', true, 'archive');
    expect(latest.archive.isVisible).toBe(false);
    act(() => archive.unmount());
  });

  it('the Collection hint stays independent of the swipe hint', async () => {
    mockStore.set(seenKey('savedLinkSwipe'), 'true');
    const renderer = await mount('collectionLongPress', true);
    expect(latest.a.isVisible).toBe(true);
    act(() => renderer.unmount());
  });

  it('never shows two hints at the same time', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <>
          <Probe eligible id="savedLinkSwipe" name="swipe" />
          <Probe eligible id="collectionLongPress" name="long" />
        </>,
      );
    });
    await flush();
    expect([latest.swipe.isVisible, latest.long.isVisible].filter(Boolean)).toHaveLength(1);
    act(() => renderer.unmount());
  });

  it('a storage read failure counts as already seen - no hint', async () => {
    mockStore.set('__failRead', 'true');
    const renderer = await mount('savedLinkSwipe', true);
    expect(latest.a.isVisible).toBe(false);
    act(() => renderer.unmount());
  });

  it('a storage write failure never crashes or blocks', async () => {
    const renderer = await mount('savedLinkSwipe', true);
    mockStore.set('__failWrite', 'true');
    await act(async () => {
      latest.a.dismiss();
    });
    await flush();
    expect(latest.a.isVisible).toBe(false);
    act(() => renderer.unmount());
  });

  it('is independent of the tutorial record: no tutorial key is read or written', async () => {
    const renderer = await mount('savedLinkSwipe', true);
    await act(async () => {
      latest.a.dismiss();
    });
    await flush();
    expect([...mockStore.keys()].filter(key => key.startsWith('juple.tutorial.'))).toEqual([]);
    act(() => renderer.unmount());
  });

  it('shows nothing when the person cannot be identified', async () => {
    mockGetMyProfile.mockRejectedValue(new Error('offline'));
    const renderer = await mount('savedLinkSwipe', true);
    expect(latest.a.isVisible).toBe(false);
    act(() => renderer.unmount());
  });
});
