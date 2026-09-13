import type { TFunction } from 'i18next';
import i18n from '../i18n';
import { formatDateOnly } from './dateOnly';
import type { ItemHistoryEntry } from './api/itemsApi';

export interface HistorySection {
  /**
   * Unique per section. "YYYY-MM-DD" for Today/Yesterday (the device's local calendar date - never
   * a UTC substring, see formatDateOnly), the literal "thisWeek" for the current-week bucket, or
   * "month:YYYY-MM" for a month bucket - the "month:" prefix guarantees it never collides with a
   * day key.
   */
  readonly dateKey: string;
  /** Localized "오늘"/"Today", "어제"/"Yesterday", "이번 주"/"This week", or a localized "YYYY년 M월"-style month label. */
  readonly label: string;
  readonly items: readonly ItemHistoryEntry[];
  /**
   * Today/Yesterday sections are exactly one calendar day, so a per-item time-of-day is
   * unambiguous. "This week" and month sections each span multiple days, so their rows must show
   * the full date too - see SavedLinkRow's dateDisplayMode prop.
   */
  readonly showItemDate: boolean;
}

/**
 * Buckets a flat, newest-first History list into: 오늘, 어제, 이번 주 (the current calendar week,
 * excluding 오늘/어제), then one section per calendar month for everything older - never one
 * section per day beyond 어제, even for a day earlier in the current calendar month than this
 * week's start. Runs over the whole accumulated items array (not per-page), so a load-more page
 * boundary that lands mid-bucket merges into the same section as already-shown rows.
 *
 * All boundaries are computed from the device's local calendar (via `new Date(savedAtUtc)`'s local
 * getters, the same mechanism formatDateOnly already uses) - never a UTC-boundary comparison, so a
 * save that's "yesterday" in UTC but already "today" past local midnight still lands correctly.
 */
/** Today's dateKey in the device's local calendar - same computation groupHistoryByLocalDate uses internally, exported so screens can default-expand today's section without duplicating the logic. */
export function todayDateKey(): string {
  return formatDateOnly(new Date());
}

function startOfWeekKey(now: Date): string {
  // Sunday-start week (the Korean calendar convention this app's UI otherwise follows) - the most
  // recent Sunday at local midnight, at or before `now`.
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  return formatDateOnly(start);
}

function monthKeyOf(dateKey: string): string {
  // dateKey is always "YYYY-MM-DD" (see formatDateOnly) - slicing is safe and avoids re-parsing.
  return `month:${dateKey.slice(0, 7)}`;
}

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.slice('month:'.length).split('-').map(Number);
  return new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'long' }).format(
    new Date(year, month - 1, 1),
  );
}

export function groupHistoryByLocalDate(
  items: readonly ItemHistoryEntry[],
  t: TFunction,
): readonly HistorySection[] {
  const now = new Date();
  const todayKey = formatDateOnly(now);
  const yesterdayKey = formatDateOnly(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const weekStartKey = startOfWeekKey(now);

  const todayItems: ItemHistoryEntry[] = [];
  const yesterdayItems: ItemHistoryEntry[] = [];
  const thisWeekItems: ItemHistoryEntry[] = [];
  const monthOrder: string[] = [];
  const monthItems = new Map<string, ItemHistoryEntry[]>();

  for (const item of items) {
    const key = formatDateOnly(new Date(item.savedAtUtc));
    if (key === todayKey) {
      todayItems.push(item);
    } else if (key === yesterdayKey) {
      yesterdayItems.push(item);
    } else if (key >= weekStartKey) {
      thisWeekItems.push(item);
    } else {
      const monthKey = monthKeyOf(key);
      let bucket = monthItems.get(monthKey);
      if (!bucket) {
        bucket = [];
        monthItems.set(monthKey, bucket);
        monthOrder.push(monthKey);
      }
      bucket.push(item);
    }
  }

  const sections: HistorySection[] = [];
  if (todayItems.length > 0) {
    sections.push({ dateKey: todayKey, label: t('history.today'), items: todayItems, showItemDate: false });
  }
  if (yesterdayItems.length > 0) {
    sections.push({ dateKey: yesterdayKey, label: t('history.yesterday'), items: yesterdayItems, showItemDate: false });
  }
  if (thisWeekItems.length > 0) {
    sections.push({ dateKey: 'thisWeek', label: t('history.thisWeek'), items: thisWeekItems, showItemDate: true });
  }
  for (const monthKey of monthOrder) {
    sections.push({
      dateKey: monthKey,
      label: formatMonthLabel(monthKey),
      items: monthItems.get(monthKey) ?? [],
      showItemDate: true,
    });
  }

  return sections;
}
