/**
 * Pure date math of the calendar view (Archive and Collection Details). Dates are local calendar dates
 * written "YYYY-MM-DD" - exactly what GET items/history/calendar returns and GET items/history/date takes.
 * Nothing here assumes a locale, a time zone or a week start: callers pass the week start in.
 */
export type WeekStart = 0 | 1 | 6; // 0 = Sunday, 1 = Monday, 6 = Saturday

export interface MonthRef {
  readonly year: number;
  readonly month: number; // 1-12
}

/** One cell of the month grid: a real day, or a blank pad before the 1st / after the last day. */
export type CalendarCell = { readonly kind: 'pad' } | { readonly kind: 'day'; readonly date: string; readonly day: number };

const pad2 = (value: number) => String(value).padStart(2, '0');

export function formatLocalDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function todayLocalDate(now: Date = new Date()): string {
  return formatLocalDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function currentMonth(now: Date = new Date()): MonthRef {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function shiftMonth(ref: MonthRef, delta: number): MonthRef {
  const index = ref.year * 12 + (ref.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function monthKey(ref: MonthRef): string {
  return `${ref.year}-${pad2(ref.month)}`;
}

export function daysInMonth(ref: MonthRef): number {
  return new Date(ref.year, ref.month, 0).getDate();
}

/** True when `ref` is later than the month of `now` - the calendar never pages into the future. */
export function isFutureMonth(ref: MonthRef, now: Date = new Date()): boolean {
  const current = currentMonth(now);
  return ref.year * 12 + ref.month > current.year * 12 + current.month;
}

/** The month as weeks (rows of 7 cells), padded so each row starts on `weekStart`. */
export function monthGrid(ref: MonthRef, weekStart: WeekStart): readonly (readonly CalendarCell[])[] {
  const firstWeekday = new Date(ref.year, ref.month - 1, 1).getDay();
  const leading = (firstWeekday - weekStart + 7) % 7;
  const cells: CalendarCell[] = Array.from({ length: leading }, () => ({ kind: 'pad' as const }));
  for (let day = 1; day <= daysInMonth(ref); day++) {
    cells.push({ kind: 'day', date: formatLocalDate(ref.year, ref.month, day), day });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ kind: 'pad' });
  }
  const weeks: CalendarCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

/** The weekday indexes (0 = Sunday) of a week row, in display order. */
export function weekdayOrder(weekStart: WeekStart): readonly number[] {
  return Array.from({ length: 7 }, (_, index) => (weekStart + index) % 7);
}

/** Monday-first for the languages whose calendars start the week on Monday; Sunday-first otherwise. No region is assumed beyond the app language. */
const MONDAY_FIRST_LANGUAGES: ReadonlySet<string> = new Set(['de', 'fr', 'es', 'it', 'ru', 'tr', 'vi', 'id', 'pt']);

export function weekStartForLanguage(language: string | null | undefined): WeekStart {
  const base = (language ?? '').split(/[-_]/)[0].toLowerCase();
  return MONDAY_FIRST_LANGUAGES.has(base) ? 1 : 0;
}
