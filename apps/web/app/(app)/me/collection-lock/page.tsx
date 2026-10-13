'use client';

import { useEffect, useState } from 'react';
import { isSessionLost } from '../../../../lib/authSession';
import { COLLECTION_LOCK_PATH, LOCK_PASSWORD_MAX_LENGTH, lockPasswordProblem, lockSaveFailure, type CollectionLockStatus } from '../../../../lib/settings';
import { useSignedInApp } from '../../AppRoot';
import { LoadFailed } from '../../PageStates';
import { SettingsRowSkeleton } from '../../Skeletons';
import { SettingsPage } from '../SettingsPage';
import { Glyph } from '../../Glyph';
import styles from '../../app.module.css';

type FormMode = 'change' | 'reset';

/**
 * 컬렉션 잠금 - the mobile CollectionLockSettingsScreen: the ONE lock password that opens every Collection the person locks (a server
 * password - not a device or biometric lock). Change it with the current one; set it for the first time, or replace a forgotten one,
 * only right after signing in to the same account again (the server judges how recent that sign-in is). The password is sent only in
 * the request body - never stored, logged or shown.
 */
export default function CollectionLockPage() {
  const { api, dictionary, locale, reauthentication, clearReauthentication, reauthenticate, onSessionLost } = useSignedInApp();
  const [status, setStatus] = useState<CollectionLockStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  // Back from a fresh sign-in for this page: open the new-password form at once, or say why not.
  const [initial] = useState(() => {
    const result = reauthentication;
    if (result?.purpose !== 'collectionLockSetup' && result?.purpose !== 'collectionLockReset') {
      return { form: null as FormMode | null, notice: null as string | null };
    }
    if (result.outcome === 'reauthenticated') {
      return { form: 'reset' as FormMode, notice: null };
    }
    return { form: null, notice: result.outcome === 'differentAccount' ? dictionary.collectionLockDifferentAccount : dictionary.collectionLockSignInCancelled };
  });
  useEffect(() => {
    if (reauthentication?.purpose === 'collectionLockSetup' || reauthentication?.purpose === 'collectionLockReset') {
      clearReauthentication();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [form, setForm] = useState<FormMode | null>(initial.form);
  const [notice, setNotice] = useState<{ readonly text: string; readonly error: boolean } | null>(initial.notice ? { text: initial.notice, error: true } : null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let ignore = false;
    api<CollectionLockStatus>({ path: COLLECTION_LOCK_PATH }).then(
      loaded => {
        if (!ignore) {
          setStatus(loaded);
        }
      },
      caught => {
        if (ignore) {
          return;
        }
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setLoadFailed(true);
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, onSessionLost, reloadToken]);

  const closeForm = () => {
    setForm(null);
    setCurrent('');
    setNext('');
    setConfirm('');
    setFormError(null);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form || busy) {
      return;
    }
    const problem = lockPasswordProblem(form, current, next, confirm, dictionary);
    if (problem) {
      setFormError(problem);
      return;
    }
    const wasConfigured = status?.isConfigured === true;
    setBusy(true);
    setFormError(null);
    const request =
      form === 'change'
        ? api<void>({ method: 'PUT', path: COLLECTION_LOCK_PATH, body: { currentPassword: current, newPassword: next, confirmPassword: confirm } })
        : api<void>({ method: 'POST', path: `${COLLECTION_LOCK_PATH}/reset`, body: { newPassword: next, confirmPassword: confirm } });
    request.then(
      () => {
        setBusy(false);
        closeForm();
        // A new password is 저장; a changed or reset one is 변경 (mobile).
        setNotice({ text: wasConfigured ? dictionary.collectionLockChanged : dictionary.collectionLockSaved, error: false });
        setReloadToken(token => token + 1);
      },
      caught => {
        setBusy(false);
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        const failure = lockSaveFailure(caught, dictionary);
        if (failure.signInExpired) {
          closeForm();
          setNotice({ text: failure.message, error: true });
          return;
        }
        setFormError(failure.message);
      },
    );
  };

  const passwordField = (label: string, value: string, onChange: (value: string) => void, autoComplete: string) => (
    <label className={styles.formRow}>
      <span className={styles.fieldLabel}>{label}</span>
      <input
        autoComplete={autoComplete}
        className={styles.textInput}
        dir="ltr"
        maxLength={LOCK_PASSWORD_MAX_LENGTH}
        onChange={event => {
          onChange(event.target.value);
          setFormError(null);
        }}
        type="password"
        value={value}
      />
    </label>
  );

  return (
    <SettingsPage title={dictionary.collectionLock}>
      <p className={styles.pageSubtitle}>{dictionary.collectionLockDescription}</p>
      {notice ? (
        <p className={notice.error ? styles.fieldError : styles.formNotice} role={notice.error ? 'alert' : 'status'}>
          {notice.text}
        </p>
      ) : null}
      {status === null && !loadFailed ? <SettingsRowSkeleton count={2} /> : null}
      {loadFailed ? (
        <LoadFailed
          dictionary={dictionary}
          onRetry={() => {
            setLoadFailed(false);
            setReloadToken(token => token + 1);
          }}
        />
      ) : null}
      {status ? (
        <div className={styles.settingsCard}>
          <div className={styles.settingsRow}>
            <span className={styles.settingsLabel}>{dictionary.collectionLockStatusLabel}</span>
            <span className={styles.settingsValue}>
              {status.isConfigured ? dictionary.collectionLockConfigured : dictionary.collectionLockNotConfigured}
              {status.isConfigured && status.passwordChangedAtUtc ? (
                <span className={styles.settingsSubValue}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(status.passwordChangedAtUtc))}</span>
              ) : null}
            </span>
          </div>
          {form === null ? (
            status.isConfigured ? (
              <>
                {/* The same row and words as 상태 above (settingsRow + settingsLabel); the chevron, pointer and hover say it is an action. */}
                <button className={`${styles.settingsRow} ${styles.settingsRowAction}`} onClick={() => setForm('change')} type="button">
                  <span className={styles.settingsLabel}>{dictionary.collectionLockChangePassword}</span>
                  <Glyph className={styles.settingsChevron} name="Chevron" size={16} />
                </button>
                <div className={styles.settingsBlock}>
                  <p className={styles.stateMessage}>{dictionary.collectionLockSignInToReset}</p>
                  <button className={styles.linkButton} onClick={() => reauthenticate('collectionLockReset')} type="button">
                    {dictionary.collectionLockForgot}
                  </button>
                </div>
              </>
            ) : (
              <div className={styles.settingsBlock}>
                <p className={styles.stateMessage}>{dictionary.collectionLockSignInToConfirm}</p>
                <button className={styles.primaryAction} onClick={() => reauthenticate('collectionLockSetup')} type="button">
                  {dictionary.collectionLockSetPassword}
                </button>
              </div>
            )
          ) : (
            <form noValidate onSubmit={submit}>
              <p className={styles.settingsBlockTitleInset}>{form === 'change' ? dictionary.collectionLockChangePassword : dictionary.collectionLockSetPassword}</p>
              {form === 'change' ? passwordField(dictionary.collectionLockCurrentPassword, current, setCurrent, 'current-password') : null}
              {passwordField(dictionary.collectionLockNewPassword, next, setNext, 'new-password')}
              {passwordField(dictionary.collectionLockConfirmPassword, confirm, setConfirm, 'new-password')}
              {formError ? <p className={styles.formError} role="alert">{formError}</p> : null}
              <div className={styles.formFooter}>
                <button className={styles.settingsAction} disabled={busy} onClick={closeForm} type="button">
                  {dictionary.cancel}
                </button>
                <button className={styles.primaryAction} disabled={busy} type="submit">
                  {busy ? dictionary.saving : dictionary.save}
                </button>
              </div>
            </form>
          )}
        </div>
      ) : null}
    </SettingsPage>
  );
}
