import { formatDateOnly } from '../dateOnly';
import { filterTodayItemsPage } from '../todayItemsFilter';
import type { ItemHistoryEntry } from '../api/itemsApi';

function makeItem(id: number, savedAtUtc: string): ItemHistoryEntry {
  return {
    id,
    url: 'https://example.com',
    title: 'Example',
    memo: null,
    savedAtUtc,
    representativeImage: null,
    previewImageUrl: null,
    coverImage: null,
  };
}

/** An ISO instant that is unambiguously on the device's local "today", regardless of the test
 * runner's own timezone - anchored to local noon plus/minus a small offset, never a fixed UTC
 * clock hour (which can land on a different local calendar day depending on the runner's TZ). */
function todayAt(hourOffset: number): string {
  const now = new Date();
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12 + hourOffset, 0, 0);
  return local.toISOString();
}

function daysAgoAt(days: number, hourOffset: number): string {
  const now = new Date();
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, 12 + hourOffset, 0, 0);
  return local.toISOString();
}

describe('filterTodayItemsPage', () => {
  const todayKey = formatDateOnly(new Date());

  it('keeps items whose local date matches todayKey', () => {
    const items = [makeItem(1, todayAt(-2)), makeItem(2, todayAt(2))];
    const result = filterTodayItemsPage(items, false, todayKey);
    expect(result.todayItems.map(i => i.id)).toEqual([1, 2]);
  });

  it('excludes items saved on a different local date than todayKey', () => {
    const items = [makeItem(1, daysAgoAt(1, 0)), makeItem(2, daysAgoAt(2, 0))];
    const result = filterTodayItemsPage(items, false, todayKey);
    expect(result.todayItems).toHaveLength(0);
  });

  it('stops trusting "today" once a non-today item is hit, since the feed is newest-first', () => {
    const items = [makeItem(1, todayAt(1)), makeItem(2, todayAt(-1)), makeItem(3, daysAgoAt(1, 0))];
    const result = filterTodayItemsPage(items, true, todayKey);
    expect(result.todayItems.map(i => i.id)).toEqual([1, 2]);
  });

  it('canLoadMoreToday is true only when every item in this page was today AND a further page exists', () => {
    const allToday = [makeItem(1, todayAt(0))];
    expect(filterTodayItemsPage(allToday, true, todayKey).canLoadMoreToday).toBe(true);
    expect(filterTodayItemsPage(allToday, false, todayKey).canLoadMoreToday).toBe(false);
  });

  it('canLoadMoreToday is false once the page contains any non-today item, even if a further page exists', () => {
    const mixed = [makeItem(1, todayAt(0)), makeItem(2, daysAgoAt(1, 0))];
    expect(filterTodayItemsPage(mixed, true, todayKey).canLoadMoreToday).toBe(false);
  });

  it('an empty page vacuously "was all today" - canLoadMoreToday follows hasNextPage alone', () => {
    expect(filterTodayItemsPage([], true, todayKey).canLoadMoreToday).toBe(true);
    expect(filterTodayItemsPage([], false, todayKey).canLoadMoreToday).toBe(false);
  });
});
