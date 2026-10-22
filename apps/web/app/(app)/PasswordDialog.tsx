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
      {/* The panel inside is its own <form>, and this dialog is rendered inside the link's <form> (CollectionPicker in ItemForm on
          새 링크 검토 / 링크 수정). React's submit event bubbles through the component tree, so without this the password's 잠금 해제
          also ran the link's 저장 - with the selection from before the unlock - and left the page before the choice was made. */}
      <div className={styles.dialogBody} onSubmit={event => event.stopPropagation()}>
        {open ? children : null}
      </div>
      <div className={`${styles.formActions} ${styles.dialogFoot}`}>
        <button className={styles.settingsAction} onClick={onCancel} type="button">
          {cancelLabel}
        </button>
      </div>
    </dialog>
  );
}
