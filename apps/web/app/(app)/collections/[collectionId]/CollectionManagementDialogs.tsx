'use client';

import { useEffect, useState } from 'react';
import { isSessionLost } from '../../../../lib/authSession';
import {
  collectionDeletePath,
  collectionLockIsConfigured,
  collectionLeavePath,
  collectionManagementError,
  collectionRemoveLockPath,
  collectionSetLockPath,
} from '../../../../lib/collectionManagement';
import { forgetUnlock, unlockHeaders } from '../../../../lib/collectionUnlock';
import { useSignedInApp } from '../../AppRoot';
import { ConfirmDialog } from '../../ConfirmDialog';
import { Modal } from '../../Modal';
import styles from '../../app.module.css';

export type CollectionManagementMode = 'delete' | 'leave' | 'lock' | 'remove' | null;

export function CollectionManagementDialogs({
  collectionId,
  mode,
  onClose,
  onDeleted,
  onLockChanged,
  onOpenLockSettings,
}: {
  readonly collectionId: number;
  readonly mode: CollectionManagementMode;
  readonly onClose: () => void;
  readonly onDeleted: () => void;
  readonly onLockChanged: () => void;
  readonly onOpenLockSettings: () => void;
}) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockConfigured, setLockConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    if (mode !== 'lock') {
      return;
    }
    let ignore = false;
    collectionLockIsConfigured(api).then(
      configured => {
        if (!ignore) setLockConfigured(configured);
      },
      caught => {
        if (ignore) return;
        if (isSessionLost(caught)) {
          onSessionLost();
          onClose();
          return;
        }
        // The lock endpoint checks this again. A transient status-read failure must not invent "not configured".
        setLockConfigured(true);
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, mode, onClose, onSessionLost]);

  const fail = (caught: unknown, action: 'delete' | 'leave' | 'lock' | 'remove') => {
    setBusy(false);
    if (isSessionLost(caught)) {
      onSessionLost();
      onClose();
      return;
    }
    setError(collectionManagementError(caught, dictionary, action));
  };

  const leaveCollection = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    api<void>({ method: 'DELETE', path: collectionLeavePath(collectionId), headers: unlockHeaders(collectionId) }).then(
      () => {
        forgetUnlock(collectionId);
        onDeleted();
      },
      caught => fail(caught, 'leave'),
    );
  };

  const deleteCollection = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    api<void>({ method: 'DELETE', path: collectionDeletePath(collectionId), headers: unlockHeaders(collectionId) }).then(
      () => {
        forgetUnlock(collectionId);
        onDeleted();
      },
      caught => fail(caught, 'delete'),
    );
  };

  const setLock = () => {
    if (busy || lockConfigured === null) return;
    if (!lockConfigured) {
      onOpenLockSettings();
      return;
    }
    setBusy(true);
    setError(null);
    api<void>({ method: 'PUT', path: collectionSetLockPath(collectionId), body: {} }).then(
      () => {
        forgetUnlock(collectionId);
        onLockChanged();
      },
      caught => fail(caught, 'lock'),
    );
  };

  const removeLock = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!password) {
      setError(dictionary.lockPasswordRequired);
      return;
    }
    setBusy(true);
    setError(null);
    api<void>({ method: 'POST', path: collectionRemoveLockPath(collectionId), body: { currentPassword: password } }).then(
      () => {
        forgetUnlock(collectionId);
        onLockChanged();
      },
      caught => fail(caught, 'remove'),
    );
  };

  return (
    <>
      <ConfirmDialog
        busy={busy || (mode === 'lock' && lockConfigured === null)}
        cancelLabel={dictionary.cancel}
        confirmLabel={mode === 'lock' && lockConfigured === false ? dictionary.lockOpenSettings : mode === 'delete' ? dictionary.delete : mode === 'leave' ? dictionary.collectionLeaveConfirmButton : dictionary.lockSetTitle}
        destructive={mode === 'delete' || mode === 'leave'}
        error={error}
        message={mode === 'delete' ? dictionary.collectionDeleteConfirmMessage : mode === 'leave' ? dictionary.collectionLeaveConfirmMessage : lockConfigured === false ? dictionary.lockPasswordNotConfigured : dictionary.lockConfirmMessage}
        onCancel={onClose}
        onConfirm={mode === 'delete' ? deleteCollection : mode === 'leave' ? leaveCollection : setLock}
        open={mode === 'delete' || mode === 'leave' || mode === 'lock'}
        title={mode === 'delete' ? dictionary.collectionDeleteConfirmTitle : mode === 'leave' ? dictionary.collectionLeaveConfirmTitle : lockConfigured === false ? dictionary.lockSetTitle : dictionary.lockConfirmTitle}
      />
      <Modal closeLabel={dictionary.close} onClose={onClose} open={mode === 'remove'} title={dictionary.lockRemoveConfirmTitle}>
        <form className={styles.modalForm} noValidate onSubmit={removeLock}>
          <p className={styles.dialogMessage}>{dictionary.lockRemoveConfirmMessage}</p>
          <label className={styles.formRow}>
            <span className={styles.fieldLabel}>{dictionary.lockPasswordLabel}</span>
            <input
              autoComplete="current-password"
              className={styles.textInput}
              disabled={busy}
              maxLength={64}
              onChange={event => {
                setPassword(event.target.value);
                setError(null);
              }}
              type="password"
              value={password}
            />
          </label>
          {error ? <p className={styles.fieldError} role="alert">{error}</p> : null}
          <div className={styles.formFooter}>
            <button className={styles.settingsAction} disabled={busy} onClick={onClose} type="button">{dictionary.cancel}</button>
            <button className={styles.dangerAction} disabled={busy} type="submit">{dictionary.lockRemoveAction}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
