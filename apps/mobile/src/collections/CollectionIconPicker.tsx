import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { COLLECTION_ICON_KEYS, resolveCollectionIconComponent, type CollectionIconKey } from './collectionIcons';
import { categoryTilePalette, colors, minTouchTarget, radii, spacing } from '../theme/tokens';

interface CollectionIconPickerProps {
  readonly selected: CollectionIconKey;
  readonly onSelect: (icon: CollectionIconKey) => void;
  readonly disabled?: boolean;
}

/** A fixed 10-icon grid (see collectionIcons.ts) for choosing a Collection's decorative icon at create/edit time - shown below the name field wherever a Collection's name can be entered. */
export function CollectionIconPicker({ selected, onSelect, disabled }: CollectionIconPickerProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.grid}>
      {COLLECTION_ICON_KEYS.map((icon, index) => {
        const IconComponent = resolveCollectionIconComponent(icon);
        const isSelected = icon === selected;
        const tile = categoryTilePalette[index % categoryTilePalette.length];
        return (
          <Pressable
            accessibilityLabel={t('collections.iconOptionA11y', { icon: t(`collections.iconNames.${icon}`) })}
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
            <IconComponent color={isSelected ? colors.brand : tile.icon} size={22} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cell: {
    alignItems: 'center',
    borderRadius: radii.md + 6,
    height: minTouchTarget,
    justifyContent: 'center',
    width: minTouchTarget,
  },
  cellSelected: {
    borderColor: colors.brand,
    borderWidth: 2,
  },
  cellDisabled: {
    opacity: 0.5,
  },
});
