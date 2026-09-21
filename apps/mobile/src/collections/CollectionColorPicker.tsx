import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { COLLECTION_COLOR_KEYS, resolveCollectionColorTile, type CollectionColorKey } from './collectionColors';
import { colors, spacing } from '../theme/tokens';

interface CollectionColorPickerProps {
  readonly selected: CollectionColorKey;
  readonly onSelect: (color: CollectionColorKey) => void;
  readonly disabled?: boolean;
}

const SWATCH_SIZE = 32;

/**
 * A fixed row of preset pastel color swatches (see collectionColors.ts) for choosing a Collection's
 * explicit color at create/edit time - rendered alongside CollectionIconPicker inside
 * CategoryNameAndIconField, never on its own, since icon and color are chosen together in the same
 * expanded panel.
 */
export function CollectionColorPicker({ selected, onSelect, disabled }: CollectionColorPickerProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.row}>
      {COLLECTION_COLOR_KEYS.map(color => {
        const tile = resolveCollectionColorTile(color);
        const isSelected = color === selected;
        return (
          <Pressable
            accessibilityLabel={t('collections.colorOptionA11y', { color: t(`collections.colorNames.${color}`) })}
            accessibilityRole="button"
            accessibilityState={{ disabled: Boolean(disabled), selected: isSelected }}
            disabled={disabled}
            hitSlop={6}
            key={color}
            onPress={() => onSelect(color)}
            testID={`collection-color-option-${color}`}
            style={[
              styles.swatch,
              { backgroundColor: tile.icon },
              isSelected && styles.swatchSelected,
              disabled && styles.swatchDisabled,
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  swatch: {
    borderRadius: SWATCH_SIZE / 2,
    height: SWATCH_SIZE,
    width: SWATCH_SIZE,
  },
  swatchSelected: {
    borderColor: colors.brand,
    borderWidth: 2,
  },
  swatchDisabled: {
    opacity: 0.5,
  },
});
