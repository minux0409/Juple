'use client';
import { useRef, useState, type ReactNode } from 'react';
import { isSessionLost } from '../../../lib/authSession';
import { cancelPendingJoin, loadPendingJoins } from '../../../lib/pendingJoins';
import { useSignedInApp } from '../AppRoot';
import { Modal } from '../Modal';
import styles from '../app.module.css';

/** Both the shared list and a reopened share link resolve the same server-owned request. */
export function PendingJoinDialog({ publicId, requestId, onClose, onWithdrawn, children }: {
  readonly publicId: string; readonly requestId?: number; readonly children?: ReactNode;
  readonly onClose: () => void; readonly onWithdrawn: () => void;
}) {
  const { api, dictionary: d, onSessionLost } = useSignedInApp();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const withdraw = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const id = requestId ?? (await loadPendingJoins(api)).find(item => item.publicId === publicId)?.requestId;
      if (id === undefined) { setError(d.submissionsAlreadyCancelledOrProcessed); return; }
      await cancelPendingJoin(api, id);
      onWithdrawn();
    } catch (caught) {
      if (isSessionLost(caught)) onSessionLost();
      else setError(d.submissionsCancelFailed);
    } finally { busyRef.current = false; setBusy(false); }
  };
  return <Modal open title={confirm ? d.cancelJoinTitle : d.shareEntryPendingTitle} closeLabel={d.close}
    onClose={() => { if (!busyRef.current) onClose(); }}>
    <div className={styles.pendingJoinDialogBody}><p className={styles.dialogMessage}>{confirm ? d.cancelJoinMessage : d.shareEntryPendingMessage}</p>
    {!confirm ? children : null}
    {error ? <p role="alert" className={styles.fieldError}>{error}</p> : null}
    <div className={styles.formActions}>
      <button type="button" className={styles.settingsAction} disabled={busy}
        onClick={() => { if (confirm) { setConfirm(false); setError(null); } else setConfirm(true); }}>
        {confirm ? d.submissionsKeepRequest : d.submissionsCancelRequest}
      </button>
      <button type="button" className={styles.primaryAction} disabled={busy}
        onClick={() => { if (confirm) void withdraw(); else onClose(); }}>
        {busy ? d.processing : confirm ? d.submissionsCancelRequest : d.confirm}
      </button>
    </div></div>
  </Modal>;
}
