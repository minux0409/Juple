import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { CollectionIconPicker } from './CollectionIconPicker';
import { resolveCollectionIconComponent, type CollectionIconKey } from './collectionIcons';
import { categoryTilePalette, colors, minTouchTarget, radii, spacing } from '../theme/tokens';

// A not-yet-created Collection has no id to seed a pastel tile color from (see CategoryIconTile) -
// this neutral "draft" tile is shown instead, until the real Collection (and its palette color)
// exists.
const DRAFT_ICON_TILE = { background: colors.surfaceMuted, icon: colors.textSecondary };

interface CategoryNameAndIconFieldProps {
  readonly name: string;
  readonly onChangeName: (name: string) => void;
  readonly namePlaceholder?: string;
  readonly icon: CollectionIconKey;
  readonly onChangeIcon: (icon: CollectionIconKey) => void;
  readonly disabled?: boolean;
  readonly autoFocus?: boolean;
  /** Seeds the same pastel tile color CategoryIconTile shows for this Collection everywhere else -
   * omit while creating a not-yet-existing Collection, which shows a neutral draft tile instead. */
  readonly collectionId?: number;
}

/**
 * The shared "이름 입력 + 아이콘 썸네일(탭하면 grid가 펼쳐짐)" field used identically by
 * CollectionsScreen (생성) and CollectionDetailsScreen (수정) - a "프로필 사진 선택"-style
 * inline-expand pattern instead of an always-open icon grid. Tapping the thumbnail toggles the
 * grid open/closed; picking an icon both applies it and collapses the grid back down (mirrors a
 * typical avatar picker's own "tap thumbnail -> pick -> collapses" flow).
 */
export function CategoryNameAndIconField({
  name,
  onChangeName,
  namePlaceholder,
  icon,
  onChangeIcon,
  disabled,
  autoFocus,
  collectionId,
}: CategoryNameAndIconFieldProps) {
  const { t } = useTranslation();
  const [isIconPickerExpanded, setIsIconPickerExpanded] = useState(false);
  const IconComponent = resolveCollectionIconComponent(icon);
  const tile =
    collectionId !== undefined
      ? categoryTilePalette[Math.abs(collectionId) % categoryTilePalette.length]
      : DRAFT_ICON_TILE;

  return (
    <View>
      <View style={styles.row}>
        <Pressable
          accessibilityLabel={t('collections.iconSectionTitle')}
          accessibilityRole="button"
          accessibilityState={{ disabled: Boolean(disabled), expanded: isIconPickerExpanded }}
          disabled={disabled}
          onPress={() => setIsIconPickerExpanded(previous => !previous)}
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
      {isIconPickerExpanded ? (
        <View style={styles.iconGrid}>
          <CollectionIconPicker
            disabled={disabled}
            onSelect={selected => {
              onChangeIcon(selected);
              setIsIconPickerExpanded(false);
            }}
            selected={icon}
          />
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
  iconGrid: {
    marginTop: spacing.sm + 4,
  },
});
