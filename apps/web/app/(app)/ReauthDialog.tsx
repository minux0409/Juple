'use client';

import { useEffect, useRef } from 'react';
import type { AppDictionary } from '../../lib/appI18n';
import styles from './app.module.css';

/**
 * "다시 로그인이 필요합니다": Entra no longer accepts this sign-in (account details changed elsewhere, or the session ended). A modal
 * <dialog> with one action and no close: Escape does nothing, because there is nothing to go back to - every call would fail.
 * AppRoot renders it once for the whole app, so however many requests fail at the same time there is only one.
 */
export function ReauthDialog({
  open,
  busy,
  dictionary,
  onConfirm,
}: {
  readonly open: boolean;
  readonly busy: boolean;
  readonly dictionary: AppDictionary;
  readonly onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      aria-describedby="reauth-dialog-message"
      aria-labelledby="reauth-dialog-title"
      className={styles.dialog}
      onCancel={event => event.preventDefault()}
      ref={ref}
    >
      <div className={styles.dialogHead}>
        <h2 className={styles.dialogTitle} id="reauth-dialog-title">
          {dictionary.reauthRequiredTitle}
        </h2>
      </div>
      <div className={styles.dialogBody}>
        <p className={styles.dialogMessage} id="reauth-dialog-message">
          {dictionary.reauthRequiredMessage}
        </p>
      </div>
      <div className={`${styles.formActions} ${styles.dialogFoot}`}>
        <button className={styles.primaryAction} disabled={busy} onClick={onConfirm} type="button">
          {dictionary.reauthRequiredAction}
        </button>
      </div>
    </dialog>
  );
}
