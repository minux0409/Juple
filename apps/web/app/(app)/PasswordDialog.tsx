'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import styles from './app.module.css';

/**
 * A modal <dialog> around a locked Collection's password panel (mobile: the unlock panel in a centered Modal over the picker or the
 * card that was tapped). Focus stays inside, Escape and 취소 close it; nothing is decided until the password is accepted. It holds no
 * password itself - the panel inside sends it once and drops it.
 */
export function PasswordDialog({
  open,
  cancelLabel,
  onCancel,
  children,
}: {
  readonly open: boolean;
  readonly cancelLabel: string;
  readonly onCancel: () => void;
  readonly children: ReactNode;
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
      className={styles.dialog}
      onCancel={event => {
        event.preventDefault();
        onCancel();
      }}
      ref={ref}
    >
      <div className={styles.dialogBody}>{open ? children : null}</div>
      <div className={`${styles.formActions} ${styles.dialogFoot}`}>
        <button className={styles.settingsAction} onClick={onCancel} type="button">
          {cancelLabel}
        </button>
      </div>
    </dialog>
  );
}
