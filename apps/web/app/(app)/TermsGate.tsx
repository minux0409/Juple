'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { AppApi } from '../../lib/appApi';
import type { AppDictionary } from '../../lib/appI18n';
import { isSessionLost } from '../../lib/authSession';
import { parseTermsStatus, TERMS_ACCEPTANCE_PATH, type TermsStatus } from '../../lib/safety';
import styles from './app.module.css';

/**
 * 이용약관 동의: shown after sign-in (and again whenever a content write is refused with termsAcceptanceRequired) until the CURRENT
 * Terms are accepted. The Terms and the Privacy Policy are links, and only the Terms are agreed to here - the Privacy Policy is shown
 * for reading, never bundled into this agreement. "Not now" keeps the person signed in and able to read; the server still refuses
 * every content write until the agreement exists.
 */
export function TermsGate({
  api,
  dictionary,
  version,
  onAccepted,
  onLater,
  onSessionLost,
}: {
  readonly api: AppApi;
  readonly dictionary: AppDictionary;
  readonly version: string;
  readonly onAccepted: (status: TermsStatus) => void;
  readonly onLater: () => void;
  readonly onSessionLost: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const sending = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  const accept = (event: React.FormEvent) => {
    event.preventDefault();
    if (!agreed || sending.current) {
      return;
    }
    sending.current = true;
    setBusy(true);
    setFailed(false);
    api<unknown>({ method: 'POST', path: TERMS_ACCEPTANCE_PATH, body: { version } }).then(
      raw => {
        onAccepted(parseTermsStatus(raw) ?? { currentVersion: version, acceptedVersion: version, isAccepted: true });
      },
      caught => {
        sending.current = false;
        setBusy(false);
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setFailed(true);
      },
    );
  };

  return (
    <dialog
      aria-labelledby={titleId}
      className={`${styles.dialog} ${styles.collectionDialog}`}
      data-terms-gate
      onCancel={event => {
        event.preventDefault();
        if (!busy) {
          onLater();
        }
      }}
      ref={ref}
    >
      <div className={styles.dialogHead}>
        <h2 className={styles.dialogTitle} id={titleId}>
          {dictionary.safetyTermsTitle}
        </h2>
      </div>
      <form className={styles.editorDialogForm} noValidate onSubmit={accept}>
        <div className={`${styles.dialogBody} ${styles.editorDialogFields}`}>
          <p className={styles.dialogMessage}>{dictionary.safetyTermsBody}</p>
          <ul className={styles.termsLinks}>
            <li>
              <a href="/terms" rel="noopener noreferrer" target="_blank">
                {dictionary.safetyTermsViewTerms}
              </a>
            </li>
            <li>
              <a href="/privacy" rel="noopener noreferrer" target="_blank">
                {dictionary.safetyTermsViewPrivacy}
              </a>
            </li>
          </ul>
          <label className={styles.termsAgree}>
            <input checked={agreed} data-terms-agree disabled={busy} onChange={event => setAgreed(event.target.checked)} type="checkbox" />
            <span>{dictionary.safetyTermsAgree}</span>
          </label>
        </div>
        <div className={`${styles.formActions} ${styles.dialogFoot} ${styles.editorDialogFoot}`}>
          {failed ? (
            <p className={styles.fieldError} role="alert">
              {dictionary.safetyTermsSaveFailed}
            </p>
          ) : null}
          <div className={styles.formActions}>
            <button className={styles.settingsAction} disabled={busy} onClick={onLater} type="button">
              {dictionary.safetyTermsLater}
            </button>
            <button className={styles.primaryAction} data-terms-accept disabled={busy || !agreed} type="submit">
              {busy ? dictionary.saving : dictionary.safetyTermsContinue}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
