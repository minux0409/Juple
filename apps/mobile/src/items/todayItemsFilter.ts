import { formatDateOnly } from './dateOnly';
import type { ItemHistoryEntry } from './api/itemsApi';

export interface TodayItemsPageResult {
  readonly todayItems: readonly ItemHistoryEntry[];
  /** Whether there might be MORE "today" items on a further page - only true when every item in
   * this page was still today AND the underlying feed actually has a further page to check. */
  readonly canLoadMoreToday: boolean;
}

/**
 * Filters one page of the plain, SavedAtUtc-descending /history feed (see itemsApi.ts's
 * getItemHistory - the same source History's own useItemHistory.ts already uses) down to just
 * today's items - "today" being the device's own live local calendar date (formatDateOnly(new
 * Date()), the exact same computation historyDateGrouping.ts's todayDateKey() already uses for
 * History's own "오늘" section), never a server-stored timezone.
 *
 * This is what Home (DailyInboxScreen) now uses instead of the dedicated GET
 * /api/v1/items/history/date endpoint, whose date-range window is computed server-side from the
 * User's *stored* TimeZoneId (see backend DailyInboxDateRangeCalculator) - a value that is only
 * refreshed on the next account bootstrap call and can go stale (e.g. still "GMT" from an earlier
 * bootstrap, or a genuine device timezone change mid-session), silently excluding items that are
 * unambiguously "today" on the device right now. History was never affected by this because its
 * own "오늘" bucketing already ran 100% client-side against the live device clock - Home now does
 * the same, against the exact same already-correct History data source, instead of a second,
 * independently-filtered endpoint that can disagree with it.
 *
 * Since the feed is strictly newest-first (SavedAtUtc descending), once a page contains an item
 * that is NOT today, every item after it - in this page and all subsequent pages - is also not
 * today, so paging can stop right there without needing to inspect anything further down the feed.
 */
export function filterTodayItemsPage(
  items: readonly ItemHistoryEntry[],
  hasNextPage: boolean,
  todayKey: string,
): TodayItemsPageResult {
  const todayItems = items.filter(item => formatDateOnly(new Date(item.savedAtUtc)) === todayKey);
  const canLoadMoreToday = hasNextPage && todayItems.length === items.length;
  return { todayItems, canLoadMoreToday };
}
