'use client';

import { useEffect, useState } from 'react';
import { formatJupleId } from '../../../../../lib/accountDisplay';
import { ApiHttpError } from '../../../../../lib/appApi';
import { isSessionLost } from '../../../../../lib/authSession';
import { isDeletionConfirmed, RECENT_AUTHENTICATION_REQUIRED_CODE } from '../../../../../lib/settings';
import { useSignedInApp } from '../../../AppRoot';
import { SettingsPage } from '../../SettingsPage';
import styles from '../../../app.module.css';

type Step = 'warning' | 'reauthenticate' | 'confirm';

/**
 * 계정 삭제 - the mobile DeleteAccountScreen, in its three deliberate steps so it can never happen from a stray click:
 *  1. what will be deleted, forever;
 *  2. signing in again (the server refuses deletion unless the access token's sign-in is recent - the Web never decides that);
 *  3. typing the account's own Juple ID, then 계정 영구 삭제 (DELETE /api/v1/account) - and the session ends.
 * Deleting the account does not cancel a store subscription (mobile / Play policy); that stays in Google Play.
 */
export default function DeleteAccountPage() {
  const { api, dictionary, profile, reauthentication, clearReauthentication, reauthenticate, signOut, onSessionLost } = useSignedInApp();
  // Back from the fresh sign-in of THIS purpose: continue at the right step (consumed once).
  const [initial] = useState(() => {
    if (reauthentication?.purpose !== 'deleteAccount') {
      return { step: 'warning' as Step, notice: null as string | null };
    }
    if (reauthentication.outcome === 'reauthenticated') {
      return { step: 'confirm' as Step, notice: null };
    }
    return { step: 'reauthenticate' as Step, notice: reauthentication.outcome === 'differentAccount' ? dictionary.collectionLockDifferentAccount : dictionary.collectionLockSignInCancelled };
  });
  // The result of a fresh sign-in is for this page once; it is cleared after it was read above.
  useEffect(() => {
    if (reauthentication?.purpose === 'deleteAccount') {
      clearReauthentication();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [step, setStep] = useState<Step>(initial.step);
  const [notice, setNotice] = useState<string | null>(initial.notice);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const confirmed = isDeletionConfirmed(typed, profile?.jupleId);

  const deleteNow = () => {
    if (!confirmed || busy) {
      return;
    }
    setBusy(true);
    setNotice(null);
    api<void>({ method: 'DELETE', path: '/api/v1/account' }).then(
      () => signOut(),
      caught => {
        // 409: already gone server-side (mobile treats it as done).
        if (caught instanceof ApiHttpError && caught.status === 409) {
          signOut();
          return;
        }
        setBusy(false);
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        if (caught instanceof ApiHttpError && caught.code === RECENT_AUTHENTICATION_REQUIRED_CODE) {
          // Took longer than the server's recent-sign-in window: sign in again; nothing was deleted.
          setStep('reauthenticate');
          setNotice(dictionary.collectionLockSignInExpired);
          return;
        }
        setNotice(dictionary.deleteAccountError);
      },
    );
  };

  const items = [
    dictionary.deleteAccountDataLinks,
    dictionary.deleteAccountDataPhotos,
    dictionary.deleteAccountDataCollections,
    dictionary.deleteAccountDataSharing,
    dictionary.deleteAccountDataFriends,
    dictionary.deleteAccountDataNotifications,
  ];

  return (
    <SettingsPage title={dictionary.accountDeleteTitle}>
      {notice ? <p className={styles.fieldError} role="alert">{notice}</p> : null}
      {step === 'warning' ? (
        <div className={styles.settingsCard}>
          <div className={styles.settingsBlock}>
            <p className={styles.settingsBlockTitle}>{dictionary.deleteAccountWarningTitle}</p>
            <p className={styles.stateMessage}>{dictionary.deleteAccountWarningIntro}</p>
            <ul className={styles.bulletList}>
              {items.map(item => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className={styles.formFooter}>
            <button className={styles.dangerAction} onClick={() => setStep('reauthenticate')} type="button">
              {dictionary.deleteAccountContinue}
            </button>
          </div>
        </div>
      ) : null}
      {step === 'reauthenticate' ? (
        <div className={styles.settingsCard}>
          <div className={styles.settingsBlock}>
            <p className={styles.settingsBlockTitle}>{dictionary.deleteAccountReauthTitle}</p>
            <p className={styles.stateMessage}>{dictionary.deleteAccountReauthMessage}</p>
          </div>
          <div className={styles.formFooter}>
            <button className={styles.primaryAction} onClick={() => reauthenticate('deleteAccount')} type="button">
              {dictionary.deleteAccountReauthAction}
            </button>
          </div>
        </div>
      ) : null}
      {step === 'confirm' ? (
        <div className={styles.settingsCard}>
          <div className={styles.settingsBlock}>
            <p className={styles.settingsBlockTitle}>{dictionary.deleteAccountConfirmTitle}</p>
            <p className={styles.stateMessage}>{dictionary.deleteAccountConfirmMessage}</p>
            {profile ? (
              <p className={styles.profileName} dir="ltr">
                @{formatJupleId(profile.jupleId)}
              </p>
            ) : null}
            <input
              aria-label={dictionary.deleteAccountConfirmPlaceholder}
              autoComplete="off"
              className={styles.textInput}
              dir="ltr"
              onChange={event => setTyped(event.target.value)}
              placeholder={dictionary.deleteAccountConfirmPlaceholder}
              value={typed}
            />
          </div>
          <div className={styles.formFooter}>
            <button className={styles.dangerAction} disabled={!confirmed || busy} onClick={deleteNow} type="button">
              {busy ? dictionary.deleting : dictionary.deleteAccountDeleteNow}
            </button>
          </div>
        </div>
      ) : null}
    </SettingsPage>
  );
}
