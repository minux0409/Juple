'use client';

import { useState } from 'react';
import { formatJupleId, PROFILE_PATH, type UserProfile } from '../../../lib/accountDisplay';
import { isSessionLost } from '../../../lib/authSession';
import { DISPLAY_NAME_MAX_STORAGE_LENGTH, nicknameErrorMessage } from '../../../lib/settings';
import { useSignedInApp } from '../AppRoot';
import { Notice } from '../PageStates';
import { SettingsPage } from './SettingsPage';
import { Avatar } from '../Avatar';
import styles from '../app.module.css';

/**
 * 프로필 편집 - the mobile ProfileEditScreen's nickname (PUT /api/v1/users/me/profile/display-name): the server is the only judge
 * (length, characters, reserved / prohibited words - its stable code picks the message); an empty value clears the nickname. The
 * saved profile is shown everywhere at once (side bar, 내 페이지). The profile photo stays in the app for now. This is the page 설정 opens on (/me); the old /me/profile address redirects here.
 */
export function ProfileEditView() {
  const { api, dictionary, profile, updateProfile, onSessionLost } = useSignedInApp();
  const [nickname, setNickname] = useState(profile?.displayName ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!profile) {
    return (
      <SettingsPage title={dictionary.profileEdit}>
        <Notice message={dictionary.profileLoadFallback} />
      </SettingsPage>
    );
  }

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) {
      return;
    }
    if (nickname === (profile.displayName ?? '')) {
      return;
    }
    setIsSaving(true);
    setError(null);
    setSaved(false);
    api<UserProfile>({ method: 'PUT', path: `${PROFILE_PATH}/display-name`, body: { displayName: nickname } }).then(
      updated => {
        // The saved profile is shown everywhere at once; the person stays on this page.
        updateProfile(updated);
        setNickname(updated.displayName ?? '');
        setIsSaving(false);
        setSaved(true);
      },
      caught => {
        setIsSaving(false);
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setError(nicknameErrorMessage(caught, dictionary));
      },
    );
  };

  return (
    <SettingsPage title={dictionary.profileEdit}>
      <form className={styles.profileEditCard} noValidate onSubmit={save}>
        <div className={styles.profileEditAvatar}>
          <Avatar person={{ displayName: nickname || profile.displayName, profileImageUrl: profile.profileImageUrl ?? null }} size={104} />
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
            disabled={isSaving || nickname === (profile.displayName ?? '')}
            onClick={() => {
              setNickname(profile.displayName ?? '');
              setError(null);
              setSaved(false);
            }}
            type="button"
          >
            {dictionary.cancel}
          </button>
          <button className={styles.primaryAction} disabled={isSaving || nickname === (profile.displayName ?? '')} type="submit">
            {isSaving ? dictionary.saving : dictionary.save}
          </button>
        </div>
      </form>
    </SettingsPage>
  );
}
