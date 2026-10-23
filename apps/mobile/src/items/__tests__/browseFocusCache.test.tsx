import ReactTestRenderer, { act } from 'react-test-renderer';
import { useDateSectionPages, type UseDateSectionPagesResult } from '../useDateSectionPages';

const mockFocusCallbacks = new Set<() => void>();
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => require('react').useEffect(() => {
    mockFocusCallbacks.add(callback); callback();
    return () => mockFocusCallbacks.delete(callback);
  }, [callback]),
}));
const section = { key: 'today', kind: 'today' as const, year: null, month: null, fromUtc: '2026-10-22T15:00:00Z', toUtc: null, count: 50 };
let latest: UseDateSectionPagesResult<{ id: number }>;
let loadSections: jest.Mock;
let loadPage: jest.Mock;
function Host() {
  latest = useDateSectionPages({ loadSections, loadPage, idOf: item => item.id, errorMessage: () => 'failed' }, () => true, { focusCacheMs: 15000 });
  return null;
}
it('short detail returns reuse rows, later focus refreshes, and an explicit mutation refresh bypasses the cache', async () => {
  jest.useFakeTimers();
  try {
    loadSections = jest.fn(async () => [section]);
    loadPage = jest.fn(async () => ({ items: [{ id: 1 }], nextCursor: null }));
    await act(async () => { ReactTestRenderer.create(<Host />); });
    await act(async () => latest.ensureLoaded('today'));
    await act(async () => { for (let i = 0; i < 30; i++) for (const focus of mockFocusCallbacks) focus(); });
    expect(loadSections).toHaveBeenCalledTimes(1);
    expect(loadPage).toHaveBeenCalledTimes(1);
    expect(latest.pages.get('today')?.items).toEqual([{ id: 1 }]);
    await act(async () => latest.refresh());
    expect(loadSections).toHaveBeenCalledTimes(2);
    expect(loadPage).toHaveBeenCalledTimes(2);
    await act(async () => jest.advanceTimersByTimeAsync(15000));
    await act(async () => { for (const focus of mockFocusCallbacks) focus(); });
    expect(loadSections).toHaveBeenCalledTimes(3);
    expect(loadPage).toHaveBeenCalledTimes(3);
  } finally { jest.useRealTimers(); }
});
