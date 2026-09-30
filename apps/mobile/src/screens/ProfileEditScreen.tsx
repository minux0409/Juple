import Clipboard from '@react-native-clipboard/clipboard';
import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
import { useAppToast } from '../components/AppToast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { UserAvatar } from '../components/UserAvatar';
import { CloseIcon } from '../icons/CloseIcon';
import { forgetProfileImage, rememberLocalProfileImage } from '../profile/profileImageCache';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';

/** What 저장 will do with the photo: leave it, or upload a newly picked one (removal happens at once, see removePhoto). */
type PhotoChange =
  | { readonly kind: 'keep' }
  | { readonly kind: 'set'; readonly asset: ProfileImageAsset };

const KEEP: PhotoChange = { kind: 'keep' };

/** An avatar is at most ~104dp - the picker already resizes to 512px and re-encodes (same as a Collection's photo). */
const pickProfileImage = pickCollectionIconImage;

const AVATAR_SIZE = 104;

/**
 * 프로필 편집: the photo and the nickname - the only two things a person edits about themselves -
 * plus their Juple ID, read-only, with 복사.
 *
 * The photo is the control: tapping it picks a new one (previewed from the device file and uploaded
 * on 저장 - the app resizes it first; the circle crops it to the center). Only when there is a photo,
 * a small × on its corner removes it - after a confirmation, right away (the server photo is deleted
 * then; a just-picked photo is simply dropped). The nickname is sent on 저장; the server is the only
 * authority on whether it is allowed and answers with a stable code this screen maps to a message.
 */
export function ProfileEditScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const authenticatedRequest = useAuthenticatedApi();
  const { showNotificationToast } = useAppToast();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [photoChange, setPhotoChange] = useState<PhotoChange>(KEEP);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoveConfirmVisible, setIsRemoveConfirmVisible] = useState(false);
  const [isRemovingPhoto, setIsRemovingPhoto] = useState(false);
  const isSavingRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    getMyProfile(authenticatedRequest)
      .then(loaded => {
        if (isMounted) {
          setProfile(loaded);
          setNickname(loaded.displayName ?? '');
        }
      })
      .catch(() => {
        if (isMounted) {
          setLoadError(t('profile.loadFallback'));
        }
      });
    return () => {
      isMounted = false;
    };
  }, [authenticatedRequest, t]);

  const pickPhoto = async () => {
    setError(null);
    const picked = await pickProfileImage(t);
    if (picked.kind === 'picked') {
      setPhotoChange({ kind: 'set', asset: picked.asset });
    } else if (picked.kind === 'error') {
      setError(picked.message);
    }
  };

  const hasPhoto = photoChange.kind === 'set' || !!profile?.profileImageUrl;
  const isBusy = isSaving || isRemovingPhoto;

  /** Confirmed ×: a just-picked photo is dropped; a saved photo is deleted on the server right away. */
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

  const copyJupleId = () => {
    if (profile) {
      Clipboard.setString(displayedJupleId);
      showNotificationToast(t('account.jupleIdCopied'));
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
          {loadError ? <Text style={styles.error}>{loadError}</Text> : <ActivityIndicator />}
        </View>
      </StackScreenSafeArea>
    );
  }

  const previewUrl = photoChange.kind === 'set' ? photoChange.asset.uri : profile.profileImageUrl;

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.photoSection}>
          {/* The avatar and its × are siblings (never nested), so tapping × can never also open the picker. */}
          <View style={styles.photoFrame}>
            <Pressable
              accessibilityLabel={t('profile.changePhoto')}
              accessibilityRole="button"
              accessibilityState={{ disabled: isBusy }}
              disabled={isBusy}
              onPress={pickPhoto}
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
            {hasPhoto ? (
              <Pressable
                accessibilityLabel={t('profile.removePhoto')}
                accessibilityRole="button"
                accessibilityState={{ disabled: isBusy, busy: isRemovingPhoto }}
                disabled={isBusy}
                hitSlop={8}
                onPress={() => setIsRemoveConfirmVisible(true)}
                style={styles.removeBadge}
                testID="profile-photo-remove"
              >
                {isRemovingPhoto ? <ActivityIndicator color={colors.surface} size="small" /> : <CloseIcon color={colors.surface} size={16} strokeWidth={2.5} />}
              </Pressable>
            ) : null}
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

        <View style={styles.labelRow}>
          <Text style={[styles.label, styles.labelInRow]}>{t('myPage.jupleId')}</Text>
          <Pressable
            accessibilityLabel={`${t('myPage.jupleId')} ${t('account.copy')}`}
            accessibilityRole="button"
            hitSlop={8}
            onPress={copyJupleId}
            style={styles.copyButton}
            testID="profile-juple-id-copy"
          >
            <Text style={styles.copyLabel}>{t('account.copy')}</Text>
          </Pressable>
        </View>
        <View style={styles.readOnlyField} testID="profile-juple-id">
          <Text selectable style={[styles.readOnlyValue, ltrTextStyle]}>{displayedJupleId}</Text>
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
  // A 30dp danger-colored × on the photo's lower-end corner, outlined in the surface color so it
  // stays visible on any photo; hitSlop extends it to a full touch target.
  removeBadge: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderColor: colors.surface,
    borderRadius: 15,
    borderWidth: 2,
    bottom: 0,
    end: 0,
    height: 30,
    justifyContent: 'center',
    position: 'absolute',
    width: 30,
  },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: spacing.xs, marginTop: spacing.lg },
  labelRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs, marginTop: spacing.lg },
  labelInRow: { flexShrink: 1, marginBottom: 0, marginTop: 0 },
  copyButton: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget - 12, paddingHorizontal: spacing.sm },
  copyLabel: { color: colors.brand, fontSize: 14, fontWeight: '600' },
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
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md + 4,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  readOnlyValue: { color: colors.textPrimary, fontSize: 16, fontWeight: '600', letterSpacing: 1 },
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
