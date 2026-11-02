import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { getItemHistory, type ItemHistoryEntry } from '../api/itemsApi';
import { useArchiveSearch, type ArchiveSearchState } from '../useArchiveSearch';

let mockFocus = () => {};
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => {
    require('react').useEffect(() => { mockFocus = callback; callback(); }, [callback]);
  },
}));
jest.mock('../api/itemsApi', () => ({ getItemHistory: jest.fn() }));
const item = (id: number) => ({ id, url: `https://example.test/${id}`, savedAtUtc: '2026-11-02T01:00:00Z' } as ItemHistoryEntry);
let state: ArchiveSearchState;
function Probe({ query = '' }: { query?: string }) { state = useArchiveSearch(query); return null; }
async function mount() { let renderer!: ReactTestRenderer; await act(async () => { renderer = create(<Probe />); }); return renderer; }

beforeEach(() => { jest.mocked(getItemHistory).mockReset().mockResolvedValue({ items: [item(1)], nextCursor: 'next' }); });

it('mount shares one read; re-entering after Home saves a link reads the current first page without clearing visible rows', async () => {
  await mount();
  expect(getItemHistory).toHaveBeenCalledTimes(1);
  await act(async () => state.loadMore());
  let resolve!: (value: { items: ItemHistoryEntry[]; nextCursor: string | null }) => void;
  jest.mocked(getItemHistory).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  act(() => { mockFocus(); mockFocus(); });
  expect(getItemHistory).toHaveBeenCalledTimes(3); // first page, next page, ONE shared focus read
  expect(state.items.map(row => row.id)).toEqual([1]);
  await act(async () => resolve({ items: [item(2), item(1)], nextCursor: null }));
  expect(state.items.map(row => row.id)).toEqual([2, 1]);
});

it('a focus refresh failure preserves successful data and an explicit retry recovers', async () => {
  await mount();
  jest.mocked(getItemHistory).mockRejectedValueOnce(new Error('offline'));
  await act(async () => mockFocus());
  expect(state.error).toBe(true);
  expect(state.items.map(row => row.id)).toEqual([1]);
  jest.mocked(getItemHistory).mockResolvedValueOnce({ items: [item(3)], nextCursor: null });
  await act(async () => state.refresh());
  expect(state.error).toBe(false);
  expect(state.items.map(row => row.id)).toEqual([3]);
});

it('returning during search debounce does not issue another identical request when the old timer expires', async () => {
  jest.useFakeTimers();
  try {
    const renderer = await mount();
    await act(async () => renderer.update(<Probe query="latest" />));
    await act(async () => mockFocus());
    expect(getItemHistory).toHaveBeenCalledTimes(2);
    await act(async () => jest.advanceTimersByTime(350));
    expect(getItemHistory).toHaveBeenCalledTimes(2);
    expect(jest.mocked(getItemHistory).mock.calls[1][1]?.q).toBe('latest');
  } finally {
    jest.useRealTimers();
  }
});
