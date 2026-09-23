import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, type ScrollViewInstance, StyleSheet, View } from 'react-native';
import { COLLECTION_ICON_KEYS, resolveCollectionIconComponent, type CollectionIconKey } from './collectionIcons';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

interface CollectionIconPickerTile {
  readonly background: string;
  readonly icon: string;
}

interface CollectionIconPickerProps {
  readonly selected: CollectionIconKey;
  readonly onSelect: (icon: CollectionIconKey) => void;
  /**
   * The single pastel {background, icon} pair every cell in this grid renders with (the currently
   * selected/effective color - see collectionColors.ts) - icon choice and color choice are two
   * independent decisions, so every icon must read in the same color rather than each cell picking
   * its own from an unrelated per-index palette (that mismatch, where the grid's own colors never
   * matched the actually-applied tile color, is exactly what motivated making color explicit).
   */
  readonly tile: CollectionIconPickerTile;
  readonly disabled?: boolean;
  /** Modal visibility resets ScrollView's retained offset on each fresh open. */
  readonly isVisible?: boolean;
}

/** A fixed 10-icon grid (see collectionIcons.ts) for choosing a Collection's decorative icon at create/edit time - shown below the name field wherever a Collection's name can be entered. */
export function CollectionIconPicker({ selected, onSelect, tile, disabled, isVisible = true }: CollectionIconPickerProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<ScrollViewInstance>(null);
  useEffect(() => { if (isVisible) scrollRef.current?.scrollTo({ animated: false, y: 0 }); }, [isVisible]);

  return (
    <ScrollView contentContainerStyle={styles.grid} nestedScrollEnabled ref={scrollRef} showsVerticalScrollIndicator style={styles.scroll}>
      {COLLECTION_ICON_KEYS.map(icon => {
        const IconComponent = resolveCollectionIconComponent(icon);
        const isSelected = icon === selected;
        const iconName = t(`collections.iconNames.${icon}`, { defaultValue: icon });
        return (
          <Pressable
            accessibilityLabel={t('collections.iconOptionA11y', { icon: iconName })}
            accessibilityRole="button"
            accessibilityState={{ disabled: Boolean(disabled), selected: isSelected }}
            disabled={disabled}
            key={icon}
            onPress={() => onSelect(icon)}
            testID={`collection-icon-option-${icon}`}
            style={[
              styles.cell,
              { backgroundColor: tile.background },
              isSelected && styles.cellSelected,
              disabled && styles.cellDisabled,
            ]}
          >
            <IconComponent color={isSelected ? colors.brand : tile.icon} size={30} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingVertical: 2,
    rowGap: spacing.sm,
  },
  scroll: { maxHeight: minTouchTarget * 2 + spacing.sm + 4 },
  cell: {
    alignItems: 'center',
    borderRadius: radii.md + 6,
    height: minTouchTarget,
    justifyContent: 'center',
    width: '18%',
  },
  cellSelected: {
    borderColor: colors.brand,
    borderWidth: 2,
  },
  cellDisabled: {
    opacity: 0.5,
  },
});
