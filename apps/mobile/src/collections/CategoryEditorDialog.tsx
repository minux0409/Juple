import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CollectionColorPicker } from './CollectionColorPicker';
import { CollectionIconPicker } from './CollectionIconPicker';
import { resolveCollectionColorTile, type CollectionColorValue } from './collectionColors';
import { resolveCollectionIconComponent, type CollectionIconKey } from './collectionIcons';
import { colors, radii, spacing } from '../theme/tokens';

interface CategoryEditorDialogProps {
  readonly visible: boolean;
  readonly mode: 'create' | 'edit';
  readonly initialName: string;
  readonly initialIcon: CollectionIconKey;
  readonly initialColor: CollectionColorValue;
  readonly isSubmitting: boolean;
  /** Set by the caller after a failed onSubmit (validation or API failure) - the dialog itself
   * stays open/visible so the user can fix the name or retry, matching this app's existing
   * "each attribute mutation is independent, a partial failure is never rolled back" contract
   * (see CollectionDetailsScreen's own submitEdit for the edit-mode case: name can succeed while
   * icon/color fails, and the dialog stays open showing exactly that failure). */
  readonly error: string | null;
  readonly onSubmit: (name: string, icon: CollectionIconKey, color: CollectionColorValue) => void;
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

  useEffect(() => {
    if (visible) {
      setName(initialName);
      setIcon(initialIcon);
      setColor(initialColor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-seeds the draft on the false->true transition (a fresh open), not on every render of the caller passing the same initial* snapshot.
  }, [visible]);

  const IconComponent = resolveCollectionIconComponent(icon);
  const tile = resolveCollectionColorTile(color);
  const isSubmitDisabled = isSubmitting || !name.trim();

  const handleSubmit = () => {
    if (isSubmitDisabled) {
      return;
    }
    onSubmit(name, icon, color);
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
              <View style={[styles.previewTile, { backgroundColor: tile.background }]}>
                <IconComponent color={tile.icon} size={26} />
              </View>
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
            <CollectionIconPicker disabled={isSubmitting} isVisible={visible} onSelect={setIcon} selected={icon} tile={tile} />

            <Text style={styles.sectionTitle}>{t('collections.colorSectionTitle')}</Text>
            <CollectionColorPicker disabled={isSubmitting} onSelect={setColor} selected={color} />

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>

          <View style={styles.buttonRow}>
            <Pressable
              accessibilityLabel={t('common.cancel')}
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={onCancel}
              style={styles.cancelButton}
            >
              <Text style={styles.cancelButtonLabel}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={mode === 'create' ? t('collections.createAction') : t('common.save')}
              accessibilityRole="button"
              accessibilityState={{ disabled: isSubmitDisabled, busy: isSubmitting }}
              disabled={isSubmitDisabled}
              onPress={handleSubmit}
              style={[styles.confirmButton, isSubmitDisabled && styles.confirmButtonDisabled]}
            >
              {isSubmitting ? (
                <ActivityIndicator color={colors.surface} size="small" />
              ) : (
                <Text style={styles.confirmButtonLabel}>
                  {mode === 'create' ? t('collections.createAction') : t('common.save')}
                </Text>
              )}
            </Pressable>
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
  previewTile: {
    alignItems: 'center',
    borderRadius: radii.md + 6,
    height: 44,
    justifyContent: 'center',
    width: 44,
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
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  cancelButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.sm + 4,
  },
  cancelButtonLabel: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.sm + 4,
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonLabel: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '600',
  },
});
