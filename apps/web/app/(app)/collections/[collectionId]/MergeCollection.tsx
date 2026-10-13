'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { formatMessage } from '../../../../lib/appI18n';
import { isSessionLost } from '../../../../lib/authSession';
import { contentGateOf, type CollectionDetail } from '../../../../lib/collectionDetails';
import { grantHeaders, isMergeTarget, mergePath, rememberMergeUndo, type MergeResult } from '../../../../lib/collectionOperations';
import { unlockTokenFor } from '../../../../lib/collectionUnlock';
import { notifyItemsChanged } from '../../../../lib/itemChanges';
import { collectionHref } from '../../../../lib/savedLinks';
import { useSignedInApp } from '../../AppRoot';
import { ConfirmDialog } from '../../ConfirmDialog';
import { DestinationDialog, type PickedDestination } from '../../DestinationDialog';

/**
 * 다른 컬렉션과 병합 (mobile confirmMergeAction, on the existing merge API - nothing new on the server):
 *
 *  1. the target: one of MY Collections, not this one, nobody else in it (the shared destination dialog; a locked one asks its password);
 *  2. a confirmation that says, before anything happens, what moves where and that THIS Collection is deleted afterwards (red 병합);
 *  3. POST /api/v1/collections/{source}/merge { targetCollectionId } - the server adds every link of this Collection the target does
 *     not already have (per link: never a duplicate membership), and soft-deletes this one, in ONE transaction: a refusal or a failure
 *     changes nothing here;
 *  4. the target opens, offering 되돌리기 for MERGE_UNDO_WINDOW_MS (mobile's undo toast) - see MergeUndoBanner.
 */
export function MergeCollection({ collection, onClose, onFailed }: { readonly collection: CollectionDetail; readonly onClose: () => void; readonly onFailed: (message: string) => void }) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const router = useRouter();
  const [target, setTarget] = useState<PickedDestination | null>(null);
  const [busy, setBusy] = useState(false);
  // The picker closes itself after a choice: that close leads to the confirmation, only a cancel ends the flow.
  const picked = useRef(false);

  const merge = () => {
    if (!target || busy) {
      return;
    }
    setBusy(true);
    api<MergeResult>({
      method: 'POST',
      path: mergePath(collection.id),
      body: { targetCollectionId: target.collection.id },
      headers: grantHeaders(unlockTokenFor(collection.id), target.unlockToken),
    }).then(
      result => {
        if (result.undoOperationId) {
          rememberMergeUndo({ undoOperationId: result.undoOperationId, sourceCollectionId: collection.id, targetCollectionId: target.collection.id, sourceName: collection.name });
        }
        notifyItemsChanged({ kind: 'refresh' });
        onClose();
        router.replace(collectionHref(target.collection.id));
      },
      caught => {
        setBusy(false);
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        onClose();
        onFailed(contentGateOf(caught) ? dictionary.lockRequiredForAction : dictionary.mergeError);
      },
    );
  };

  if (!target) {
    return (
      <DestinationDialog
        confirmLabel={dictionary.confirm}
        eligible={candidate => isMergeTarget(candidate, collection.id)}
        errorMessage={() => dictionary.mergeError}
        excluded={[collection.id]}
        onClose={() => {
          if (!picked.current) {
            onClose();
          }
        }}
        onSubmit={async choice => {
          picked.current = true;
          setTarget(choice[0]);
        }}
        selection="single"
        title={dictionary.mergeTitle}
      />
    );
  }
  return (
    <ConfirmDialog
      busy={busy}
      cancelLabel={dictionary.cancel}
      confirmLabel={dictionary.mergeAction}
      destructive
      message={formatMessage(dictionary.mergeConfirmBody, { source: collection.name, target: target.collection.name, count: collection.itemCount })}
      onCancel={onClose}
      onConfirm={merge}
      open
      title={dictionary.mergeConfirmTitle}
    />
  );
}
