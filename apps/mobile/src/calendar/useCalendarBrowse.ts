import { useCallback, useEffect, useRef, useState } from 'react';
import { currentMonth, isFutureMonth, monthKey, shiftMonth, todayLocalDate, type MonthRef } from './calendarDates';
import type { CalendarMonth } from './calendarApi';

export const CALENDAR_DAY_PAGE_SIZE = 25;

export interface CalendarDayPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

interface CalendarBrowseSource<T> {
  /** One month's per-day counts (never link data). */
  readonly loadMonth: (month: MonthRef) => Promise<CalendarMonth>;
  /**
   * One page of the selected day's links, through the existing paged endpoint. Optional: a screen whose day results
   * come from elsewhere (the Archive's combined text + date query) only uses the month and the selection.
   */
  readonly loadDay?: (date: string, cursor: string | undefined) => Promise<CalendarDayPage<T>>;
  readonly idOf: (item: T) => number;
  /** False: nothing is requested (the screen is not in calendar mode). */
  readonly enabled: boolean;
  /** A change (another Collection, a lock/unlock) drops everything loaded. */
  readonly resetKey?: string;
}

export type CalendarLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * The calendar view's state, shared by the Archive and Collection Details: the month on screen (never
 * past the current month), its per-day counts (cached per month; one small request each - no link data),
 * the selected day and that day's links, paged on demand. Month navigation never fetches any links; a
 * day's links load only once the day is selected. A newer request always wins over an older response.
 */
