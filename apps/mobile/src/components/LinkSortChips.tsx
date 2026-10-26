import { Pressable, Text, View } from 'react-native';
import { isNameSort, type LinkSortOption } from '../settings/sortPreference';
import { colors, radii, spacing, themedStyles } from '../theme/tokens';

interface LinkSortChipsProps {
  /** The sort actually in effect ('newest' | 'oldest' = the date chip with ↓ / ↑, 'title' | 'titleDesc' = the name chip with ↑ / ↓). */
  readonly sort: LinkSortOption;
  readonly dateLabel: string;
  readonly nameLabel: string;
  readonly dateNewestA11yLabel: string;
  readonly dateOldestA11yLabel: string;
  readonly nameAscA11yLabel: string;
  readonly nameDescA11yLabel: string;
  /** First press picks the date order (newest first); pressed again it flips ↓ newest ↔ ↑ oldest - the caller decides. */
  readonly onPressDate: () => void;
  /** First press picks A→Z (↑); pressed again it flips ↑ ↔ ↓ - the caller decides (see nextNameSort). */
  readonly onPressName: () => void;
  /** testIDs are `${testIDPrefix}-date` and `${testIDPrefix}-name`. */
  readonly testIDPrefix: string;
}

/**
 * The one link-sort control (시간순 ↓/↑ and 이름순 chips) shared by a Collection and Home, so the two
 * never grow different sorting UIs. Pure presentation - the caller owns the preference and the
 * semantics (see useSortPreference, sortCollectionItemsByName).
 */
export function LinkSortChips({ sort, dateLabel, nameLabel, dateNewestA11yLabel, dateOldestA11yLabel, nameAscA11yLabel, nameDescA11yLabel, onPressDate, onPressName, testIDPrefix }: LinkSortChipsProps) {
  const isDate = !isNameSort(sort);
  const isName = !isDate;
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
          {dateLabel}
          <SortArrow arrow={sort === 'oldest' ? '↑' : '↓'} visible={isDate} />
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel={isName ? (sort === 'titleDesc' ? nameDescA11yLabel : nameAscA11yLabel) : nameLabel}
        accessibilityRole="button"
        accessibilityState={{ selected: isName }}
        onPress={onPressName}
        style={[styles.chip, isName && styles.chipSelected]}
        testID={`${testIDPrefix}-name`}
      >
        <Text style={[styles.label, isName && styles.labelSelected]}>
          {nameLabel}
          <SortArrow arrow={sort === 'titleDesc' ? '↓' : '↑'} visible={isName} />
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * The direction arrow after a chip's label. It always takes its place - invisible on the chip that is not selected - so choosing a
 * chip only changes colours, never a chip's width or the row's layout.
 */
function SortArrow({ arrow, visible }: { readonly arrow: string; readonly visible: boolean }) {
  return (
    <Text accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'} style={!visible && styles.arrowHidden}>
      {` ${arrow}`}
    </Text>
  );
}

const styles = themedStyles(() => ({
  arrowHidden: { color: 'transparent' },
  row: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: spacing.xs },
  chip: {
    borderColor: colors.inputBorder,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
  },
  chipSelected: { backgroundColor: colors.brand, borderColor: colors.brandText },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  labelSelected: { color: colors.onBrand },
}));
