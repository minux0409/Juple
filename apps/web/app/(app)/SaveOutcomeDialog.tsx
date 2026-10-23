'use client';

import { useEffect, useRef } from 'react';
import styles from './app.module.css';

/**
 * The result of a save that did not simply add the link (a proposal waiting for the Owner's approval, a mix, an already-waiting link) as a
 * centered modal dialog with one 확인 - the mobile result dialog, not a line under the form. A native <dialog>: focus moves to 확인 and stays
 * inside, Escape answers like 확인, and the page behind is inert. It is shown only while there IS a message (a failure never opens it);
 * answering twice is ignored, so a double click or Escape-then-click cannot navigate twice.
 */
export function SaveOutcomeDialog({ message, confirmLabel, onConfirm }: { readonly message: string | null; readonly confirmLabel: string; readonly onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const answered = useRef(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (message && !dialog.open) {
      answered.current = false;
      dialog.showModal();
    } else if (!message && dialog.open) {
      dialog.close();
    }
  }, [message]);
  const answer = () => {
    if (answered.current) return;
    answered.current = true;
    onConfirm();
  };
  return (
    <dialog
      aria-describedby="save-outcome-message"
      aria-label={message?.split('\n')[0]}
      className={styles.dialog}
      data-save-outcome
      onCancel={event => {
        event.preventDefault();
        answer();
      }}
      ref={ref}
      role="alertdialog"
    >
      {message ? (
        <div className={styles.dialogBody} id="save-outcome-message">
          {message.split('\n').map(line => (
            <p className={styles.dialogMessage} key={line}>{line}</p>
          ))}
        </div>
      ) : null}
      <div className={`${styles.formActions} ${styles.dialogFoot}`}>
        <button autoFocus className={styles.primaryAction} onClick={answer} type="button">
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
