'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatJupleId, PROFILE_PATH, type UserProfile } from '../../../lib/accountDisplay';
import { isSessionLost } from '../../../lib/authSession';
import { isUsableProfilePhoto, PROFILE_IMAGE_PATH, PROFILE_PHOTO_ACCEPT, profilePhotoErrorMessage, profilePhotoForm } from '../../../lib/profilePhoto';
import { DISPLAY_NAME_MAX_STORAGE_LENGTH, nicknameErrorMessage } from '../../../lib/settings';
import { useSignedInApp } from '../AppRoot';
import { ConfirmDialog } from '../ConfirmDialog';
import { LinkImage } from '../LinkImage';
import { Notice } from '../PageStates';
import { SettingsPage } from './SettingsPage';
import { Avatar } from '../Avatar';
import styles from '../app.module.css';

/**
 * 프로필 편집 - the mobile ProfileEditScreen's nickname (PUT /api/v1/users/me/profile/display-name): the server is the only judge
 * (length, characters, reserved / prohibited words - its stable code picks the message); an empty value clears the nickname. The
 * saved profile is shown everywhere at once (side bar, 내 페이지). The profile photo is the mobile flow on the same endpoints (PUT / DELETE
 * /api/v1/users/me/profile/image): a picked photo is previewed and goes up with 저장; 사진 삭제 asks first and removes the saved photo at
 * once. This is the page 설정 opens on (/me); the old /me/profile address redirects here.
 */
