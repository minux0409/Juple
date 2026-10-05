import {
  currentMonth,
  daysInMonth,
  formatLocalDate,
  isFutureMonth,
  monthGrid,
  shiftMonth,
  todayLocalDate,
  weekdayOrder,
  weekStartForLanguage,
} from '../calendarDates';

describe('calendarDates', () => {
  it('shifts months across a year boundary in both directions', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth({ year: 2026, month: 10 }, -13)).toEqual({ year: 2025, month: 9 });
  });

  it('knows month lengths, including February in a leap year', () => {
    expect(daysInMonth({ year: 2026, month: 2 })).toBe(28);
    expect(daysInMonth({ year: 2028, month: 2 })).toBe(29);
    expect(daysInMonth({ year: 2026, month: 10 })).toBe(31);
  });

  it('builds whole weeks starting on the chosen week start, padding before the 1st and after the last day', () => {
    // 2026-10-01 is a Thursday.
    const sunday = monthGrid({ year: 2026, month: 10 }, 0);
    expect(sunday.every(week => week.length === 7)).toBe(true);
    expect(sunday[0].map(cell => cell.kind)).toEqual(['pad', 'pad', 'pad', 'pad', 'day', 'day', 'day']);
    const monday = monthGrid({ year: 2026, month: 10 }, 1);
    expect(monday[0].map(cell => cell.kind)).toEqual(['pad', 'pad', 'pad', 'day', 'day', 'day', 'day']);
    const days = sunday.flat().filter(cell => cell.kind === 'day');
    expect(days).toHaveLength(31);
    expect(days[0]).toEqual({ kind: 'day', date: '2026-10-01', day: 1 });
    expect(days[30]).toEqual({ kind: 'day', date: '2026-10-31', day: 31 });
  });

  it('orders the weekday row from the week start', () => {
    expect(weekdayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(weekdayOrder(6)).toEqual([6, 0, 1, 2, 3, 4, 5]);
  });

  it('formats and compares local dates', () => {
    expect(formatLocalDate(2026, 3, 5)).toBe('2026-03-05');
    const now = new Date(2026, 9, 5, 15, 30);
    expect(todayLocalDate(now)).toBe('2026-10-05');
    expect(currentMonth(now)).toEqual({ year: 2026, month: 10 });
    expect(isFutureMonth({ year: 2026, month: 11 }, now)).toBe(true);
    expect(isFutureMonth({ year: 2026, month: 10 }, now)).toBe(false);
    expect(isFutureMonth({ year: 2025, month: 12 }, now)).toBe(false);
  });

  it('starts the week on Monday only for the languages that usually do', () => {
    expect(weekStartForLanguage('ko')).toBe(0);
    expect(weekStartForLanguage('en')).toBe(0);
    expect(weekStartForLanguage('de')).toBe(1);
    expect(weekStartForLanguage('pt-BR')).toBe(1);
    expect(weekStartForLanguage(undefined)).toBe(0);
  });
});
