'use client';

import { useEffect, useState } from 'react';
import { isSessionLost } from '../../../../lib/authSession';
import { clearMergeUndo, MERGE_UNDO_PATH, MERGE_UNDO_WINDOW_MS, type PendingMergeUndo } from '../../../../lib/collectionOperations';
import { notifyItemsChanged } from '../../../../lib/itemChanges';
import { useSignedInApp } from '../../AppRoot';
import { Glyph } from '../../Glyph';
import styles from '../../app.module.css';

/**
 * 컬렉션을 병합했습니다 · 되돌리기 - on the target, right after a merge, for MERGE_UNDO_WINDOW_MS (mobile's undo toast). 되돌리기 asks
 * the server to reverse exactly that merge (POST /api/v1/collections/merge/undo { undoOperationId }): the source Collection comes back
 * and only the memberships the merge itself created leave the target - the server is the only truth for that, the page is just read
 * again. A refused undo says so and stays until it is dismissed.
 */
export function MergeUndoBanner({ undo, onUndone, onDone }: { readonly undo: PendingMergeUndo; readonly onUndone: () => void; readonly onDone: () => void }) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const [phase, setPhase] = useState<'offer' | 'undoing' | 'failed'>('offer');

  useEffect(() => {
    if (phase !== 'offer') {
      return undefined;
    }
    const timer = setTimeout(() => {
      clearMergeUndo(undo.undoOperationId);
      onDone();
    }, MERGE_UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [onDone, phase, undo.undoOperationId]);

  const runUndo = () => {
    if (phase !== 'offer') {
      return;
    }
    setPhase('undoing');
    api<void>({ method: 'POST', path: MERGE_UNDO_PATH, body: { undoOperationId: undo.undoOperationId } }).then(
      () => {
        clearMergeUndo(undo.undoOperationId);
        notifyItemsChanged();
        onUndone();
        onDone();
      },
      caught => {
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        clearMergeUndo(undo.undoOperationId);
        setPhase('failed');
      },
    );
  };

  return (
    <div className={phase === 'failed' ? `${styles.undoBanner} ${styles.undoBannerFailed}` : styles.undoBanner} data-merge-undo={phase} role={phase === 'failed' ? 'alert' : 'status'}>
      <span className={styles.undoBannerText}>{phase === 'failed' ? dictionary.undoMergeError : dictionary.mergeSuccess}</span>
      {phase === 'failed' ? (
        <button aria-label={dictionary.close} className={styles.undoBannerClose} onClick={onDone} type="button">
          <Glyph name="Close" size={16} />
        </button>
      ) : (
        <button className={styles.undoBannerAction} disabled={phase === 'undoing'} onClick={runUndo} type="button">
          {phase === 'undoing' ? dictionary.processing : dictionary.undoAction}
        </button>
      )}
    </div>
  );
}
