'use client';

import { useState } from 'react';
import { isSessionLost } from '../../../../lib/authSession';
import { isUnlockStateChanged, rememberUnlock, unlockErrorMessage, unlockPath, type CollectionUnlockGrant } from '../../../../lib/collectionUnlock';
import { useSignedInApp } from '../../AppRoot';
import { Glyph } from '../../Glyph';
import styles from '../../app.module.css';

/**
 * The mobile CollectionUnlockPanel inside the Collection's own page: which password it asks for (the Owner's lock password, or - for a
 * member - the Collection's access password, never mixed up), a show / hide toggle, Enter submits, the server's answer in the mobile
 * words. The password goes to the server once and is then dropped from this form; only the short-lived grant is kept, in memory.
 */
export function UnlockPanel({
  collectionId,
  kind,
  isOwner,
  onUnlocked,
  onStateChanged,
  onGranted,
}: {
  readonly collectionId: number;
  readonly kind: 'lock' | 'sharePassword';
  readonly isOwner: boolean;
  /** The grant is stored; reload the content now. */
  readonly onUnlocked: () => void;
  /** The password asked for no longer exists (removed meanwhile): read the Collection again. */
  readonly onStateChanged: () => void;
  /**
   * The grant is handed to the caller INSTEAD of the Collection-visit store: the picker's session and one link's opening each keep
   * their own (mobile onGranted) and never borrow the visit's.
   */
  readonly onGranted?: (grant: CollectionUnlockGrant) => void;
}) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSharePassword = kind === 'sharePassword';

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !password) {
      return;
    }
    setBusy(true);
    setError(null);
    api<CollectionUnlockGrant>({ method: 'POST', path: unlockPath(collectionId, kind), body: { password } }).then(
      grant => {
        if (onGranted) {
          onGranted(grant);
        } else {
          rememberUnlock(collectionId, grant);
        }
        setPassword('');
        setBusy(false);
        onUnlocked();
      },
      caught => {
        setBusy(false);
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        if (isUnlockStateChanged(caught)) {
          setPassword('');
          onStateChanged();
          return;
        }
        setError(unlockErrorMessage(caught, kind, dictionary));
      },
    );
  };

  return (
    <form className={styles.unlockPanel} noValidate onSubmit={submit}>
      <span aria-hidden className={styles.unlockIcon}>
        <Glyph name="Lock" size={24} />
      </span>
      <p className={styles.stateTitle}>{isSharePassword ? dictionary.collectionSharePasswordTitle : dictionary.collectionLockedTitle}</p>
      <p className={styles.stateMessage}>{isSharePassword ? dictionary.sharePasswordLockedMessage : dictionary.lockedMessage}</p>
      <div className={styles.passwordRow}>
        <input
          aria-invalid={error ? true : undefined}
          aria-label={isSharePassword ? dictionary.sharePasswordLabel : dictionary.lockPasswordLabel}
          autoComplete="current-password"
          autoFocus
          className={styles.textInput}
          dir="ltr"
          maxLength={64}
          onChange={event => {
            setPassword(event.target.value);
            setError(null);
          }}
          placeholder={isSharePassword ? dictionary.sharePasswordLabel : dictionary.lockPasswordLabel}
          type={visible ? 'text' : 'password'}
          value={password}
        />
        <button aria-label={visible ? dictionary.passwordHide : dictionary.passwordShow} aria-pressed={visible} className={styles.passwordToggle} onClick={() => setVisible(value => !value)} type="button">
          <Glyph name={visible ? "Eye" : "EyeOff"} size={20} />
        </button>
      </div>
      <button className={styles.primaryAction} disabled={busy || !password} type="submit">
        {busy ? dictionary.processing : dictionary.unlockAction}
      </button>
      {error ? <p className={styles.fieldError} role="alert">{error}</p> : null}
      {isOwner ? null : <p className={styles.settingsSubValue}>{isSharePassword ? dictionary.sharePasswordContactOwner : dictionary.lockContactOwner}</p>}
    </form>
  );
}
