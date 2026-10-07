import { buildContinuousHistory } from '../continuousHistory';
import type { DateSection, DateSectionPage } from '../useDateSectionPages';

const section = (key: string, count: number): DateSection => ({ key, kind: 'month', year: 2026, month: 1, fromUtc: key, toUtc: null, count });
const page = (items: number[], overrides: Partial<DateSectionPage<number>> = {}): DateSectionPage<number> =>
  ({ items, nextCursor: null, isLoading: false, isLoadingMore: false, error: null, ...overrides });
const build = (sections: DateSection[], pages: Record<string, DateSectionPage<number>>) =>
  buildContinuousHistory(sections, new Map(Object.entries(pages)), 6, 2);

describe('buildContinuousHistory', () => {
  const sections = [section('a', 3), section('b', 2), section('c', 1)];

  it('joins fully loaded sections end to end, newest first, with nothing left to load', () => {
    const result = build(sections, { a: page([1, 2, 3]), b: page([4, 5]), c: page([6]) });
    expect(result.items).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.next).toBeNull();
  });

  it('stops at the first section that is not loaded yet - no gap - and asks for its first page', () => {
    const result = build(sections, { a: page([1, 2, 3]), c: page([6]) });
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.next).toEqual({ key: 'b', action: 'first' });
  });

  it('stops inside a partly loaded section and asks for its next page; later loaded sections stay hidden', () => {
    const result = build(sections, { a: page([1, 2], { nextCursor: '2' }), b: page([4, 5]) });
    expect(result.items).toEqual([1, 2]);
    expect(result.next).toEqual({ key: 'a', action: 'more' });
    expect(result.isLoadingMore).toBe(false);
  });

  it('reports skeleton counts only while a request is on its way, never more than the section holds', () => {
    expect(build(sections, { a: page([1, 2, 3]), b: page([], { isLoading: true }) })).toMatchObject({ isLoadingFirst: true, frontierCount: 2 });
    expect(build(sections, { a: page([1], { nextCursor: '1', isLoadingMore: true }) })).toMatchObject({ isLoadingMore: true, frontierCount: 2 });
    expect(build(sections, { a: page([1], { nextCursor: '1' }) }).frontierCount).toBe(0);
  });

  it('keeps what loaded and reports the failing section, retrying its first or next page as it stands', () => {
    expect(build(sections, { a: page([1, 2, 3]), b: page([], { error: 'x' }) })).toMatchObject({ items: [1, 2, 3], errorKey: 'b', next: { key: 'b', action: 'first' } });
    expect(build(sections, { a: page([1], { nextCursor: '1', error: 'x' }) })).toMatchObject({ items: [1], errorKey: 'a', next: { key: 'a', action: 'more' } });
  });

  it('skips a section whose links were all removed', () => {
    expect(build(sections, { a: page([]), b: page([4]), c: page([6]) }).items).toEqual([4, 6]);
  });
});
