import ReactTestRenderer, { act } from 'react-test-renderer';
import { ApiError } from '../../api/ApiError';
import { useDateSectionViewability } from '../../components/DateSectionList';
import { useDateSectionPages, type DateSectionPagesSource, type UseDateSectionPagesResult } from '../useDateSectionPages';
import { useArchiveSearch, type ArchiveSearchState } from '../useArchiveSearch';
import { getItemHistory, type ItemHistoryEntry } from '../api/itemsApi';
import i18n from '../../i18n';
import { browseFailureMessage } from '../browseFailureMessage';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => { require('react').useEffect(callback, [callback]); },
}));
jest.mock('../../api/useAuthenticatedApi', () => {
  const request = jest.fn();
  return { useAuthenticatedApi: () => request };
});
jest.mock('../api/itemsApi', () => ({ ...jest.requireActual('../api/itemsApi'), getItemHistory: jest.fn() }));

const section = { key: 'today', kind: 'today' as const, year: null, month: null, fromUtc: '2026-10-22T15:00:00Z', toUtc: null, count: 1000 };
const entry = (id: number): ItemHistoryEntry => ({ id, url: 'https://example.test', title: 'Link', memo: null, savedAtUtc: section.fromUtc, representativeImage: null, previewImageUrl: null, coverImage: null });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const first = { items: [entry(1)], nextCursor: 'next' };
let source: DateSectionPagesSource<ItemHistoryEntry>;
let latest: UseDateSectionPagesResult<ItemHistoryEntry>;
let search: ArchiveSearchState;
let visible: ReturnType<typeof useDateSectionViewability<ItemHistoryEntry>>;
function Sections() {
  latest = useDateSectionPages(source, () => true);
  visible = useDateSectionViewability(latest.pages, latest.loadMore);
  return null;
}
function Search({ query = '' }: { query?: string }) { search = useArchiveSearch(query, 'name'); return null; }
async function mount(element = <Sections />) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(element); });
  return renderer;
}
beforeEach(() => {
  source = { loadSections: jest.fn(async () => [section]), loadPage: jest.fn(async () => first), idOf: item => item.id, errorMessage: () => 'failed' };
  jest.mocked(getItemHistory).mockReset().mockResolvedValue(first);
});

it('coalesces a burst of refreshes into one summary request', async () => {
  await mount();
  const pending = deferred<readonly typeof section[]>();
  jest.mocked(source.loadSections).mockReturnValueOnce(pending.promise);
  await act(async () => { latest.refresh(); latest.refresh(); latest.refresh(); });
  expect(source.loadSections).toHaveBeenCalledTimes(2); // initial + one refresh
  await act(async () => pending.resolve([section]));
});

it('does not automatically retry a failed page on repeated scroll visibility events', async () => {
  await mount();
  await act(async () => latest.ensureLoaded('today'));
  jest.mocked(source.loadPage).mockRejectedValueOnce(new ApiError('tooManyRequests', 429, 'rateLimited', 30));
  await act(async () => latest.loadMore('today'));
  expect(latest.pages.get('today')?.items).toEqual(first.items);
  await act(async () => {
    for (let i = 0; i < 20; i++) visible.onViewableItemsChanged({ viewableItems: [{ item: { kind: 'item', section, position: 0 } }] as never });
  });
  expect(source.loadPage).toHaveBeenCalledTimes(2);
  const clock = jest.spyOn(Date, 'now');
  const now = Date.now();
  await act(async () => latest.retrySection('today'));
  expect(source.loadPage).toHaveBeenCalledTimes(2);
  clock.mockReturnValue(now + 31_000);
  await act(async () => latest.retrySection('today'));
  expect(source.loadPage).toHaveBeenCalledTimes(3);
  expect(source.loadPage).toHaveBeenLastCalledWith(section, 25, 'next');
  clock.mockRestore();
});

it('retries the failed refresh first page, not the next cursor, while keeping prior rows', async () => {
  await mount();
  await act(async () => latest.ensureLoaded('today'));
  jest.mocked(source.loadPage).mockRejectedValueOnce(new ApiError('unavailable', 503));
  await act(async () => latest.refresh());
  expect(latest.pages.get('today')?.items).toEqual(first.items);
  expect(latest.pages.get('today')?.failedRequest).toBe('first');
  await act(async () => latest.retrySection('today'));
  expect(source.loadPage).toHaveBeenLastCalledWith(section, 25, undefined);
  expect(latest.pages.get('today')?.error).toBeNull();
});

it('keeps all sections and their successful rows after a summary 429, with its original cause', async () => {
  await mount();
  await act(async () => latest.ensureLoaded('today'));
  const refusal = new ApiError('tooManyRequests', 429, 'rateLimited', 20);
  jest.mocked(source.loadSections).mockRejectedValueOnce(refusal);
  await act(async () => latest.refresh());
  expect(latest.sections).toEqual([section]);
  expect(latest.pages.get('today')?.items).toEqual(first.items);
  expect(latest.errorCause).toBe(refusal);
});

it('search refresh failure retains successful data and coalesces repeated retry clicks', async () => {
  await mount(<Search />);
  const pending = deferred<typeof first>();
  jest.mocked(getItemHistory).mockReturnValueOnce(pending.promise);
  await act(async () => { search.refresh(); search.refresh(); });
  expect(getItemHistory).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(first));
  jest.mocked(getItemHistory).mockRejectedValueOnce(new ApiError('tooManyRequests', 429));
  await act(async () => search.refresh());
  expect(search.items).toEqual(first.items);
  expect(search.errorCause).toBeInstanceOf(ApiError);
  expect(search.error).toBe(true);
});

it('a slow old next page cannot overwrite a newer refreshed search', async () => {
  await mount(<Search />);
  const pending = deferred<typeof first>();
  jest.mocked(getItemHistory).mockReturnValueOnce(pending.promise);
  await act(async () => search.loadMore());
  jest.mocked(getItemHistory).mockResolvedValueOnce({ items: [entry(9)], nextCursor: null });
  await act(async () => search.refresh());
  await act(async () => pending.resolve({ items: [entry(2)], nextCursor: null as never }));
  expect(search.items.map(item => item.id)).toEqual([9]);
  expect(search.isLoadingMore).toBe(false);
});

it('distinguishes request limit, server failure and network failure messages', async () => {
  await i18n.changeLanguage('ko');
  expect(browseFailureMessage(new ApiError('tooManyRequests', 429), i18n.t)).toBe(i18n.t('collaboration.tooManyRequests'));
  expect(browseFailureMessage(new ApiError('timeout'), i18n.t)).toBe(i18n.t('history.errorNetwork'));
  expect(browseFailureMessage(new ApiError('unavailable', 503), i18n.t)).toBe(i18n.t('history.errorServer'));
  expect(browseFailureMessage(new Error('unknown'), i18n.t)).toBeNull();
});
