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
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { UserAvatar } from '../components/UserAvatar';
import { forgetProfileImage, rememberLocalProfileImage } from '../profile/profileImageCache';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';

/** What the editor will do with the photo on Save: leave it, upload a newly picked one, or remove it. */
type PhotoChange =
  | { readonly kind: 'keep' }
  | { readonly kind: 'set'; readonly asset: ProfileImageAsset }
  | { readonly kind: 'remove' };

const KEEP: PhotoChange = { kind: 'keep' };

/** An avatar is at most ~72dp - the picker already resizes to 512px and re-encodes (same as a Collection's photo). */
const pickProfileImage = pickCollectionIconImage;

/**
 * 프로필 편집: the photo and the nickname - the only two things a person edits about themselves.
 * The Juple ID is shown read-only (it is the account's identifier and cannot be changed here).
 * Nothing is sent until 저장; the server is the only authority on whether a nickname is allowed and
 * answers with a stable code this screen maps to a message. A picked photo is previewed from the
 * device file and uploaded on 저장 (the app resizes it first; the circle crops it to the center).
 */
export function ProfileEditScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const authenticatedRequest = useAuthenticatedApi();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [photoChange, setPhotoChange] = useState<PhotoChange>(KEEP);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
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

  const hasPhotoAfterChange =
    photoChange.kind === 'set' || (photoChange.kind === 'keep' && !!profile?.profileImageUrl);

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
        } else if (photoChange.kind === 'remove' && profile.profileImageUrl) {
          current = await removeMyProfileImage(authenticatedRequest);
          forgetProfileImage(current.jupleId);
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

  const previewUrl = photoChange.kind === 'set' ? photoChange.asset.uri : photoChange.kind === 'remove' ? null : profile.profileImageUrl;

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.photoSection}>
          <UserAvatar
            displayName={nickname}
            imageUrl={previewUrl}
            // A just-picked local file has no server version yet - shown as-is.
            imageVersion={photoChange.kind === 'keep' ? profile.profileImageVersion : null}
            jupleId={profile.jupleId}
            size={72}
          />
          <View style={styles.photoActions}>
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={pickPhoto}
              style={styles.photoAction}
              testID="profile-photo-change"
            >
              <Text style={styles.photoActionLabel}>{t('profile.changePhoto')}</Text>
            </Pressable>
            {hasPhotoAfterChange ? (
              <Pressable
                accessibilityRole="button"
                disabled={isSaving}
                onPress={() => setPhotoChange(profile.profileImageUrl ? { kind: 'remove' } : KEEP)}
                style={styles.photoAction}
                testID="profile-photo-remove"
              >
                <Text style={styles.photoRemoveLabel}>{t('profile.removePhoto')}</Text>
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
        <Text style={styles.hint}>{t('profile.nicknameHint')}</Text>

        <Text style={styles.label}>{t('myPage.jupleId')}</Text>
        <View style={styles.readOnlyField} testID="profile-juple-id">
          <Text selectable style={[styles.readOnlyValue, ltrTextStyle]}>{`@${formatJupleId(profile.jupleId)}`}</Text>
        </View>
        <Text style={styles.hint}>{t('profile.jupleIdReadOnly')}</Text>

        {error ? <Text style={styles.error} testID="profile-error">{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: isSaving, disabled: isSaving }}
          disabled={isSaving}
          onPress={save}
          style={[styles.saveButton, isSaving && styles.disabled]}
          testID="profile-save"
        >
          {isSaving ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.saveLabel}>{t('common.save')}</Text>}
        </Pressable>
      </ScrollView>
    </StackScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: spacing.xl },
  content: { alignSelf: 'center', maxWidth: 560, padding: spacing.xl, width: '100%' },
  photoSection: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  photoActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  photoAction: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  photoActionLabel: { color: colors.brand, fontSize: 15, fontWeight: '600' },
  photoRemoveLabel: { color: colors.danger, fontSize: 15, fontWeight: '600' },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: spacing.xs, marginTop: spacing.lg },
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
  hint: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.xs },
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
