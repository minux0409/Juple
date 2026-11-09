'use client';

import { useEffect, useRef } from 'react';
import { useBackdropDismiss } from './useBackdropDismiss';
import styles from './app.module.css';

/**
 * The mobile ConfirmDialog for destructive or irreversible steps (permanent delete, empty trash, remove a friend, sign out): a modal
 * <dialog> (focus is kept inside, Escape cancels), the action named on its button. Nothing happens until it is confirmed.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  error,
  confirmLabel,
  cancelLabel,
  destructive,
  busy,
  onConfirm,
  onCancel,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly message?: string;
  readonly error?: string | null;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly destructive?: boolean;
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // The backdrop is "cancel", like Escape: the confirmed action only ever runs from its own button.
  const backdrop = useBackdropDismiss(onCancel, !busy);
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
      aria-labelledby="confirm-dialog-title"
      className={styles.dialog}
      onCancel={event => {
        event.preventDefault();
        if (!busy) {
          onCancel();
        }
      }}
      onClick={backdrop.onClick}
      onPointerDown={backdrop.onPointerDown}
      ref={ref}
    >
      <div className={styles.dialogHead}>
        <h2 className={styles.dialogTitle} id="confirm-dialog-title">
          {title}
        </h2>
      </div>
      {message || error ? (
        <div className={styles.dialogBody}>
          {message ? <p className={styles.dialogMessage}>{message}</p> : null}
          {error ? <p className={styles.fieldError} role="alert">{error}</p> : null}
        </div>
      ) : null}
      <div className={`${styles.formActions} ${styles.dialogFoot}`}>
        <button className={styles.settingsAction} disabled={busy} onClick={onCancel} type="button">
          {cancelLabel}
        </button>
        <button className={destructive ? styles.dangerAction : styles.primaryAction} disabled={busy} onClick={onConfirm} type="button">
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
