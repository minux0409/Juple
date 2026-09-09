import type { TFunction } from 'i18next';
import { formatDateOnly, formatDateOnlyForDisplay } from './dateOnly';
import type { ItemHistoryEntry } from './api/itemsApi';

export interface HistorySection {
  /** "YYYY-MM-DD" in the device's local calendar - never a UTC substring (see formatDateOnly). */
  readonly dateKey: string;
  /** Localized "오늘"/"Today", "어제"/"Yesterday", or the locale-formatted date otherwise. */
  readonly label: string;
  readonly items: readonly ItemHistoryEntry[];
}

/**
 * Buckets a flat, newest-first History list into date sections using each Item's SavedAtUtc
 * converted to the *device's* local calendar date (via `new Date(savedAtUtc)`'s local getters,
 * the same mechanism formatDateOnly already uses for Purchases - never a UTC-string truncation,
 * so a save that's "yesterday" in UTC but already "today" past local midnight lands in Today).
 * Runs over the whole accumulated items array (not per-page), so a load-more page boundary that
 * lands mid-day merges into the same section as already-shown rows instead of splitting it.
 */
export function groupHistoryByLocalDate(
  items: readonly ItemHistoryEntry[],
  t: TFunction,
): readonly HistorySection[] {
  const now = new Date();
  const todayKey = formatDateOnly(now);
  const yesterdayKey = formatDateOnly(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));

  const sections: HistorySection[] = [];
  let currentKey: string | null = null;
  let currentItems: ItemHistoryEntry[] = [];

  const flush = () => {
    if (currentKey !== null) {
      sections.push({
        dateKey: currentKey,
        label: formatSectionLabel(currentKey, todayKey, yesterdayKey, t),
        items: currentItems,
      });
    }
  };

  for (const item of items) {
    const key = formatDateOnly(new Date(item.savedAtUtc));
    if (key !== currentKey) {
      flush();
      currentKey = key;
      currentItems = [];
    }
    currentItems.push(item);
  }
  flush();

  return sections;
}

function formatSectionLabel(
  dateKey: string,
  todayKey: string,
  yesterdayKey: string,
  t: TFunction,
): string {
  if (dateKey === todayKey) {
    return t('history.today');
  }
  if (dateKey === yesterdayKey) {
    return t('history.yesterday');
  }
  return formatDateOnlyForDisplay(dateKey);
}
