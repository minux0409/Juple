import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Pressable } from '../components/Pressable';
import { CloseIcon } from '../icons/CloseIcon';
import { colors, minTouchTarget, spacing, themedStyles } from '../theme/tokens';

interface SelectionTopBarProps {
  readonly count: number;
  /** Everything selectable is selected (so the toggle offers 전체 해제). */
  readonly allSelected: boolean;
  /** Nothing to select (an empty list): 전체 선택 is not offered. */
  readonly canSelectAll: boolean;
  /** 전체 선택 is reading the whole list (server pages): shown busy, not pressable. */
  readonly isSelectingAll?: boolean;
  readonly onSelectAll: () => void;
  readonly onClear: () => void;
  readonly onExit: () => void;
  /** A running bulk action: nothing here can change the selection under it. */
  readonly disabled?: boolean;
}

/**
 * The header of selection mode: close (leave selection), "N개 선택됨", and one 전체 선택 / 전체 해제 toggle. It sits above the list, so the
 * screen's own search, sort and view switch stay where they are.
 */
export function SelectionTopBar({ count, allSelected, canSelectAll, isSelectingAll, onSelectAll, onClear, onExit, disabled }: SelectionTopBarProps) {
  const { t } = useTranslation();
  const toggleLabel = allSelected ? t('selection.clearAll') : t('selection.selectAll');
  return (
    <View style={styles.bar} testID="selection-top-bar">
      <Pressable accessibilityLabel={t('selection.exit')} accessibilityRole="button" disabled={disabled} onPress={onExit} style={styles.close} testID="selection-exit">
        <CloseIcon color={colors.textPrimary} size={22} />
      </Pressable>
      <Text accessibilityLiveRegion="polite" numberOfLines={1} style={styles.count} testID="selection-count">
        {count > 0 ? t('selection.selectedCount', { count }) : t('selection.selectItems')}
      </Text>
      {canSelectAll || allSelected ? (
        <Pressable
          accessibilityLabel={toggleLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled: disabled === true || isSelectingAll === true, busy: isSelectingAll === true }}
          disabled={disabled === true || isSelectingAll === true}
          onPress={allSelected ? onClear : onSelectAll}
          style={styles.toggle}
          testID="selection-toggle-all"
        >
          <Text numberOfLines={2} style={styles.toggleLabel}>{toggleLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  bar: { alignItems: 'center', backgroundColor: colors.background, flexDirection: 'row', gap: spacing.sm, minHeight: minTouchTarget + spacing.sm, paddingHorizontal: spacing.md },
  close: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
  count: { color: colors.textPrimary, flex: 1, fontSize: 17, fontWeight: '700', minWidth: 0 },
  toggle: { alignItems: 'center', justifyContent: 'center', maxWidth: '40%', minHeight: minTouchTarget, paddingHorizontal: spacing.sm },
  toggleLabel: { color: colors.brandText, fontSize: 14, fontWeight: '600', textAlign: 'center' },
}));
