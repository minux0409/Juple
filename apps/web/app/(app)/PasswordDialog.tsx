'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './app.module.css';

/**
 * A modal <dialog> around a locked Collection's password panel (mobile: the unlock panel in a centered Modal over the picker or the
 * card that was tapped). Focus stays inside, Escape and 취소 close it; nothing is decided until the password is accepted. It holds no
 * password itself - the panel inside sends it once and drops it.
 *
 * The dialog is drawn through a portal into <main>, never where it is declared: the Collection picker lives inside the link's <form>
 * (새 링크 검토 / 링크 수정), and the unlock panel is a <form> of its own. A <form> inside a <form> is invalid HTML (React warns "<form>
 * cannot be a descendant of <form>") and in a real browser the unlock never reached its React handler - Chrome submitted the page
 * itself (a GET to the same address without its query), which reset the review and the editor. Outside the link's form the two forms
 * are separate for the browser; React events still bubble through a portal, so the body below also stops its own submit.
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
  // <main> carries the colour tokens (as for the other portalled dialogs); set after mount, so the server render draws nothing.
  const [host, setHost] = useState<Element | null>(null);
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
  }, [open, host]);

  const dialog = (
    <dialog
      className={styles.dialog}
      onCancel={event => {
        event.preventDefault();
        onCancel();
      }}
      ref={ref}
    >
      {/* Portalled out of the link's <form> in the DOM, but still its child in React's tree: the submit of the panel's own <form> would
          bubble to the link's onSubmit (저장) through the component tree, so it ends here. */}
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

  return (
    <>
      <span hidden ref={anchor => setHost(anchor ? anchor.closest('main') ?? document.body : null)} />
      {host ? createPortal(dialog, host) : null}
    </>
  );
}
