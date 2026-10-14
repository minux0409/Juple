'use client';

import { useEffect, useRef } from 'react';
import { DEFAULT_COLLECTION_COLOR, type CollectionDraft } from '../../../lib/collectionEditor';
import type { AppDictionary } from '../../../lib/appI18n';
import { CollectionEditor } from './CollectionEditor';
import styles from '../app.module.css';

/**
 * 새 컬렉션 as a dialog (the new-link review's "+ 새 컬렉션"): ONE modal shell - title on top, the fields scrolling in the middle,
 * 취소 / 만들기 always in the foot - around the same CollectionEditor fields, validation and create request the Collections page uses.
 * It is a native <dialog> (focus kept inside, Escape closes) in normal flow: nothing is positioned by hand.
 */
export function NewCollectionDialog({
  dictionary,
  error,
  busy,
  onSubmit,
  onClose,
}: {
  readonly dictionary: AppDictionary;
  readonly error: string | null;
  readonly busy: boolean;
  readonly onSubmit: (draft: CollectionDraft) => void;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  return (
    <dialog
      aria-labelledby="new-collection-title"
      className={`${styles.dialog} ${styles.collectionDialog}`}
      onCancel={event => {
        event.preventDefault();
        if (!busy) {
          onClose();
        }
      }}
      ref={ref}
    >
      <div className={styles.dialogHead}>
        <h2 className={styles.dialogTitle} id="new-collection-title">
          {dictionary.collectionCreate}
        </h2>
      </div>
      {/* This dialog is drawn outside the link's form but React events still bubble to it: its submit must never save the link. */}
      <div className={styles.collectionDialogBody} onSubmit={event => event.stopPropagation()}>
        <CollectionEditor
          collectionId={0}
          dictionary={dictionary}
          error={error}
          initial={{ name: '', icon: 'Folder', color: DEFAULT_COLLECTION_COLOR }}
          initialImageUrl={null}
          isSubmitting={busy}
          layout="dialog"
          mode="create"
          onCancel={onClose}
          onSubmit={onSubmit}
        />
      </div>
    </dialog>
  );
}
