import ReactTestRenderer, { act } from 'react-test-renderer';
import i18n from '../../i18n';
import { getItemHistory, type ItemHistoryEntry, type ItemHistoryPage } from '../api/itemsApi';
import { groupHistoryByLocalDate } from '../historyDateGrouping';
import { useItemHistory, type UseItemHistoryResult } from '../useItemHistory';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
}));
jest.mock('../../api/useAuthenticatedApi', () => {
  const request = jest.fn();
  return { useAuthenticatedApi: () => request };
});
jest.mock('../api/itemsApi', () => ({
  ...jest.requireActual('../api/itemsApi'),
  getItemHistory: jest.fn(),
}));

const PAGE = 50;

function entry(id: number, savedAtUtc = `2026-09-${String(25 - Math.floor(id / 1000)).padStart(2, '0')}T12:00:00Z`): ItemHistoryEntry {
  return { id, url: `https://example.test/${id}`, title: `Link ${id}`, memo: null, savedAtUtc, representativeImage: null, previewImageUrl: null, coverImage: null };
}

/** Newest first: page n holds ids n*50+1..(n+1)*50; every page but the last has a cursor. */
function pageOf(index: number, total: number): ItemHistoryPage {
  const start = index * PAGE;
  const items = Array.from({ length: Math.min(PAGE, total - start) }, (_, offset) => entry(start + offset + 1));
  return { items, nextCursor: start + PAGE < total ? `cursor-${index + 1}` : null };
}

function serveHistory(total: number) {
  jest.mocked(getItemHistory).mockImplementation(async (_request, options = {}) => {
    const index = options.cursor ? Number(options.cursor.replace('cursor-', '')) : 0;
    return pageOf(index, total);
  });
}

let latest: UseItemHistoryResult;
function Harness() {
  latest = useItemHistory();
  return null;
}

async function mount() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<Harness />);
  });
  return renderer;
}

const cursorsRequested = () => jest.mocked(getItemHistory).mock.calls.map(call => call[1]?.cursor ?? null);

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

afterEach(() => jest.clearAllMocks());

describe('useItemHistory - transparent infinite loading', () => {
  it('loads the first 50 and prefetches exactly one more page in the background - never everything', async () => {
    serveHistory(1000);
    await mount();

    expect(latest.items).toHaveLength(100);
    expect(cursorsRequested()).toEqual([null, 'cursor-1']);
    expect(latest.hasMore).toBe(true);
  });

  it('each scroll to the end appends the next page in order, through the third page and beyond', async () => {
    serveHistory(1000);
    await mount();

    await act(async () => {
      latest.loadMore();
    });
    expect(latest.items).toHaveLength(150);
    await act(async () => {
      latest.loadMore();
    });
    expect(latest.items).toHaveLength(200);
    expect(latest.items.map(item => item.id)).toEqual(Array.from({ length: 200 }, (_, index) => index + 1));
    expect(cursorsRequested()).toEqual([null, 'cursor-1', 'cursor-2', 'cursor-3']);
  });

  it('stops at the last page - no request without a cursor', async () => {
    serveHistory(120);
    await mount();
    await act(async () => {
      latest.loadMore();
    });

    expect(latest.items).toHaveLength(120);
    expect(latest.hasMore).toBe(false);
    const calls = jest.mocked(getItemHistory).mock.calls.length;
    await act(async () => {
      latest.loadMore();
    });
    expect(jest.mocked(getItemHistory).mock.calls.length).toBe(calls);
  });

  it('repeated onEndReached while a page is loading requests that page once', async () => {
    serveHistory(1000);
    await mount();
    let release!: () => void;
    jest.mocked(getItemHistory).mockImplementationOnce(
      () => new Promise(resolve => {
        release = () => resolve(pageOf(2, 1000));
      }),
    );

    await act(async () => {
      latest.loadMore();
      latest.loadMore();
      latest.loadMore();
    });
    await act(async () => {
      release();
    });

    expect(cursorsRequested().filter(cursor => cursor === 'cursor-2')).toHaveLength(1);
    expect(new Set(latest.items.map(item => item.id)).size).toBe(latest.items.length);
  });

  it('a refresh starts over from the first page, and a page still loading for the old list is ignored', async () => {
    serveHistory(1000);
    await mount();
    let releaseStale!: () => void;
    jest.mocked(getItemHistory).mockImplementationOnce(
      () => new Promise(resolve => {
        releaseStale = () => resolve({ items: [entry(99_999)], nextCursor: 'stale' });
      }),
    );
    await act(async () => {
      latest.loadMore(); // page 3 in flight for the old list
    });

    await act(async () => {
      latest.refresh();
    });
    await act(async () => {
      releaseStale();
    });

    expect(latest.items.some(item => item.id === 99_999)).toBe(false);
    expect(latest.items).toHaveLength(100); // fresh first page + its one prefetched page
    expect(latest.items[0].id).toBe(1);
  });

  it('a result arriving after the screen is gone is dropped', async () => {
    serveHistory(1000);
    const renderer = await mount();
    let release!: () => void;
    jest.mocked(getItemHistory).mockImplementationOnce(
      () => new Promise(resolve => {
        release = () => resolve(pageOf(2, 1000));
      }),
    );
    await act(async () => {
      latest.loadMore();
    });
    const before = latest.items.length;

    await act(async () => {
      renderer.unmount();
      release();
    });

    expect(latest.items).toHaveLength(before);
  });
});

describe('History date sections across page boundaries', () => {
  it('a date group split between two pages stays one section with one header and a stable key', () => {
    const t = i18n.t.bind(i18n);
    const sameDay = '2026-03-02T10:00:00Z';
    const firstPage = [entry(1, sameDay), entry(2, sameDay)];
    const secondPage = [entry(3, sameDay), entry(4, '2026-02-10T10:00:00Z')];

    const before = groupHistoryByLocalDate(firstPage, t);
    const after = groupHistoryByLocalDate([...firstPage, ...secondPage], t);

    const keys = after.map(section => section.dateKey);
    expect(new Set(keys).size).toBe(keys.length);
    const merged = after.find(section => section.items.some(item => item.id === 1))!;
    expect(merged.items.map(item => item.id)).toEqual([1, 2, 3]);
    expect(merged.dateKey).toBe(before.find(section => section.items.some(item => item.id === 1))!.dateKey);
  });
});