export function useCalendarBrowse<T>(source: CalendarBrowseSource<T>) {
  const { loadMonth, loadDay, idOf, enabled, resetKey } = source;
  const [month, setMonth] = useState<MonthRef>(() => currentMonth());
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [monthStatus, setMonthStatus] = useState<CalendarLoadStatus>('idle');
  const cacheRef = useRef(new Map<string, ReadonlyMap<string, number>>());
  const monthRequestRef = useRef(0);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayItems, setDayItems] = useState<readonly T[]>([]);
  const [dayCursor, setDayCursor] = useState<string | null>(null);
  const [dayStatus, setDayStatus] = useState<CalendarLoadStatus>('idle');
  const [isLoadingMoreDay, setIsLoadingMoreDay] = useState(false);
  const [dayLoadMoreFailed, setDayLoadMoreFailed] = useState(false);
  const dayRequestRef = useRef(0);
  const loadingMoreRef = useRef(false);

  const fetchMonth = useCallback(
    async (target: MonthRef, force: boolean) => {
      const key = monthKey(target);
      const cached = cacheRef.current.get(key);
      if (cached && !force) {
        setCounts(cached);
        setMonthStatus('ready');
        return;
      }
      const requestId = ++monthRequestRef.current;
      setMonthStatus('loading');
      try {
        const loaded = await loadMonth(target);
        if (requestId !== monthRequestRef.current) {
          return;
        }
        const map = new Map(loaded.days.map(day => [day.date, day.count] as const));
        cacheRef.current.set(key, map);
        setCounts(map);
        setMonthStatus('ready');
      } catch {
        if (requestId === monthRequestRef.current) {
          setMonthStatus('error');
        }
      }
    },
    [loadMonth],
  );

  const fetchDay = useCallback(
    async (date: string) => {
      if (!loadDay) {
        return;
      }
      const requestId = ++dayRequestRef.current;
      loadingMoreRef.current = false;
      setIsLoadingMoreDay(false);
      setDayLoadMoreFailed(false);
      setDayStatus('loading');
      try {
        const page = await loadDay(date, undefined);
        if (requestId !== dayRequestRef.current) {
          return;
        }
        setDayItems(page.items);
        setDayCursor(page.nextCursor);
        setDayStatus('ready');
      } catch {
        if (requestId === dayRequestRef.current) {
          setDayStatus('error');
        }
      }
    },
    [loadDay],
  );

  // (Re)load the month on screen when the calendar turns on, the month changes or the source is reset.
  const resetRef = useRef(resetKey);
  useEffect(() => {
    if (resetRef.current !== resetKey) {
      resetRef.current = resetKey;
      cacheRef.current.clear();
      setSelectedDate(null);
      setDayItems([]);
      setDayStatus('idle');
    }
    if (enabled) {
      fetchMonth(month, false).catch(() => undefined);
    }
  }, [enabled, fetchMonth, month, resetKey]);

  /** Chooses a day (its links load); null clears the choice - back to every date. */
  const selectDate = useCallback(
    (date: string | null) => {
      setSelectedDate(date);
      if (date === null) {
        dayRequestRef.current += 1;
        loadingMoreRef.current = false;
        setDayItems([]);
        setDayCursor(null);
        setDayStatus('idle');
        setIsLoadingMoreDay(false);
        setDayLoadMoreFailed(false);
        return;
      }
      fetchDay(date).catch(() => undefined);
    },
    [fetchDay],
  );

  const loadMoreDay = useCallback(async () => {
    if (!loadDay || !selectedDate || dayCursor === null || loadingMoreRef.current || dayStatus !== 'ready') {
      return;
    }
    loadingMoreRef.current = true;
    const requestId = dayRequestRef.current;
    setIsLoadingMoreDay(true);
    setDayLoadMoreFailed(false);
    try {
      const page = await loadDay(selectedDate, dayCursor);
      if (requestId !== dayRequestRef.current) {
        return;
      }
      setDayItems(previous => {
        const seen = new Set(previous.map(idOf));
        return [...previous, ...page.items.filter(item => !seen.has(idOf(item)))];
      });
      setDayCursor(page.nextCursor);
    } catch {
      if (requestId === dayRequestRef.current) {
        setDayLoadMoreFailed(true);
      }
    } finally {
      if (requestId === dayRequestRef.current) {
        loadingMoreRef.current = false;
        setIsLoadingMoreDay(false);
      }
    }
  }, [dayCursor, dayStatus, idOf, loadDay, selectedDate]);

  /** A link was deleted: it leaves the day at once and the day's count (and the month cache) drops by one. */
  const removeItem = useCallback(
    (itemId: number) => {
      setDayItems(previous => previous.filter(item => idOf(item) !== itemId));
      if (selectedDate) {
        const adjust = (map: ReadonlyMap<string, number>) => {
          const count = map.get(selectedDate);
          if (count === undefined) {
            return map;
          }
          const next = new Map(map);
          if (count <= 1) {
            next.delete(selectedDate);
          } else {
            next.set(selectedDate, count - 1);
          }
          return next;
        };
        setCounts(adjust);
        const key = monthKey(month);
        const cached = cacheRef.current.get(key);
        if (cached) {
          cacheRef.current.set(key, adjust(cached));
        }
      }
    },
    [idOf, month, selectedDate],
  );

  /** Re-reads the month on screen and the selected day (pull-to-refresh, an undo, returning to the screen). */
  const refresh = useCallback(async () => {
    cacheRef.current.clear();
    await fetchMonth(month, true);
    if (selectedDate) {
      await fetchDay(selectedDate);
    }
  }, [fetchDay, fetchMonth, month, selectedDate]);

  const canGoNext = !isFutureMonth(shiftMonth(month, 1));

  return {
    month,
    goToPreviousMonth: () => setMonth(previous => shiftMonth(previous, -1)),
    goToNextMonth: () => setMonth(previous => (isFutureMonth(shiftMonth(previous, 1)) ? previous : shiftMonth(previous, 1))),
    canGoNext,
    counts,
    monthStatus,
    retryMonth: () => fetchMonth(month, true),
    today: todayLocalDate(),
    selectedDate,
    selectDate,
    dayItems,
    dayStatus,
    hasMoreDay: dayCursor !== null,
    isLoadingMoreDay,
    dayLoadMoreFailed,
    loadMoreDay,
    retryDay: () => (selectedDate ? fetchDay(selectedDate) : Promise.resolve()),
    removeItem,
    refresh,
  } as const;
}
