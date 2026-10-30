import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '../components/Pressable';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CategoryIconTile } from './CategoryIconTile';
import { CollectionColorPicker } from './CollectionColorPicker';
import { CollectionIconPicker } from './CollectionIconPicker';
import { resolveCollectionColorTile, type CollectionColorValue } from './collectionColors';
import { KEEP_ICON_IMAGE, pickCollectionIconImage, type CollectionIconImageChange, type PickedImageAsset } from './collectionIconImage';
import { type CollectionIconKey } from './collectionIcons';
import { DialogActions } from '../components/DialogActions';
import { ImageIcon } from '../icons/ImageIcon';
import { colors, radii, spacing, themedStyles } from '../theme/tokens';
import { KeyboardSafeView } from '../components/KeyboardSafeView';
import { KeyboardFieldScope } from '../components/keyboardToolbar';
import { PhotoCropper } from '../images/PhotoCropper';

/** A larger working copy than the saved photo: the crop keeps a part of it, and the result is still up to CROP_OUTPUT_MAX. */
const COLLECTION_PHOTO_WORKING_EDGE = 1600;

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
  // The photo just picked, being fitted to the tile (the same crop screen as a profile photo, with the tile's rounded square).
  const [crop, setCrop] = useState<PickedImageAsset | null>(null);

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
    const picked = await pickCollectionIconImage(t, { maxEdge: COLLECTION_PHOTO_WORKING_EDGE, quality: 0.9 });
    if (picked.kind === 'picked') {
      // Not used as it is: the crop decides what the tile shows; cancelling it leaves the photo unchanged.
      setCrop(picked.asset);
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
      <KeyboardFieldScope>
      <KeyboardSafeView
        style={[
          styles.overlay,
          { paddingTop: DIALOG_TOP_CLEARANCE + insets.top, paddingBottom: spacing.xl + insets.bottom },
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
              {/* No autoFocus: the dialog appears first, centred and still; the keyboard opens when the person taps the name (as on
                  Android). Focusing at once made iOS raise the keyboard mid-appearance and the card jump. */}
              <ThemedTextInput
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
                <ImageIcon color={colors.brandText} size={18} />
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
      </KeyboardSafeView>
      {crop !== null ? (
        <PhotoCropper
          knownSize={crop}
          onApply={cropped => {
            setCrop(null);
            setImageChange({ kind: 'set', asset: cropped });
          }}
          onCancel={() => setCrop(null)}
          uri={crop.uri}
          variant="collection"
        />
      ) : null}
      </KeyboardFieldScope>
    </Modal>
  );
}

/**
 * How far below the safe area the card may rise when space runs short (the keyboard is up): clear of the screen's title row.
 * With only a small margin the card rose into that row and its rounded corner left a sliver of the controls there showing (the
 * Collections screen's purple "+"), looking like part of the dialog. Without the keyboard the card stays centred; with it, the card
 * shrinks into the room that is left and its content scrolls inside.
 */
const DIALOG_TOP_CLEARANCE = 64;

const styles = themedStyles(() => ({
  // The theme's scrim (darker in Dark): with the keyboard up the card rises into the screen's header, and the screen's purple "+"
  // under a light scrim showed around the card's rounded corner as if a purple corner stuck out of the dialog.
  overlay: {
    alignItems: 'center',
    backgroundColor: colors.scrim,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  // A thin edge in the theme's border colour makes the card's own corner unmistakable over whatever is behind it; overflow
  // hidden keeps every child (and Android's drawing) inside the rounded corners however the keyboard resizes the window.
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
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
    borderColor: colors.brandText,
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
    color: colors.brandText,
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
    color: colors.dangerText,
    fontSize: 14,
    marginTop: spacing.md,
  },
  buttonRow: {
    marginTop: spacing.lg,
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
}));
