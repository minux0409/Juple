import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CalendarIcon } from '../icons/CalendarIcon';
import { CloseIcon } from '../icons/CloseIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import { CalendarMonthView } from './CalendarMonthView';
import type { CalendarLoadStatus } from './useCalendarBrowse';
import type { MonthRef } from './calendarDates';

interface DateFilterBarProps {
  /** The chosen day, "YYYY-MM-DD" (a local calendar date), or null: every date. */
  readonly selectedDate: string | null;
  /** The month calendar is expanded inline under the bar. */
  readonly isOpen: boolean;
  readonly onToggleOpen: () => void;
  /** Back to every date. */
  readonly onClear: () => void;
  readonly onSelectDate: (date: string) => void;
  readonly month: MonthRef;
  readonly counts: ReadonlyMap<string, number>;
  readonly today: string;
  readonly status: CalendarLoadStatus;
  readonly canGoNext: boolean;
  readonly onPreviousMonth: () => void;
  readonly onNextMonth: () => void;
  readonly onRetryMonth: () => void;
  readonly testIDPrefix?: string;
}

/** "2026. 9. 23." in the app language - from the date itself, never a time zone (a calendar date has none). */
function formatSelectedDate(date: string, language: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(language, { year: 'numeric', month: 'numeric', day: 'numeric' });
}

/**
 * The date as a FILTER (a query condition - not a third view mode): "[calendar] 날짜 선택", which expands the month
 * calendar inline; the chosen day then reads "날짜: 2026. 9. 23 [X]" and the content underneath - in the current
 * List/Grid - shows only that day. X goes back to every date. Shared by the Archive and Collection Details.
 */
export function DateFilterBar({
  selectedDate,
  isOpen,
  onToggleOpen,
  onClear,
  onSelectDate,
  month,
  counts,
  today,
  status,
  canGoNext,
  onPreviousMonth,
  onNextMonth,
  onRetryMonth,
  testIDPrefix = 'date-filter',
}: DateFilterBarProps) {
  const { t, i18n } = useTranslation();
  const label = selectedDate !== null
    ? t('calendar.selectedDateLabel', { date: formatSelectedDate(selectedDate, i18n.language) })
    : t('calendar.pickDate');

  return (
    <View style={styles.container} testID={testIDPrefix}>
      <View style={[styles.bar, selectedDate !== null && styles.barActive]}>
        <Pressable
          accessibilityLabel={label}
          accessibilityRole="button"
          accessibilityState={{ expanded: isOpen }}
          onPress={onToggleOpen}
          style={styles.main}
          testID={`${testIDPrefix}-toggle`}
        >
          <CalendarIcon color={selectedDate !== null ? colors.brand : colors.textSecondary} size={20} />
          <Text numberOfLines={1} style={[styles.label, selectedDate !== null && styles.labelActive]}>{label}</Text>
        </Pressable>
        {selectedDate !== null ? (
          <Pressable
            accessibilityLabel={t('calendar.clearDateA11y')}
            accessibilityRole="button"
            hitSlop={4}
            onPress={onClear}
            style={styles.clear}
            testID={`${testIDPrefix}-clear`}
          >
            <CloseIcon color={colors.textSecondary} size={18} />
          </Pressable>
        ) : null}
      </View>
      {isOpen ? (
        <View style={styles.calendar}>
          <CalendarMonthView
            canGoNext={canGoNext}
            counts={counts}
            month={month}
            onNextMonth={onNextMonth}
            onPreviousMonth={onPreviousMonth}
            onRetry={onRetryMonth}
            onSelectDate={onSelectDate}
            selectedDate={selectedDate}
            status={status}
            testIDPrefix={`${testIDPrefix}-calendar`}
            today={today}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.md },
  bar: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: minTouchTarget,
  },
  barActive: { borderColor: colors.brand },
  main: { alignItems: 'center', columnGap: spacing.sm, flex: 1, flexDirection: 'row', minHeight: minTouchTarget, minWidth: 0, paddingHorizontal: spacing.md },
  label: { color: colors.textSecondary, flexShrink: 1, fontSize: 15 },
  labelActive: { color: colors.textPrimary, fontWeight: '600' },
  clear: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
  calendar: { marginTop: spacing.sm },
});
