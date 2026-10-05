import Clipboard from '@react-native-clipboard/clipboard';
import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError } from '../api/ApiError';
import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MAX_STORAGE_LENGTH,
  getMyProfile,
  getNicknameErrorKey,
  removeMyProfileImage,
  setMyDisplayName,
  setMyProfileImage,
  type ProfileImageAsset,
  type UserProfile,
} from '../api/profileApi';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { formatJupleId } from '../collections/api/collaborationApi';
import { pickCollectionIconImage } from '../collections/collectionIconImage';
import { ActionMenuDialog, type ActionMenuDialogAction } from '../components/ActionMenuDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LoadFailureState } from '../components/LoadFailureState';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { UserAvatar } from '../components/UserAvatar';
import { CheckIcon } from '../icons/CheckIcon';
import { CopyIcon } from '../icons/CopyIcon';
import { EditIcon } from '../icons/EditIcon';
import { ImageIcon } from '../icons/ImageIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { forgetProfileImage, rememberLocalProfileImage } from '../profile/profileImageCache';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';
import { KeyboardSafeView } from '../components/KeyboardSafeView';

/** What 저장 will do with the photo: leave it, or upload a newly picked one (removal happens at once, see removePhoto). */
type PhotoChange =
  | { readonly kind: 'keep' }
  | { readonly kind: 'set'; readonly asset: ProfileImageAsset };

const KEEP: PhotoChange = { kind: 'keep' };

/** An avatar is at most ~104dp - the picker already resizes to 512px and re-encodes (same as a Collection's photo). */
const pickProfileImage = pickCollectionIconImage;

const AVATAR_SIZE = 104;
const EDIT_BADGE_SIZE = 28;
/** How long the copy icon shows a check after a copy - the only in-app copy feedback (see copyJupleId). */
const COPIED_FEEDBACK_MS = 1500;

/**
 * 프로필 편집: the photo and the nickname - the only two things a person edits about themselves -
 * plus their Juple ID, read-only, with a copy icon inside its field.
 *
 * The photo (or the small pencil on its corner) opens one menu: 사진 변경 / 사진 삭제 when there is a
 * photo, 사진 선택 when there is none. A picked photo is previewed from the device file and uploaded
 * on 저장 (the app resizes it first; the circle crops it to the center). 사진 삭제 asks first, then
 * removes it right away (the server photo is deleted then; a just-picked photo is simply dropped).
 * The nickname is sent on 저장; the server is the only authority on whether it is allowed and
 * answers with a stable code this screen maps to a message.
 */
