import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CollectionColorPicker } from './CollectionColorPicker';
import { CollectionIconPicker } from './CollectionIconPicker';
import { resolveCollectionColorTile, type CollectionColorKey } from './collectionColors';
import { resolveCollectionIconComponent, type CollectionIconKey } from './collectionIcons';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

interface CategoryNameAndIconFieldProps {
  readonly name: string;
  readonly onChangeName: (name: string) => void;
  readonly namePlaceholder?: string;
  readonly icon: CollectionIconKey;
  readonly onChangeIcon: (icon: CollectionIconKey) => void;
  /** The currently selected/effective color (see collectionColors.ts) - the caller resolves this
   * up front (a fixed default for a not-yet-created Collection, or the currently-effective color -
   * explicit or deterministic-fallback - for an existing one), so this field never has to guess one
   * itself. Drives both the thumbnail preview and the expanded icon grid's shared tile color. */
  readonly color: CollectionColorKey;
  readonly onChangeColor: (color: CollectionColorKey) => void;
  readonly disabled?: boolean;
  readonly autoFocus?: boolean;
}

/**
 * The shared "이름 입력 + 아이콘 썸네일(탭하면 아이콘 grid + 색상 swatch row가 함께 펼쳐짐)" field used
 * identically by CollectionsScreen (생성) and CollectionDetailsScreen (수정) - a "프로필 사진 선택"-style
 * inline-expand pattern instead of an always-open picker. Tapping the thumbnail toggles the panel
 * open/closed; picking an icon or a color applies it immediately without collapsing the panel, since
 * icon and color are two independent choices a user commonly makes back-to-back in one sitting -
 * only re-tapping the thumbnail collapses it.
 */
export function CategoryNameAndIconField({
  name,
  onChangeName,
  namePlaceholder,
  icon,
  onChangeIcon,
  color,
  onChangeColor,
  disabled,
  autoFocus,
}: CategoryNameAndIconFieldProps) {
  const { t } = useTranslation();
  const [isPickerExpanded, setIsPickerExpanded] = useState(false);
  const IconComponent = resolveCollectionIconComponent(icon);
  const tile = resolveCollectionColorTile(color);

  return (
    <View>
      <View style={styles.row}>
        <Pressable
          accessibilityLabel={t('collections.iconSectionTitle')}
          accessibilityRole="button"
          accessibilityState={{ disabled: Boolean(disabled), expanded: isPickerExpanded }}
          disabled={disabled}
          onPress={() => setIsPickerExpanded(previous => !previous)}
          style={[styles.iconThumbnail, { backgroundColor: tile.background }, disabled && styles.disabled]}
          testID="category-icon-thumbnail-button"
        >
          <IconComponent color={tile.icon} size={22} />
        </Pressable>
        <TextInput
          autoFocus={autoFocus}
          editable={!disabled}
          onChangeText={onChangeName}
          placeholder={namePlaceholder ?? t('collections.namePlaceholder')}
          style={styles.nameInput}
          value={name}
        />
      </View>
      {isPickerExpanded ? (
        <View style={styles.pickerPanel}>
          <CollectionIconPicker disabled={disabled} onSelect={onChangeIcon} selected={icon} tile={tile} />
          <Text style={styles.colorSectionTitle}>{t('collections.colorSectionTitle')}</Text>
          <CollectionColorPicker disabled={disabled} onSelect={onChangeColor} selected={color} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconThumbnail: {
    alignItems: 'center',
    borderRadius: radii.md + 6,
    height: minTouchTarget,
    justifyContent: 'center',
    width: minTouchTarget,
  },
  disabled: {
    opacity: 0.5,
  },
  nameInput: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    color: colors.textPrimary,
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  pickerPanel: {
    marginTop: spacing.sm + 4,
  },
  colorSectionTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: spacing.xs + 2,
    marginTop: spacing.md,
  },
});
