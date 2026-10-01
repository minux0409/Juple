import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionMenuDialog, type ActionMenuDialogAction } from '../components/ActionMenuDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EditIcon } from '../icons/EditIcon';
import { ImageIcon } from '../icons/ImageIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

const THUMBNAIL_SIZE = 96;
const EDIT_BADGE_SIZE = 28;

interface RepresentativePhotoFieldProps {
  /** The photo shown (the user's own, or the link's automatic preview), or null for none. */
  readonly photoUrl: string | null;
  /** True for the user's own photo - only that can be deleted (the automatic preview cannot). */
  readonly isRemovable: boolean;
  /** A photo change/removal is in flight: only this field shows it - never the whole screen. */
  readonly isBusy: boolean;
  readonly disabled?: boolean;
  /** 사진 추가 / 사진 변경: the caller opens the picker and stores the result. */
  readonly onChoose: () => void;
  /** 사진 삭제, after the user confirmed it here. */
  readonly onRemove: () => void;
}

/**
 * 대표 사진: an Item's one photo, as simple as the profile photo. No photo: a 사진 추가 button. A
 * photo: its thumbnail with a small pencil - tapping either opens 사진 변경 / 사진 삭제 (삭제 only for
 * the user's own photo, and only after a confirmation). Never a second "+" - an Item has one photo.
 * Shared by ItemDetailsScreen (saves at once) and NewLinkReviewScreen (stages until 저장).
 */
export function RepresentativePhotoField({ photoUrl, isRemovable, isBusy, disabled = false, onChoose, onRemove }: RepresentativePhotoFieldProps) {
  const { t } = useTranslation();
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isRemoveConfirmVisible, setIsRemoveConfirmVisible] = useState(false);
  const afterMenuRef = useRef<(() => void) | null>(null);
  const isInactive = isBusy || disabled;

  const runAfterMenu = () => {
    const action = afterMenuRef.current;
    afterMenuRef.current = null;
    action?.();
  };

  /**
   * Closes the menu, then runs the chosen action. On iOS a system picker or another modal can't be
   * presented while this one is still animating away, so it waits for the menu's onDismiss;
   * Android has no such limit (and no onDismiss), so it runs right away.
   */
  const chooseAction = (action: () => void) => () => {
    afterMenuRef.current = action;
    setIsMenuVisible(false);
    if (Platform.OS !== 'ios') {
      runAfterMenu();
    }
  };

  const menuActions: ActionMenuDialogAction[] = [
    { label: t('profile.photoChange'), icon: ImageIcon, onPress: chooseAction(onChoose) },
    ...(isRemovable
      ? [{ label: t('profile.photoRemove'), destructive: true, icon: TrashIcon, onPress: chooseAction(() => setIsRemoveConfirmVisible(true)) }]
      : []),
  ];

  return (
    <View style={styles.section} testID="representative-photo">
      <Text style={styles.label}>{t('item.representativePhoto')}</Text>
      {photoUrl ? (
        <Pressable
          accessibilityLabel={t('item.editRepresentativePhoto')}
          accessibilityRole="button"
          accessibilityState={{ disabled: isInactive, busy: isBusy }}
          disabled={isInactive}
          onPress={() => setIsMenuVisible(true)}
          style={styles.thumbnailButton}
          testID="representative-photo-edit"
        >
          <Image source={{ uri: photoUrl }} style={styles.thumbnail} testID="representative-photo-image" />
          {isBusy ? (
            <View style={styles.busyOverlay} testID="representative-photo-busy">
              <ActivityIndicator color={colors.surface} />
            </View>
          ) : (
            <View style={styles.editBadge}>
              <EditIcon color={colors.textPrimary} size={14} />
            </View>
          )}
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isInactive, busy: isBusy }}
          disabled={isInactive}
          onPress={onChoose}
          style={[styles.addButton, isInactive && styles.inactive]}
          testID="representative-photo-add"
        >
          {isBusy ? (
            <ActivityIndicator color={colors.brand} testID="representative-photo-busy" />
          ) : (
            <>
              <ImageIcon color={colors.brand} size={18} />
              <Text numberOfLines={2} style={styles.addLabel}>{t('item.addPhoto')}</Text>
            </>
          )}
        </Pressable>
      )}
      <ActionMenuDialog
        actions={menuActions}
        cancelLabel={t('common.cancel')}
        onCancel={() => setIsMenuVisible(false)}
        onDismiss={runAfterMenu}
        visible={isMenuVisible}
      />
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
        message={t('item.deletePhotoConfirmMessage')}
        onCancel={() => setIsRemoveConfirmVisible(false)}
        onConfirm={() => {
          setIsRemoveConfirmVisible(false);
          onRemove();
        }}
        title={t('item.deletePhotoConfirmTitle')}
        visible={isRemoveConfirmVisible}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { alignItems: 'flex-start', marginTop: 20 },
  label: { color: colors.textSecondary, fontSize: 14, fontWeight: '600', marginBottom: spacing.sm },
  thumbnailButton: { borderRadius: radii.md, height: THUMBNAIL_SIZE, width: THUMBNAIL_SIZE },
  thumbnail: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, height: THUMBNAIL_SIZE, width: THUMBNAIL_SIZE },
  busyOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderRadius: radii.md,
    justifyContent: 'center',
  },
  editBadge: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: EDIT_BADGE_SIZE / 2,
    borderWidth: 1,
    bottom: -6,
    end: -6,
    height: EDIT_BADGE_SIZE,
    justifyContent: 'center',
    position: 'absolute',
    width: EDIT_BADGE_SIZE,
  },
  addButton: {
    alignItems: 'center',
    borderColor: colors.brand,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs + 2,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.lg,
  },
  addLabel: { color: colors.brand, flexShrink: 1, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  inactive: { opacity: 0.5 },
});
