'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatJupleId, PROFILE_PATH, type UserProfile } from '../../../../lib/accountDisplay';
import { isSessionLost } from '../../../../lib/authSession';
import { DISPLAY_NAME_MAX_STORAGE_LENGTH, nicknameErrorMessage } from '../../../../lib/settings';
import { useSignedInApp } from '../../AppRoot';
import { Notice } from '../../PageStates';
import { SettingsPage } from '../SettingsPage';
import styles from '../../app.module.css';

/**
 * 프로필 편집 - the mobile ProfileEditScreen's nickname (PUT /api/v1/users/me/profile/display-name): the server is the only judge
 * (length, characters, reserved / prohibited words - its stable code picks the message); an empty value clears the nickname. The
 * saved profile is shown everywhere at once (side bar, 내 페이지). The profile photo stays in the app for now.
 */
export default function ProfileEditPage() {
  const { api, dictionary, profile, updateProfile, onSessionLost } = useSignedInApp();
  const router = useRouter();
  const [nickname, setNickname] = useState(profile?.displayName ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      router.push('/me');
      return;
    }
    setIsSaving(true);
    setError(null);
    api<UserProfile>({ method: 'PUT', path: `${PROFILE_PATH}/display-name`, body: { displayName: nickname } }).then(
      saved => {
        updateProfile(saved);
        router.push('/me');
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
      <form className={styles.settingsCard} noValidate onSubmit={save}>
        <label className={styles.formRow}>
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
            }}
            placeholder={dictionary.displayNamePlaceholder}
            value={nickname}
          />
        </label>
        <div className={styles.settingsRow}>
          <span className={styles.settingsLabel}>{dictionary.jupleIdLabel}</span>
          <span className={styles.settingsValue} dir="ltr">
            @{formatJupleId(profile.jupleId)}
          </span>
        </div>
        {error ? <p className={styles.formError} role="alert">{error}</p> : null}
        <div className={styles.formFooter}>
          <button className={styles.settingsAction} disabled={isSaving} onClick={() => router.back()} type="button">
            {dictionary.cancel}
          </button>
          <button className={styles.primaryAction} disabled={isSaving} type="submit">
            {isSaving ? dictionary.saving : dictionary.save}
          </button>
        </div>
      </form>
    </SettingsPage>
  );
}
