import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, type ScrollViewInstance } from 'react-native';
import { Pressable } from '../components/Pressable';
import { COLLECTION_ICON_KEYS, resolveCollectionIconComponent, type CollectionIconKey } from './collectionIcons';
import { colors, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';

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
  /** False: the grid does not scroll by itself, so a drag on it moves the form around it (the keyboard is up; see CategoryEditorDialog). */
  readonly scrollEnabled?: boolean;
}

/** A fixed 10-icon grid (see collectionIcons.ts) for choosing a Collection's decorative icon at create/edit time - shown below the name field wherever a Collection's name can be entered. */
/** Each tile's side as a share of the grid's width - five to a row with the gaps between them. */
const TILE_SHARE = 0.18;
/** Rows shown before the grid scrolls. */
const VISIBLE_ROWS = 2;
const GRID_VERTICAL_PADDING = 2;

export function CollectionIconPicker({ selected, onSelect, tile, disabled, isVisible = true, scrollEnabled = true }: CollectionIconPickerProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<ScrollViewInstance>(null);
  useEffect(() => { if (isVisible) scrollRef.current?.scrollTo({ animated: false, y: 0 }); }, [isVisible]);
  // Square tiles, five to a row: each side is 18% of the grid's measured width (the rest is the gaps), never under the touch target.
  // The grid shows two rows at a time and scrolls for the rest - its height follows the tile size, so the two rows always fit exactly.
  const [gridWidth, setGridWidth] = useState(0);
  const tileSize = Math.max(minTouchTarget, Math.floor(gridWidth * TILE_SHARE));
  const visibleHeight = tileSize * VISIBLE_ROWS + spacing.sm * (VISIBLE_ROWS - 1) + GRID_VERTICAL_PADDING * 2;

  return (
    <ScrollView
      contentContainerStyle={styles.grid}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
      onLayout={event => setGridWidth(event.nativeEvent.layout.width)}
      ref={scrollRef}
      scrollEnabled={scrollEnabled}
      showsVerticalScrollIndicator
      style={{ maxHeight: visibleHeight }}
      testID="collection-icon-grid"
    >
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
              { backgroundColor: tile.background, height: tileSize, width: tileSize },
              isSelected && styles.cellSelected,
              disabled && styles.cellDisabled,
            ]}
          >
            <IconComponent color={isSelected ? colors.brandText : tile.icon} size={30} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = themedStyles(() => ({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingVertical: GRID_VERTICAL_PADDING,
    rowGap: spacing.sm,
  },
  // Square, like the Collection's own icon tile beside the name (width and height are set from the measured grid). The selected
  // border is drawn inside the tile, so it is never clipped and never overlaps a neighbour.
  cell: {
    alignItems: 'center',
    aspectRatio: 1,
    borderRadius: radii.md + 6,
    justifyContent: 'center',
  },
  cellSelected: {
    borderColor: colors.brandText,
    borderWidth: 2,
  },
  cellDisabled: {
    opacity: 0.5,
  },
}));