export function ProfileEditView() {
  const { api, dictionary, profile, updateProfile, onSessionLost } = useSignedInApp();
  const [nickname, setNickname] = useState(profile?.displayName ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // A photo picked here is only previewed (a local object URL) until 저장; nothing is sent before.
  const [pickedPhoto, setPickedPhoto] = useState<File | null>(null);
  const [isRemoveConfirmOpen, setIsRemoveConfirmOpen] = useState(false);
  const [isRemovingPhoto, setIsRemovingPhoto] = useState(false);
  const saving = useRef(false);
  const pickedUrl = useMemo(() => (pickedPhoto ? URL.createObjectURL(pickedPhoto) : null), [pickedPhoto]);
  useEffect(
    () => () => {
      if (pickedUrl) {
        URL.revokeObjectURL(pickedUrl);
      }
    },
    [pickedUrl],
  );

  if (!profile) {
    return (
      <SettingsPage title={dictionary.profileEdit}>
        <Notice message={dictionary.profileLoadFallback} />
      </SettingsPage>
    );
  }

  const nicknameChanged = nickname !== (profile.displayName ?? '');
  const hasPhoto = pickedPhoto !== null || !!profile.profileImageUrl;
  const busy = isSaving || isRemovingPhoto;

  const pickPhoto = (file: File | undefined) => {
    if (!file) {
      return;
    }
    setSaved(false);
    if (!isUsableProfilePhoto(file)) {
      setError(dictionary.profilePhotoInvalid);
      return;
    }
    setError(null);
    setPickedPhoto(file);
  };

  /** Mobile removePhoto: a picked (unsaved) photo is just dropped; a saved one is deleted on the server right away. */
  const removePhoto = () => {
    setIsRemoveConfirmOpen(false);
    setError(null);
    setSaved(false);
    if (pickedPhoto) {
      setPickedPhoto(null);
      return;
    }
    if (!profile.profileImageUrl || busy) {
      return;
    }
    setIsRemovingPhoto(true);
    api<UserProfile>({ method: 'DELETE', path: PROFILE_IMAGE_PATH }).then(
      updated => {
        updateProfile(updated);
        setIsRemovingPhoto(false);
      },
      caught => {
        setIsRemovingPhoto(false);
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setError(dictionary.profilePhotoSaveFallback);
      },
    );
  };

  /** Mobile save: the nickname first, then the photo; a photo that fails leaves the saved nickname and says so. */
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving.current || busy || (!nicknameChanged && !pickedPhoto)) {
      return;
    }
    saving.current = true;
    setIsSaving(true);
    setError(null);
    setSaved(false);
    try {
      if (nicknameChanged) {
        try {
          const updated = await api<UserProfile>({ method: 'PUT', path: `${PROFILE_PATH}/display-name`, body: { displayName: nickname } });
          // The saved profile is shown everywhere at once; the person stays on this page.
          updateProfile(updated);
          setNickname(updated.displayName ?? '');
        } catch (caught) {
          if (isSessionLost(caught)) {
            onSessionLost();
            return;
          }
          setError(nicknameErrorMessage(caught, dictionary));
          return;
        }
      }
      if (pickedPhoto) {
        try {
          updateProfile(await api<UserProfile>({ method: 'PUT', path: PROFILE_IMAGE_PATH, body: profilePhotoForm(pickedPhoto) }));
          setPickedPhoto(null);
        } catch (caught) {
          if (isSessionLost(caught)) {
            onSessionLost();
            return;
          }
          setError(profilePhotoErrorMessage(caught, dictionary));
          return;
        }
      }
      setSaved(true);
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  };

  return (
    <SettingsPage title={dictionary.profileEdit}>
      <form className={styles.profileEditCard} noValidate onSubmit={save}>
        <div className={styles.profileEditAvatar}>
          {/* The picture itself is a way to change it, too (it is the label of a file input). */}
          <label className={styles.profilePhotoPick} title={hasPhoto ? dictionary.changePhoto : dictionary.profilePhotoChoose}>
            {pickedUrl ? (
              <span className={styles.avatar} style={{ width: 104, height: 104 }}>
                {/* a local preview of the picked file: shown at once (no lazy loading) */}
                <LinkImage eager fallback={null} src={pickedUrl} />
              </span>
            ) : (
              <Avatar person={{ displayName: nickname || profile.displayName, profileImageUrl: profile.profileImageUrl ?? null }} size={104} />
            )}
            <input
              accept={PROFILE_PHOTO_ACCEPT}
              aria-label={hasPhoto ? dictionary.changePhoto : dictionary.profilePhotoChoose}
              className={styles.visuallyHidden}
              data-profile-photo-input
              disabled={busy}
              onChange={event => {
                pickPhoto(event.target.files?.[0]);
                event.target.value = '';
              }}
              type="file"
            />
          </label>
          <div className={styles.profilePhotoActions}>
            <button className={styles.settingsAction} disabled={busy} onClick={() => document.querySelector<HTMLInputElement>('[data-profile-photo-input]')?.click()} type="button">
              {hasPhoto ? dictionary.changePhoto : dictionary.profilePhotoChoose}
            </button>
            {hasPhoto ? (
              <button className={styles.settingsAction} disabled={busy} onClick={() => (pickedPhoto ? removePhoto() : setIsRemoveConfirmOpen(true))} type="button">
                {dictionary.removePhoto}
              </button>
            ) : null}
          </div>
          {isRemovingPhoto || isSaving ? (
            <p aria-live="polite" className={styles.stateMessage}>
              {dictionary.processing}
            </p>
          ) : null}
        </div>
        <label className={styles.profileEditField}>
          <span className={styles.fieldLabel}>{dictionary.nickname}</span>
          <input
            aria-invalid={error ? true : undefined}
            autoFocus
            className={styles.textInput}
            dir="auto"
            maxLength={DISPLAY_NAME_MAX_STORAGE_LENGTH}
            onChange={event => {
              setNickname(event.target.value);
              setError(null);
              setSaved(false);
            }}
            placeholder={dictionary.displayNamePlaceholder}
            value={nickname}
          />
        </label>
        <div className={styles.profileEditField}>
          <span className={styles.fieldLabel}>{dictionary.jupleIdLabel}</span>
          <span className={styles.profileEditReadOnly} dir="ltr">
            @{formatJupleId(profile.jupleId)}
          </span>
        </div>
        {error ? <p className={styles.formError} role="alert">{error}</p> : null}
        {saved ? <p className={styles.formNotice} role="status">{dictionary.itemSaved}</p> : null}
        <div className={styles.profileEditActions}>
          <button
            className={styles.settingsAction}
            disabled={busy || (!nicknameChanged && !pickedPhoto)}
            onClick={() => {
              setNickname(profile.displayName ?? '');
              setPickedPhoto(null);
              setError(null);
              setSaved(false);
            }}
            type="button"
          >
            {dictionary.cancel}
          </button>
          <button className={styles.primaryAction} disabled={busy || (!nicknameChanged && !pickedPhoto)} type="submit">
            {isSaving ? dictionary.saving : dictionary.save}
          </button>
        </div>
      </form>
      <ConfirmDialog
        busy={isRemovingPhoto}
        cancelLabel={dictionary.cancel}
        confirmLabel={dictionary.removePhoto}
        destructive
        onCancel={() => setIsRemoveConfirmOpen(false)}
        onConfirm={removePhoto}
        open={isRemoveConfirmOpen}
        title={dictionary.profileRemovePhotoConfirmTitle}
      />
    </SettingsPage>
  );
}
