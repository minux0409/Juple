import type { DateSection, DateSectionPage } from './useDateSectionPages';

/**
 * 전체 (continuous) Archive: the date sections' already-paged links read as ONE run, newest first -
 * no new request or data source, just the same per-section pages laid end to end.
 */
export interface ContinuousHistory<T> {
  /**
   * The links from the newest section onward, only as far as nothing is missing in between: a
   * section's links are never shown while an earlier section is only partly loaded (no gaps).
   */
  readonly items: readonly T[];
  /** What extends the run: a section's first page, or the next page of the section the run stopped in. Null: everything is loaded. */
  readonly next: { readonly key: string; readonly action: 'first' | 'more' } | null;
  /** The section the run stopped in is loading its first page (nothing of it to show yet). */
  readonly isLoadingFirst: boolean;
  /** ...or a next page. */
  readonly isLoadingMore: boolean;
  /** The section the run stopped in failed to load (its page error), if it did. */
  readonly errorKey: string | null;
  /** How many skeleton tiles/rows to show while the frontier loads (never more than the section holds). */
  readonly frontierCount: number;
}

export function buildContinuousHistory<T>(
  sections: readonly DateSection[],
  pages: ReadonlyMap<string, DateSectionPage<T>>,
  firstPageSkeletons: number,
  nextPageSkeletons: number,
): ContinuousHistory<T> {
  const items: T[] = [];
  for (const section of sections) {
    const page = pages.get(section.key);
    if (!page) {
      return { items, next: { key: section.key, action: 'first' }, isLoadingFirst: false, isLoadingMore: false, errorKey: null, frontierCount: 0 };
    }
    for (const item of page.items) {
      items.push(item);
    }
    if (page.error !== null) {
      return { items, next: { key: section.key, action: page.items.length > 0 ? 'more' : 'first' }, isLoadingFirst: false, isLoadingMore: false, errorKey: section.key, frontierCount: 0 };
    }
    if (page.isLoading && page.items.length === 0) {
      return { items, next: { key: section.key, action: 'first' }, isLoadingFirst: true, isLoadingMore: false, errorKey: null, frontierCount: Math.min(section.count, firstPageSkeletons) };
    }
    if (page.nextCursor) {
      return { items, next: { key: section.key, action: 'more' }, isLoadingFirst: false, isLoadingMore: page.isLoadingMore, errorKey: null, frontierCount: page.isLoadingMore ? nextPageSkeletons : 0 };
    }
  }
  return { items, next: null, isLoadingFirst: false, isLoadingMore: false, errorKey: null, frontierCount: 0 };
}
