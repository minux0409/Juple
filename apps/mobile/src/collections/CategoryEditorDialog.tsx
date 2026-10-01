import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CategoryIconTile } from './CategoryIconTile';
import { CollectionColorPicker } from './CollectionColorPicker';
import { CollectionIconPicker } from './CollectionIconPicker';
import { resolveCollectionColorTile, type CollectionColorValue } from './collectionColors';
import { KEEP_ICON_IMAGE, pickCollectionIconImage, type CollectionIconImageChange } from './collectionIconImage';
import { type CollectionIconKey } from './collectionIcons';
import { DialogActions } from '../components/DialogActions';
import { ImageIcon } from '../icons/ImageIcon';
import { colors, radii, spacing } from '../theme/tokens';

interface CategoryEditorDialogProps {
  readonly visible: boolean;
  readonly mode: 'create' | 'edit';
  readonly initialName: string;
  readonly initialIcon: CollectionIconKey;
  readonly initialColor: CollectionColorValue;
  /** The Collection's current icon photo (edit mode), if it has one. */
  readonly initialImageUrl?: string | null;
  readonly isSubmitting: boolean;
  /** Set by the caller after a failed onSubmit (validation or API failure) - the dialog itself
   * stays open/visible so the user can fix the name or retry, matching this app's existing
   * "each attribute mutation is independent, a partial failure is never rolled back" contract
   * (see CollectionDetailsScreen's own submitEdit for the edit-mode case: name can succeed while
   * icon/color fails, and the dialog stays open showing exactly that failure). */
  readonly error: string | null;
  /** imageChange: what to do with the icon photo - the caller applies it (see applyCollectionIconImageChange). */
  readonly onSubmit: (name: string, icon: CollectionIconKey, color: CollectionColorValue, imageChange: CollectionIconImageChange) => void;
  readonly onCancel: () => void;
}

/**
 * The one shared "카테고리 이름 + 아이콘 + 색상" form, used identically for creating a new Category
 * (CollectionsScreen's "+", CategoryPickerModal's "+ 새 카테고리" tile) and editing an existing one
 * (CollectionDetailsScreen) - replaces the old per-screen inline "탭하면 아래가 벌어지는" expand
 * panel (CategoryNameAndIconField, now removed) with a single centered dialog, so icon/color choice
 * never shifts surrounding layout and every entry point looks identical. A plain center-fade Modal
 * (the same animationType="fade" convention ConfirmDialog already uses) - not a bottom sheet, since
 * this is a short, self-contained form rather than a scrollable list of options.
 *
 * Fully uncontrolled internally: the caller only ever supplies a starting snapshot
 * (initialName/initialIcon/initialColor, re-seeded every time `visible` turns true - see the effect
 * below) and receives the final values back in onSubmit. This keeps CollectionsScreen/
 * CollectionDetailsScreen/CategoryPickerModal from each having to own a name/icon/color draft
 * themselves - they only need to know what to do once the user actually submits.
 */
