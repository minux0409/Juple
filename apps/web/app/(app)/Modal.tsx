'use client';

import { useEffect, useRef } from 'react';
import styles from './app.module.css';

/** A modal panel (native <dialog>: focus kept inside, Escape closes) with a title and a close button. */
export function Modal({
  open,
  title,
  closeLabel,
  onClose,
  wide = false,
  children,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly closeLabel: string;
  readonly onClose: () => void;
  /** The Collection share screen's four cards need the room (about 900px), not the 520px of a short list. */
  readonly wide?: boolean;
  readonly children: React.ReactNode;
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
      aria-labelledby="modal-title"
      className={wide ? `${styles.panelDialog} ${styles.panelDialogWide}` : styles.panelDialog}
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
      ref={ref}
    >
      <div className={styles.panelHeader}>
        <h2 className={styles.dialogTitle} id="modal-title">
          {title}
        </h2>
        <button className={styles.settingsAction} onClick={onClose} type="button">
          {closeLabel}
        </button>
      </div>
      {open ? children : null}
    </dialog>
  );
}
