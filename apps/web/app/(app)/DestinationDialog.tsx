'use client';

import { useEffect, useState } from 'react';
import { isSessionLost } from '../../lib/authSession';
import { loadOwnedCollections } from '../../lib/collectionOperations';
import type { CollectionSummary } from '../../lib/collectionsView';
import { createPickerUnlockSession } from '../../lib/pickerUnlockSession';
import { useSignedInApp } from './AppRoot';
import { CollectionPicker } from './CollectionPicker';
import { Modal } from './Modal';
import styles from './app.module.css';

export interface PickedDestination {
  readonly collection: CollectionSummary;
  /** The grant a locked destination needed in this dialog (sent with that destination only), else null. */
  readonly unlockToken: string | null;
}

/**
 * Where a link goes (mobile useCollectionDestinationPicker): the person's OWN Collections, in the shared CollectionPicker - its search,
 * its fresh read of a Collection at the moment it is chosen, and its password prompt for a locked one (that grant lives only in this
 * dialog and travels only with that destination). 이동 takes exactly one; 복제 / 복사 any number. Collections the link is already in are
 * shown as chosen and cannot be taken away (`contained`); `excluded` ones (the Collection a link is moved out of) are not offered.
 *
 * `onSubmit` does the action: a rejection keeps the dialog and its choice, with the reason; a resolution closes it.
 */
export function DestinationDialog({
  title,
  confirmLabel,
  selection,
  contained = [],
  excluded = [],
  eligible,
  onSubmit,
  errorMessage,
  onClose,
  viewModes,
}: {
  readonly title: string;
  readonly confirmLabel: string;
  readonly selection: 'single' | 'multiple';
  readonly contained?: readonly number[];
  readonly excluded?: readonly number[];
  /** Only these are offered (병합: mine, not itself, nobody else in it). */
  readonly eligible?: (collection: CollectionSummary) => boolean;
  readonly onSubmit: (destinations: readonly PickedDestination[]) => Promise<void>;
  readonly errorMessage: (error: unknown) => string;
  readonly onClose: () => void;
  /** Offers the picker's List | Grid switch (병합). */
  readonly viewModes?: boolean;
}) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const [destinations, setDestinations] = useState<readonly CollectionSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set());
  const [session] = useState(createPickerUnlockSession);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containedIds = new Set(contained);

  useEffect(() => {
    let ignore = false;
    loadOwnedCollections(api).then(
      list => {
        if (!ignore) {
          setDestinations(list.filter(collection => !excluded.includes(collection.id) && (eligible ? eligible(collection) : true)));
        }
      },
      caught => {
        if (ignore) {
          return;
        }
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setFailed(true);
      },
    );
    return () => {
      ignore = true;
    };
    // Read once per opening (the dialog is mounted for one action).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (collection: CollectionSummary) => {
    if (containedIds.has(collection.id)) {
      return;
    }
    setError(null);
    setChosen(current => {
      if (current.has(collection.id)) {
        const next = new Set(current);
        next.delete(collection.id);
        return next;
      }
      return selection === 'single' ? new Set([collection.id]) : new Set([...current, collection.id]);
    });
  };

  const submit = () => {
    if (busy || chosen.size === 0 || !destinations) {
      return;
    }
    const picked = destinations
      .filter(collection => chosen.has(collection.id))
      .map(collection => ({ collection, unlockToken: session.tokenFor(collection.id) }));
    setBusy(true);
    setError(null);
    onSubmit(picked).then(
      () => {
        setBusy(false);
        session.clear();
        onClose();
      },
      caught => {
        setBusy(false);
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setError(errorMessage(caught));
      },
    );
  };

  const empty = destinations !== null && destinations.length === 0;
  return (
    <Modal closeLabel={dictionary.close} onClose={busy ? () => undefined : onClose} open title={title}>
      <div className={styles.panelBody} data-destination-dialog={selection}>
        {empty ? (
          <p className={styles.stateMessage}>{dictionary.destinationsEmpty}</p>
        ) : (
          <CollectionPicker
            destinations={destinations}
            failed={failed}
            isDeselectBlocked={collection => containedIds.has(collection.id)}
            onRefreshed={fresh => setDestinations(previous => (previous ? previous.map(entry => (entry.id === fresh.id ? fresh : entry)) : previous))}
            onToggle={toggle}
            onUnavailable={collectionId => {
              setDestinations(previous => (previous ? previous.filter(entry => entry.id !== collectionId) : previous));
              setChosen(current => {
                const next = new Set(current);
                next.delete(collectionId);
                return next;
              });
            }}
            selectedIds={new Set([...chosen, ...containedIds])}
            session={session}
            viewModes={viewModes}
          />
        )}
        {failed ? <p className={styles.formError}>{dictionary.destinationsLoadFailed}</p> : null}
        {error ? (
          <p className={styles.fieldError} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.formActions}>
          <button className={styles.settingsAction} disabled={busy} onClick={onClose} type="button">
            {dictionary.cancel}
          </button>
          <button className={styles.primaryAction} data-destination-submit disabled={busy || chosen.size === 0} onClick={submit} type="button">
            {busy ? dictionary.processing : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