export function CategoryEditorDialog({
  visible,
  mode,
  initialName,
  initialIcon,
  initialColor,
  initialImageUrl = null,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: CategoryEditorDialogProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(initialName);
  const [icon, setIcon] = useState(initialIcon);
  const [color, setColor] = useState(initialColor);
  const [imageChange, setImageChange] = useState<CollectionIconImageChange>(KEEP_ICON_IMAGE);
  const [imageError, setImageError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName(initialName);
      setIcon(initialIcon);
      setColor(initialColor);
      setImageChange(KEEP_ICON_IMAGE);
      setImageError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-seeds the draft on the false->true transition (a fresh open), not on every render of the caller passing the same initial* snapshot.
  }, [visible]);

  const tile = resolveCollectionColorTile(color);
  const isSubmitDisabled = isSubmitting || !name.trim();
  // The photo shown right now: a newly picked one, none (removed), or the Collection's current one.
  const imageUri = imageChange.kind === 'set' ? imageChange.asset.uri : imageChange.kind === 'remove' ? null : initialImageUrl;

  const choosePhoto = async () => {
    setImageError(null);
    const picked = await pickCollectionIconImage(t);
    if (picked.kind === 'picked') {
      setImageChange({ kind: 'set', asset: picked.asset });
    } else if (picked.kind === 'error') {
      setImageError(picked.message);
    }
  };

  const removePhoto = () => {
    setImageError(null);
    setImageChange(initialImageUrl ? { kind: 'remove' } : KEEP_ICON_IMAGE);
  };

  // Choosing a built-in icon means "use this icon" - so it also drops the photo.
  const selectIcon = (next: CollectionIconKey) => {
    setIcon(next);
    if (imageUri) {
      removePhoto();
    }
  };

  const handleSubmit = () => {
    if (isSubmitDisabled) {
      return;
    }
    onSubmit(name, icon, color, imageChange);
  };

  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
      <View
        style={[
          styles.overlay,
          { paddingTop: spacing.xl + insets.top, paddingBottom: spacing.xl + insets.bottom },
        ]}
      >
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={isSubmitting ? undefined : onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.card}>
          <Text style={styles.title}>{mode === 'create' ? t('collections.create') : t('collections.editTitle')}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.previewRow}>
              <CategoryIconTile collectionId={0} color={color} icon={icon} imageUrl={imageUri} size={44} />
              <TextInput
                autoFocus
                editable={!isSubmitting}
                onChangeText={setName}
                placeholder={t('collections.namePlaceholder')}
                style={styles.nameInput}
                value={name}
              />
            </View>

            <Text style={styles.sectionTitle}>{t('collections.iconSectionTitle')}</Text>
            {/* Own photo: pick one (resized before upload), or remove it to go back to the icon below. */}
            <View style={styles.photoRow}>
              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={choosePhoto}
                style={[styles.photoButton, isSubmitting && styles.confirmButtonDisabled]}
                testID="collection-editor-choose-photo"
              >
                <ImageIcon color={colors.brand} size={18} />
                <Text numberOfLines={2} style={styles.photoButtonLabel}>
                  {imageUri ? t('collections.iconPhotoChange') : t('collections.iconPhotoChoose')}
                </Text>
              </Pressable>
              {imageUri ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={isSubmitting}
                  onPress={removePhoto}
                  style={[styles.photoRemoveButton, isSubmitting && styles.confirmButtonDisabled]}
                  testID="collection-editor-remove-photo"
                >
                  <Text numberOfLines={2} style={styles.photoRemoveLabel}>{t('collections.iconPhotoRemove')}</Text>
                </Pressable>
              ) : null}
            </View>
            {imageError ? <Text style={styles.error}>{imageError}</Text> : null}
            <CollectionIconPicker disabled={isSubmitting} isVisible={visible} onSelect={selectIcon} selected={icon} tile={tile} />

            <Text style={styles.sectionTitle}>{t('collections.colorSectionTitle')}</Text>
            <CollectionColorPicker disabled={isSubmitting} onSelect={setColor} selected={color} />

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>

          <View style={styles.buttonRow}>
            <DialogActions
              actions={[
                { label: t('common.cancel'), onPress: onCancel, tone: 'secondary', disabled: isSubmitting },
                {
                  label: mode === 'create' ? t('collections.createAction') : t('common.save'),
                  onPress: handleSubmit,
                  tone: 'brand',
                  disabled: isSubmitDisabled,
                  busy: isSubmitting,
                },
              ]}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    maxHeight: '100%',
    maxWidth: 420,
    padding: spacing.xl,
    width: '100%',
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  previewRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  photoRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  photoButton: {
    alignItems: 'center',
    borderColor: colors.brand,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    flexGrow: 1,
    flexShrink: 1,
    gap: spacing.xs + 2,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  photoButtonLabel: {
    color: colors.brand,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  photoRemoveButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexShrink: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  photoRemoveLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  nameInput: {
    backgroundColor: colors.background,
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
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: spacing.xs + 2,
    marginTop: spacing.md + 4,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginTop: spacing.md,
  },
  buttonRow: {
    marginTop: spacing.lg,
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
});
