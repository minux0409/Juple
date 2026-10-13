'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { isSessionLost } from '../../../../lib/authSession';
import type { CollectionDetail } from '../../../../lib/collectionDetails';
import { collectionNameError, nameSaveError } from '../../../../lib/collectionEditor';
import { cloneCollection, copyResultMessage, type CloneOutcome } from '../../../../lib/collectionOperations';
import { unlockHeaders } from '../../../../lib/collectionUnlock';
import { collectionHref } from '../../../../lib/savedLinks';
import { useSignedInApp } from '../../AppRoot';
import { Modal } from '../../Modal';
import styles from '../../app.module.css';

/**
 * 내 컬렉션으로 복제 - a Collection shared with me becomes a NEW Collection of my own: its name (the source's, editable), then every link I
 * can see there copied in (lib/collectionOperations.cloneCollection - the existing create + copy API, no new endpoint). Only the
 * links' URL, title and automatic preview travel; people, invitations, password, sharing, comments and reactions never do, and the
 * source is never changed. The result is said as it is - all, part (with what was not copied) - and the new Collection opens from here.
 */
export function CloneCollectionDialog({ collection, onClose }: { readonly collection: CollectionDetail; readonly onClose: () => void }) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const router = useRouter();
  const [name, setName] = useState(collection.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Extract<CloneOutcome, { kind: 'done' }> | null>(null);
  const nameError = collectionNameError(name, dictionary);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || nameError || outcome) {
      return;
    }
    setBusy(true);
    setError(null);
    cloneCollection(api, collection, name, unlockHeaders(collection.id)).then(result => {
      setBusy(false);
      if (result.kind === 'notCreated') {
        if (isSessionLost(result.error)) {
          onSessionLost();
          return;
        }
        setError(nameSaveError(result.error, dictionary, dictionary.errorCreate));
        return;
      }
      setOutcome(result);
    });
  };

  const open = () => {
    if (outcome) {
      onClose();
      router.push(collectionHref(outcome.collectionId));
    }
  };

  return (
    <Modal closeLabel={dictionary.close} onClose={busy ? () => undefined : outcome ? open : onClose} open title={dictionary.cloneToMine}>
      <form className={styles.panelBody} data-clone-dialog noValidate onSubmit={submit}>
        <p className={styles.settingsNote}>{dictionary.cloneHint}</p>
        <label className={styles.fieldLabel} htmlFor="clone-collection-name">
          {dictionary.collectionNamePlaceholder}
        </label>
        <input
          aria-invalid={Boolean(nameError)}
          className={styles.textInput}
          dir="auto"
          disabled={busy || outcome !== null}
          id="clone-collection-name"
          maxLength={100}
          onChange={event => setName(event.target.value)}
          value={name}
        />
        {nameError && name.length > 0 ? <p className={styles.fieldError}>{nameError}</p> : null}
        {error ? (
          <p className={styles.fieldError} role="alert">
            {error}
          </p>
        ) : null}
        {outcome ? (
          <p className={outcome.failedChunks > 0 ? styles.fieldError : styles.formNotice} data-clone-result={outcome.failedChunks > 0 ? 'partial' : 'complete'} role="status">
            {copyResultMessage(outcome.result, dictionary)}
            {outcome.failedChunks > 0 ? ` ${dictionary.clonePartialFailure}` : ''}
          </p>
        ) : null}
        <div className={styles.formActions}>
          {outcome ? (
            <button className={styles.primaryAction} onClick={open} type="button">
              {dictionary.cloneOpen}
            </button>
          ) : (
            <>
              <button className={styles.settingsAction} disabled={busy} onClick={onClose} type="button">
                {dictionary.cancel}
              </button>
              <button className={styles.primaryAction} disabled={busy || Boolean(nameError)} type="submit">
                {busy ? dictionary.processing : dictionary.cloneSubmit}
              </button>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}