export function ProfileEditScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const authenticatedRequest = useAuthenticatedApi();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadError, setLoadError] = useState<{ readonly cause: unknown } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [nickname, setNickname] = useState('');
  const [photoChange, setPhotoChange] = useState<PhotoChange>(KEEP);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoveConfirmVisible, setIsRemoveConfirmVisible] = useState(false);
  const [isRemovingPhoto, setIsRemovingPhoto] = useState(false);
  const [isPhotoMenuVisible, setIsPhotoMenuVisible] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const isSavingRef = useRef(false);
  const isPickingRef = useRef(false);
  const afterPhotoMenuRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let isMounted = true;
    setLoadError(null);
    getMyProfile(authenticatedRequest)
      .then(loaded => {
        if (isMounted) {
          setProfile(loaded);
          setNickname(loaded.displayName ?? '');
        }
      })
      .catch(caughtError => {
        if (isMounted) {
          setLoadError({ cause: caughtError });
        }
      });
    return () => {
      isMounted = false;
    };
  }, [authenticatedRequest, reloadToken]);

  useEffect(() => {
    if (!isCopied) {
      return;
    }
    const timeout = setTimeout(() => setIsCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timeout);
  }, [isCopied]);

  /** One picker at a time - a second tap while the system picker is opening does nothing. */
  const pickPhoto = async () => {
    if (isPickingRef.current) {
      return;
    }
    isPickingRef.current = true;
    setError(null);
    try {
      const picked = await pickProfileImage(t);
      if (picked.kind === 'picked') {
        setPhotoChange({ kind: 'set', asset: picked.asset });
      } else if (picked.kind === 'error') {
        setError(picked.message);
      }
    } finally {
      isPickingRef.current = false;
    }
  };

  const runAfterPhotoMenu = () => {
    const action = afterPhotoMenuRef.current;
    afterPhotoMenuRef.current = null;
    action?.();
  };

  /**
   * Closes the photo menu, then runs the chosen action. On iOS a system picker or another modal
   * can't be presented while this one is still animating away, so it waits for the menu's
   * onDismiss; Android has no such limit (and no onDismiss), so it runs right away.
   */
  const choosePhotoAction = (action: () => void) => () => {
    afterPhotoMenuRef.current = action;
    setIsPhotoMenuVisible(false);
    if (Platform.OS !== 'ios') {
      runAfterPhotoMenu();
    }
  };

  const hasPhoto = photoChange.kind === 'set' || !!profile?.profileImageUrl;
  const isBusy = isSaving || isRemovingPhoto;

  /** Confirmed 사진 삭제: a just-picked photo is dropped; a saved photo is deleted on the server right away. */
  const removePhoto = async () => {
    setIsRemoveConfirmVisible(false);
    if (!profile || isBusy) {
      return;
    }
    setError(null);
    setPhotoChange(KEEP);
    if (!profile.profileImageUrl) {
      return;
    }
    setIsRemovingPhoto(true);
    try {
      const updated = await removeMyProfileImage(authenticatedRequest);
      forgetProfileImage(updated.jupleId);
      setProfile(updated);
    } catch {
      setError(t('profile.photoSaveFallback'));
    } finally {
      setIsRemovingPhoto(false);
    }
  };

  // The shareable form, exactly as shown (`@XXXX-XXXX`) - what is copied is what the user sees.
  const displayedJupleId = profile ? `@${formatJupleId(profile.jupleId)}` : '';

  // No toast of its own: Android 13+ (and e.g. Samsung One UI) already shows its own "copied"
  // message for every clipboard write, and a second, app-made one only doubled it. The icon turns
  // into a check for a moment instead - the same quiet feedback on every platform.
  const copyJupleId = () => {
    if (profile) {
      Clipboard.setString(displayedJupleId);
      setIsCopied(true);
    }
  };

  const photoMenuActions: ActionMenuDialogAction[] = hasPhoto
    ? [
        { label: t('profile.photoChange'), icon: ImageIcon, onPress: choosePhotoAction(pickPhoto) },
        {
          label: t('profile.photoRemove'),
          destructive: true,
          icon: TrashIcon,
          onPress: choosePhotoAction(() => setIsRemoveConfirmVisible(true)),
        },
      ]
    : [{ label: t('profile.photoChoose'), icon: ImageIcon, onPress: choosePhotoAction(pickPhoto) }];
  const openPhotoMenu = () => {
    if (!isBusy && !isPickingRef.current) {
      setIsPhotoMenuVisible(true);
    }
  };

  const save = async () => {
    if (!profile || isSavingRef.current) {
      return;
    }
    isSavingRef.current = true;
    setIsSaving(true);
    setError(null);
    let current = profile;
    try {
      if (nickname !== (profile.displayName ?? '')) {
        try {
          current = await setMyDisplayName(authenticatedRequest, nickname);
        } catch (caughtError) {
          setError(t(getNicknameErrorKey(caughtError), { max: DISPLAY_NAME_MAX_LENGTH }));
          return;
        }
        setProfile(current);
        setNickname(current.displayName ?? '');
      }

      try {
        if (photoChange.kind === 'set') {
          current = await setMyProfileImage(authenticatedRequest, photoChange.asset);
          rememberLocalProfileImage(current.jupleId, current.profileImageVersion, photoChange.asset.uri);
        }
      } catch (caughtError) {
        setProfile(current);
        setError(
          caughtError instanceof ApiError && caughtError.kind === 'badRequest'
            ? t('profile.photoInvalid')
            : t('profile.photoSaveFallback'),
        );
        return;
      }

      navigation.goBack();
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  if (!profile) {
    return (
      <StackScreenSafeArea style={styles.safeArea}>
        <View style={styles.centered}>
          {loadError ? <LoadFailureState error={loadError.cause} message={t('profile.loadFallback')} onRetry={() => setReloadToken(previous => previous + 1)} testID="profile-load-error" /> : <ActivityIndicator />}
        </View>
      </StackScreenSafeArea>
    );
  }

  const previewUrl = photoChange.kind === 'set' ? photoChange.asset.uri : profile.profileImageUrl;

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <KeyboardSafeView>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.photoSection}>
          {/* The avatar and its pencil are siblings (never nested), so one tap is only ever one press -
              and both open the same menu, so there is nothing to open twice. */}
          <View style={styles.photoFrame}>
            <Pressable
              accessibilityLabel={t('profile.changePhoto')}
              accessibilityRole="button"
              accessibilityState={{ disabled: isBusy }}
              disabled={isBusy}
              onPress={openPhotoMenu}
              style={({ pressed }) => [styles.avatarButton, pressed && styles.pressed]}
              testID="profile-photo"
            >
              <UserAvatar
                displayName={nickname}
                imageUrl={previewUrl}
                // A just-picked local file has no server version yet - shown as-is.
                imageVersion={photoChange.kind === 'keep' ? profile.profileImageVersion : null}
                jupleId={profile.jupleId}
                size={AVATAR_SIZE}
              />
            </Pressable>
            <Pressable
              accessibilityLabel={t('profile.editPhoto')}
              accessibilityRole="button"
              accessibilityState={{ disabled: isBusy, busy: isRemovingPhoto }}
              disabled={isBusy}
              hitSlop={8}
              onPress={openPhotoMenu}
              style={({ pressed }) => [styles.editBadge, pressed && styles.pressed]}
              testID="profile-photo-edit"
            >
              {isRemovingPhoto ? <ActivityIndicator color={colors.textSecondary} size="small" /> : <EditIcon color={colors.textPrimary} size={15} strokeWidth={2} />}
            </Pressable>
          </View>
        </View>

        <Text style={styles.label}>{t('myPage.nickname')}</Text>
        <TextInput
          accessibilityLabel={t('myPage.nickname')}
          editable={!isSaving}
          maxLength={DISPLAY_NAME_MAX_STORAGE_LENGTH}
          multiline={false}
          onChangeText={setNickname}
          placeholder={t('myPage.displayNamePlaceholder')}
          placeholderTextColor={colors.textSecondary}
          returnKeyType="done"
          style={styles.input}
          testID="profile-nickname-input"
          value={nickname}
        />

        <Text style={styles.label}>{t('myPage.jupleId')}</Text>
        <View style={styles.readOnlyField} testID="profile-juple-id">
          <Text numberOfLines={1} selectable style={[styles.readOnlyValue, ltrTextStyle]}>{displayedJupleId}</Text>
          <Pressable
            accessibilityLabel={t('profile.copyJupleId')}
            accessibilityRole="button"
            onPress={copyJupleId}
            style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
            testID="profile-juple-id-copy"
          >
            {isCopied
              ? <CheckIcon color={colors.brand} size={20} />
              : <CopyIcon color={colors.textSecondary} size={20} />}
          </Pressable>
        </View>

        {error ? <Text style={styles.error} testID="profile-error">{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: isSaving, disabled: isSaving }}
          disabled={isBusy}
          onPress={save}
          style={[styles.saveButton, isSaving && styles.disabled]}
          testID="profile-save"
        >
          {isSaving ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.saveLabel}>{t('common.save')}</Text>}
        </Pressable>
      </ScrollView>
      </KeyboardSafeView>
      <ActionMenuDialog
        actions={photoMenuActions}
        cancelLabel={t('common.cancel')}
        onCancel={() => setIsPhotoMenuVisible(false)}
        onDismiss={runAfterPhotoMenu}
        visible={isPhotoMenuVisible}
      />
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
        message=""
        onCancel={() => setIsRemoveConfirmVisible(false)}
        onConfirm={removePhoto}
        title={t('profile.removePhotoConfirmTitle')}
        visible={isRemoveConfirmVisible}
      />
    </StackScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: spacing.xl },
  content: { alignSelf: 'center', maxWidth: 560, padding: spacing.xl, width: '100%' },
  photoSection: { alignItems: 'center', marginBottom: spacing.sm },
  photoFrame: { height: AVATAR_SIZE, width: AVATAR_SIZE },
  avatarButton: { borderRadius: AVATAR_SIZE / 2 },
  pressed: { opacity: 0.7 },
  // A small neutral pencil on the photo's lower-end corner, outlined so it stays visible on any
  // photo; hitSlop extends it to a full touch target.
  editBadge: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: EDIT_BADGE_SIZE / 2,
    borderWidth: 1,
    bottom: 2,
    end: 2,
    height: EDIT_BADGE_SIZE,
    justifyContent: 'center',
    position: 'absolute',
    width: EDIT_BADGE_SIZE,
  },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: spacing.xs, marginTop: spacing.lg },
  // The copy icon sits inside the field at its end - the whole square is the touch target.
  copyButton: { alignItems: 'center', flexShrink: 0, height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  readOnlyField: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md + 4,
    flexDirection: 'row',
    minHeight: minTouchTarget,
    paddingStart: spacing.md,
  },
  readOnlyValue: { color: colors.textPrimary, flex: 1, flexShrink: 1, fontSize: 16, fontWeight: '600', letterSpacing: 1 },
  error: { color: colors.danger, fontSize: 14, marginTop: spacing.md },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.xl,
    justifyContent: 'center',
    marginTop: spacing.xl,
    minHeight: minTouchTarget + 4,
    paddingHorizontal: spacing.lg,
  },
  saveLabel: { color: colors.surface, fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
