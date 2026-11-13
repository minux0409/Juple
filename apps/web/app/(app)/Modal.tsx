'use client';

import { useEffect, useRef } from 'react';
import { ModalCloseButton } from './ModalCloseButton';
import { useBackdropDismiss } from './useBackdropDismiss';
import styles from './app.module.css';

/** A modal panel (native <dialog>: focus kept inside, Escape closes) with a title and a close button. */
export function Modal({
  open,
  title,
  closeLabel,
  onClose,
  wide = false,
  keepOnBackdrop = false,
  children,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly closeLabel: string;
  readonly onClose: () => void;
  /** The Collection share screen's four cards need the room (about 900px), not the 520px of a short list. */
  readonly wide?: boolean;
  /** A dialog with typed input (a password, a comment, a crop): the backdrop does not close it, so a stray click loses nothing. */
  readonly keepOnBackdrop?: boolean;
  readonly children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // A click on the dimmed area outside the panel closes it like Escape / the close button (it never runs an action).
  const backdrop = useBackdropDismiss(onClose, !keepOnBackdrop);
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
      onClick={backdrop.onClick}
      onPointerDown={backdrop.onPointerDown}
      ref={ref}
    >
      <div className={styles.panelHeader}>
        <h2 className={styles.dialogTitle} id="modal-title">
          {title}
        </h2>
        <ModalCloseButton label={closeLabel} onClick={onClose} />
      </div>
      {/* The body scrolls on its own under the header: content can never paint over the title or the close button. */}
      <div className={styles.panelScroll} data-modal-body tabIndex={-1}>
        {open ? children : null}
      </div>
    </dialog>
  );
}
