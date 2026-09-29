import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text } from 'react-native';
import { ChevronIcon } from '../icons/ChevronIcon';
import { colors, radii, spacing } from '../theme/tokens';

interface DateSectionHeaderProps {
  /** The section's localized label - 오늘, 어제, 이번 주 or a month (see groupByLocalDate). */
  readonly label: string;
  /** Every link in the section, whether it is expanded or not. */
  readonly count: number;
  readonly isExpanded: boolean;
  readonly onPress: () => void;
}

/**
 * The header of one date section in a date-grouped list (History, a Collection sorted by date): the
 * section's label and link count, tapped to expand/collapse. Opens the section's card - its rows
 * (dateAccordionStyles.row/rowLast) or grid body (gridBody) close it.
 */
export function DateSectionHeader({ label, count, isExpanded, onPress }: DateSectionHeaderProps) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: isExpanded }}
      onPress={onPress}
      style={[dateAccordionStyles.header, !isExpanded && dateAccordionStyles.headerCollapsed]}
    >
      <Text style={dateAccordionStyles.headerLabel}>{t('history.sectionHeader', { label, count })}</Text>
      <ChevronIcon color={colors.textSecondary} direction={isExpanded ? 'up' : 'down'} size={18} />
    </Pressable>
  );
}

export const dateAccordionStyles = StyleSheet.create({
  // A date section reads as one grouped card: the header always rounds its top corners, and only
  // rounds its bottom corners (and gets a matching gap below) when collapsed - i.e. when it's the
  // entire visible card for that date on its own. When expanded, that bottom corner/gap job moves
  // to the section's last item instead (see rowLast), so there is exactly one gap between this
  // date's card and the next, never a doubled one.
  header: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.inputBorder,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopWidth: 1,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerCollapsed: {
    borderBottomWidth: 1,
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
    marginBottom: spacing.sm + 2,
  },
  headerLabel: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  // Every item in an expanded section shares one continuous side border with the header above it
  // and a thin top separator - never a full bold rule, and inset from the screen edge by the same
  // amount as the header. Only the section's last item closes the shape off with rounded bottom
  // corners and the gap before the next date's card.
  row: {
    borderColor: colors.inputBorder,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopWidth: 1,
  },
  rowLast: {
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
    borderBottomWidth: 1,
    marginBottom: spacing.sm + 2,
  },
  // The expanded body of a date card in image view (the header opens the card).
  gridBody: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
    borderBottomWidth: 1,
    borderColor: colors.inputBorder,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopWidth: 1,
    marginBottom: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  gridWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  // The same image-view body, one virtualized list row per line of tiles (see DateHistoryScreen):
  // every line carries the side borders, the first opens the body under the header, the last
  // closes the card - so it reads exactly like gridBody while only the lines on screen mount.
  gridRow: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
  },
  gridRowFirst: { borderTopWidth: 1, paddingTop: spacing.sm },
  gridRowLast: {
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
    borderBottomWidth: 1,
    marginBottom: spacing.sm + 2,
  },
});
