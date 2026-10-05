import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';
import { ImportantState } from '../components/ImportantState';
import { ArrowHeadIcon } from '../icons/ArrowHeadIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import { monthGrid, weekdayOrder, weekStartForLanguage, type MonthRef } from './calendarDates';
import type { CalendarLoadStatus } from './useCalendarBrowse';

interface CalendarMonthViewProps {
  readonly month: MonthRef;
  /** "YYYY-MM-DD" -> number of links; days without links are simply absent. */
  readonly counts: ReadonlyMap<string, number>;
  /** Today as a local "YYYY-MM-DD". */
  readonly today: string;
  readonly selectedDate: string | null;
  readonly status: CalendarLoadStatus;
  readonly canGoNext: boolean;
  readonly onSelectDate: (date: string) => void;
  readonly onPreviousMonth: () => void;
  readonly onNextMonth: () => void;
  readonly onRetry: () => void;
  readonly testIDPrefix?: string;
}

/** A few days of the week as the device's own locale writes them (Intl - nothing is hard-coded per language). */
function weekdayLabel(weekday: number, language: string | undefined): string {
  // 2023-01-01 was a Sunday.
  return new Date(2023, 0, 1 + weekday).toLocaleDateString(language, { weekday: 'short' });
}

const MAX_BADGE = 99;

/**
 * One month of the calendar view: "< 2026년 10월 >", the weekday row (starting on the language's usual week
 * start), the days with a subtle count where links exist, today ringed and the selected day filled. A day is
 * tapped to see its links (the screen shows them below). Presentation only - the counts come from the
 * server's per-day summary, never from link data.
 */
export function CalendarMonthView({
  month,
  counts,
  today,
  selectedDate,
  status,
  canGoNext,
  onSelectDate,
  onPreviousMonth,
  onNextMonth,
  onRetry,
  testIDPrefix = 'calendar',
}: CalendarMonthViewProps) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const weekStart = weekStartForLanguage(language);
  const weeks = useMemo(() => monthGrid(month, weekStart), [month, weekStart]);
  const weekdays = useMemo(() => weekdayOrder(weekStart).map(weekday => weekdayLabel(weekday, language)), [weekStart, language]);
  const title = new Date(month.year, month.month - 1, 1).toLocaleDateString(language, { year: 'numeric', month: 'long' });

  return (
    <View style={styles.container} testID={testIDPrefix}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel={t('calendar.previousMonthA11y')}
          accessibilityRole="button"
          onPress={onPreviousMonth}
          style={styles.navButton}
          testID={`${testIDPrefix}-prev`}
        >
          {/* previous = "<" on the start side; mirrored (">") in RTL, where the start side is on the right */}
          <ArrowHeadIcon color={colors.textPrimary} direction={I18nManager.isRTL ? 'right' : 'left'} size={22} />
        </Pressable>
        <Text accessibilityLiveRegion="polite" accessibilityRole="header" numberOfLines={1} style={styles.title} testID={`${testIDPrefix}-title`}>{title}</Text>
        <Pressable
          accessibilityLabel={t('calendar.nextMonthA11y')}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canGoNext }}
          disabled={!canGoNext}
          onPress={onNextMonth}
          style={[styles.navButton, !canGoNext && styles.navDisabled]}
          testID={`${testIDPrefix}-next`}
        >
          <ArrowHeadIcon color={colors.textPrimary} direction={I18nManager.isRTL ? 'left' : 'right'} size={22} />
        </Pressable>
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.weekRow}>
        {weekdays.map((label, index) => (
          <Text key={index} numberOfLines={1} style={styles.weekday}>{label}</Text>
        ))}
      </View>
      {status === 'error' ? (
        <ImportantState compact message={t('calendar.monthLoadError')} onRetry={onRetry} testID={`${testIDPrefix}-error`} />
      ) : (
        <View style={status === 'loading' ? styles.gridLoading : undefined} testID={`${testIDPrefix}-grid`}>
          {weeks.map((week, weekIndex) => (
            <View key={weekIndex} style={styles.weekRow}>
              {week.map((cell, cellIndex) => {
                if (cell.kind === 'pad') {
                  return <View key={cellIndex} style={styles.cell} />;
                }
                const count = counts.get(cell.date) ?? 0;
                const isSelected = cell.date === selectedDate;
                const isToday = cell.date === today;
                return (
                  <Pressable
                    accessibilityLabel={`${new Date(month.year, month.month - 1, cell.day).toLocaleDateString(language, { dateStyle: 'full' })}${count > 0 ? `, ${t('calendar.dayCountA11y', { count })}` : ''}${isToday ? `, ${t('calendar.today')}` : ''}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    key={cellIndex}
                    onPress={() => onSelectDate(cell.date)}
                    style={[styles.cell, styles.day, isToday && styles.dayToday, isSelected && styles.daySelected]}
                    testID={`${testIDPrefix}-day-${cell.date}`}
                  >
                    <Text style={[styles.dayNumber, isSelected && styles.dayNumberSelected]}>{cell.day}</Text>
                    {count > 0 ? (
                      <Text
                        numberOfLines={1}
                        style={[styles.count, isSelected && styles.countSelected]}
                        testID={`${testIDPrefix}-count-${cell.date}`}
                      >
                        {count > MAX_BADGE ? `${MAX_BADGE}+` : count}
                      </Text>
                    ) : (
                      <View style={styles.countSpacer} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
          {status === 'loading' ? <ActivityIndicator style={styles.loading} testID={`${testIDPrefix}-loading`} /> : null}
        </View>
      )}
    </View>
  );
}

const CELL_HEIGHT = minTouchTarget + 6;

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  navButton: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
  navDisabled: { opacity: 0.3 },
  title: { color: colors.textPrimary, flexShrink: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  weekRow: { flexDirection: 'row' },
  weekday: { color: colors.textSecondary, flex: 1, fontSize: 12, fontWeight: '600', paddingVertical: spacing.xs, textAlign: 'center' },
  cell: { flex: 1, height: CELL_HEIGHT },
  day: { alignItems: 'center', borderColor: 'transparent', borderRadius: radii.md, borderWidth: 1, justifyContent: 'center' },
  dayToday: { borderColor: colors.brand },
  daySelected: { backgroundColor: colors.brand },
  dayNumber: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  dayNumberSelected: { color: colors.surface },
  count: { color: colors.brand, fontSize: 11, fontWeight: '700', height: 14, lineHeight: 14 },
  countSelected: { color: colors.surface },
  countSpacer: { height: 14 },
  gridLoading: { opacity: 0.5 },
  loading: { left: 0, position: 'absolute', right: 0, top: '40%' },
});
