import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { LinkSortOption } from '../settings/sortPreference';
import { colors, radii, spacing } from '../theme/tokens';

interface LinkSortChipsProps {
  /** The sort actually in effect ('newest' | 'oldest' = the date chip with ↓ / ↑, 'title' = the name chip). */
  readonly sort: LinkSortOption;
  readonly dateLabel: string;
  readonly nameLabel: string;
  readonly dateNewestA11yLabel: string;
  readonly dateOldestA11yLabel: string;
  /** First press picks the date order (newest first); pressed again it flips ↓ newest ↔ ↑ oldest - the caller decides. */
  readonly onPressDate: () => void;
  readonly onPressName: () => void;
  /** testIDs are `${testIDPrefix}-date` and `${testIDPrefix}-name`. */
  readonly testIDPrefix: string;
}

/**
 * The one link-sort control (시간순 ↓/↑ and 이름순 chips) shared by a Collection and Home, so the two
 * never grow different sorting UIs. Pure presentation - the caller owns the preference and the
 * semantics (see useSortPreference, sortCollectionItemsByName).
 */
export function LinkSortChips({ sort, dateLabel, nameLabel, dateNewestA11yLabel, dateOldestA11yLabel, onPressDate, onPressName, testIDPrefix }: LinkSortChipsProps) {
  const isDate = sort !== 'title';
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityLabel={sort === 'oldest' ? dateOldestA11yLabel : dateNewestA11yLabel}
        accessibilityRole="button"
        accessibilityState={{ selected: isDate }}
        onPress={onPressDate}
        style={[styles.chip, isDate && styles.chipSelected]}
        testID={`${testIDPrefix}-date`}
      >
        <Text style={[styles.label, isDate && styles.labelSelected]}>
          {isDate ? `${dateLabel} ${sort === 'oldest' ? '↑' : '↓'}` : dateLabel}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: sort === 'title' }}
        onPress={onPressName}
        style={[styles.chip, sort === 'title' && styles.chipSelected]}
        testID={`${testIDPrefix}-name`}
      >
        <Text style={[styles.label, sort === 'title' && styles.labelSelected]}>{nameLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: spacing.xs },
  chip: {
    borderColor: colors.inputBorder,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
  },
  chipSelected: { backgroundColor: colors.brand, borderColor: colors.brand },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  labelSelected: { color: colors.surface },
});
