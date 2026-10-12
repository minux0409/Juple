/**
 * One cursor-paged list (the server's own cursor - opaque, never parsed): what is loaded, the next cursor, and whether a page is on
 * its way or the last one failed. Pure, so the paging rules are unit-tested: one page at a time, never a duplicate item, nothing
 * lost when a page fails, and no more requests after the last page.
 */
export interface PagedState<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly loadingMore: boolean;
  readonly moreFailed: boolean;
}

export function firstPage<T>(items: readonly T[], nextCursor: string | null): PagedState<T> {
  return { items, nextCursor, loadingMore: false, moreFailed: false };
}

/** What the end of the list shows: a page on its way (skeletons), a failure (retry), ready for more (sentinel), or the end. */
export function pageLoadStep(state: PagedState<unknown>): 'loading' | 'failed' | 'idle' | 'end' {
  if (state.loadingMore) {
    return 'loading';
  }
  if (state.moreFailed) {
    return 'failed';
  }
  return state.nextCursor ? 'idle' : 'end';
}

/** Whether the next page may be asked for now - never while one is on its way, never after the last. */
export function canLoadMore(state: PagedState<unknown>): boolean {
  return state.nextCursor !== null && !state.loadingMore;
}

export function startLoadingMore<T>(state: PagedState<T>): PagedState<T> {
  return { ...state, loadingMore: true, moreFailed: false };
}

/** The next page joins the loaded ones; an item already shown (a page boundary can repeat one) is not added twice. */
export function appendPage<T>(state: PagedState<T>, page: { readonly items: readonly T[]; readonly nextCursor: string | null }, idOf: (item: T) => number): PagedState<T> {
  const seen = new Set(state.items.map(idOf));
  return { items: [...state.items, ...page.items.filter(item => !seen.has(idOf(item)))], nextCursor: page.nextCursor, loadingMore: false, moreFailed: false };
}

/** The next page failed: everything loaded stays, and nothing retries by itself. */
export function failLoadingMore<T>(state: PagedState<T>): PagedState<T> {
  return { ...state, loadingMore: false, moreFailed: true };
}
