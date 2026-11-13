'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { formatMessage } from '../../lib/appI18n';
import { isSessionLost } from '../../lib/authSession';
import { addCopyResults, chunkIds, copyItemsPath, copyResultMessage, grantHeaders, isCollaborationActive, itemRestorePath, membershipPath, moveStrategy, moveUndoPath, NO_COPY, replicatePath, transferPath, type CopyResult, type ReplicateResult } from '../../lib/collectionOperations';
import type { CollectionSummary } from '../../lib/collectionsView';
import { unlockHeaders, unlockTokenFor } from '../../lib/collectionUnlock';
import { copyText } from '../../lib/copyText';
import { notifyItemsChanged } from '../../lib/itemChanges';
import { cardClickIntent, emptySelection, formatLinkList, runBatch, selectRange, toggleSelection, withoutIds, type MultiSelectState } from '../../lib/multiSelect';
import type { LinkView } from '../../lib/savedLinks';
import { collectionLinkActions, collectionLinkScope, isSelectableLink, moveTargets, partitionByAuthor, removableLinks, type CollectionRole } from '../../lib/selectionRules';

export { isSelectableLink };
import { useSignedInApp } from './AppRoot';
import { ConfirmDialog } from './ConfirmDialog';
import { DestinationDialog, type PickedDestination } from './DestinationDialog';
import { SelectionToolbar, type SelectionAction } from './SelectionToolbar';
import { useSafety } from './SafetyProvider';
import { useToast } from './Toaster';
import { useItemsChanged } from './useItemsChanged';

/** What a saved-link list needs from a running selection (SavedLinkList reads it; without a provider a list is never selectable). */
export interface LinkSelectionApi {
  readonly active: boolean;
  readonly isSelected: (id: number) => boolean;
  /** The card's own check: toggles (Shift = range in `order`), and starts the selection when none runs. */
  readonly onCheck: (link: LinkView, order: readonly LinkView[], event: MouseEvent) => void;
  /** A click on the card itself: true when the selection took it (the caller then does not open the link). */
  readonly onCardClick: (link: LinkView, order: readonly LinkView[], event: MouseEvent) => boolean;
  /** 선택 종료: ends the selection and clears what was chosen (the same exit as Escape and the bar's close). */
  readonly exit: () => void;
}

const LinkSelectionContext = createContext<LinkSelectionApi | null>(null);

export function useLinkSelection(): LinkSelectionApi | null {
  return useContext(LinkSelectionContext);
}

/** Whether an open dialog owns Escape (the selection must not end under a confirmation or a picker). */
function dialogIsOpen(): boolean {
  return typeof document !== 'undefined' && document.querySelector('dialog[open]') !== null;
}

/**
 * The selection state shared by a page's lists: the chosen ids, the anchor of a Shift+click, and the LinkView of every chosen card (so
 * the actions know its address without asking the server). A link deleted elsewhere leaves the selection by itself.
 */
function useLinkSelectionState() {
  const [state, setState] = useState<MultiSelectState<number>>(emptySelection);
  // The LinkView of every card that was chosen (its address for 링크 복사), kept with the selection - never re-read from the server.
  const [known, setKnown] = useState<ReadonlyMap<number, LinkView>>(new Map());
  const active = state.selected.size > 0;

  const exit = useCallback(() => {
    setState(emptySelection());
  }, []);

  useItemsChanged(change => {
    if (change.kind === 'deleted') {
      setState(current => withoutIds(current, [change.itemId]));
    }
  });

  // Escape ends the selection - unless a dialog is open (Escape is that dialog's: it closes it, and only it).
  useEffect(() => {
    if (!active) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !dialogIsOpen()) {
        exit();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, exit]);

  const remember = (order: readonly LinkView[]) => {
    setKnown(previous => {
      const next = new Map(previous);
      for (const link of order) {
        next.set(link.id, link);
      }
      return next;
    });
  };

  const api = useMemo<LinkSelectionApi>(
    () => ({
      active,
      isSelected: id => state.selected.has(id),
      onCheck: (link, order, event) => {
        if (!isSelectableLink(link)) {
          return;
        }
        remember(order);
        const selectable = order.filter(isSelectableLink).map(entry => entry.id);
        setState(current => (event.shiftKey ? selectRange(current, selectable, link.id) : toggleSelection(current, link.id)));
      },
      onCardClick: (link, order, event) => {
        const intent = cardClickIntent(active, event);
        if (intent === 'open') {
          return false;
        }
        event.preventDefault();
        if (!isSelectableLink(link)) {
          return true;
        }
        remember(order);
        const selectable = order.filter(isSelectableLink).map(entry => entry.id);
        setState(current => (intent === 'range' ? selectRange(current, selectable, link.id) : toggleSelection(current, link.id)));
        return true;
      },
      exit,
    }),
    [active, exit, state.selected],
  );

  const selectedLinks = [...state.selected].map(id => known.get(id)).filter((link): link is LinkView => link !== undefined);
  return { api, state, setState, selectedLinks, exit, active };
}

/**
 * Home and 보관함 (mobile useSavedLinkSelection - the two share it so they never drift): the person's OWN links.
 *  - 컬렉션에 추가: ADDS the chosen links to the Collections picked in the usual destination picker (memberships already there stay;
 *    nothing is removed in bulk) - one server call per link, a few at a time.
 *  - 링크 복사: the addresses as one text, one per line.
 *  - 삭제: the links THEMSELVES (recoverable from 최근 삭제한 항목, with one 되돌리기 for all of them), after a confirmation that
 *    names the count. A partial failure says so and keeps the failed links chosen for a retry.
 */
export function PersonalLinkSelection({ children, selectAllIds }: { readonly children: ReactNode; readonly selectAllIds?: () => readonly LinkView[] }) {
  const { api: request, dictionary, onSessionLost } = useSignedInApp();
  const toast = useToast();
  const selection = useLinkSelectionState();
  const { state, setState, selectedLinks, exit } = selection;
  const [dialog, setDialog] = useState<'delete' | 'add' | null>(null);
  const [busy, setBusy] = useState(false);
  const count = state.selected.size;

  const failedNotice = (failed: number) => formatMessage(dictionary.selectionResultFailedKept, { count: failed });

  const copyLinks = async () => {
    const text = formatLinkList(selectedLinks.map(link => link.externalUrl));
    const copied = text.length > 0 && (await copyText(text));
    toast.showNotice(copied ? formatMessage(dictionary.selectionLinksCopied, { count: selectedLinks.length }) : dictionary.itemLinkCopyFailed, copied ? 'info' : 'error');
  };

  const deleteLinks = async () => {
    const ids = selectedLinks.map(link => link.id);
    setBusy(true);
    const outcome = await runBatch(ids, id => request<void>({ method: 'DELETE', path: `/api/v1/items/${id}` }));
    setBusy(false);
    setDialog(null);
    if (outcome.failed.length > 0 && isSessionLost(outcome.firstError)) {
      onSessionLost();
      return;
    }
    for (const id of outcome.succeeded) {
      notifyItemsChanged({ kind: 'deleted', itemId: id });
    }
    setState(current => withoutIds(current, outcome.succeeded));
    if (outcome.succeeded.length === 0) {
      toast.showNotice(dictionary.selectionActionFailed, 'error');
      return;
    }
    if (outcome.failed.length > 0) {
      toast.showNotice(`${formatMessage(dictionary.selectionDeletedPartial, { total: ids.length, ok: outcome.succeeded.length })} ${failedNotice(outcome.failed.length)}`, 'error');
      return;
    }
    const restored = outcome.succeeded;
    toast.showUndo({
      message: restored.length === 1 ? dictionary.toastDeleted : formatMessage(dictionary.selectionDeletedLinks, { count: restored.length }),
      errorMessage: dictionary.toastUndoDeleteError,
      undo: async () => {
        const undo = await runBatch(restored, id => request<void>({ method: 'POST', path: itemRestorePath(id) }));
        notifyItemsChanged({ kind: 'refresh' });
        if (undo.failed.length > 0) {
          throw undo.firstError;
        }
      },
    });
    exit();
  };

  const addToCollections = async (picked: readonly PickedDestination[]) => {
    const unlockTokens: Record<number, string> = {};
    for (const entry of picked) {
      if (entry.unlockToken) {
        unlockTokens[entry.collection.id] = entry.unlockToken;
      }
    }
    const collectionIds = picked.map(entry => entry.collection.id);
    const ids = selectedLinks.map(link => link.id);
    const outcome = await runBatch(ids, id => request<ReplicateResult>({ method: 'POST', path: replicatePath(id), body: { collectionIds, unlockTokens } }).then(() => undefined));
    if (outcome.succeeded.length === 0) {
      // The dialog stays open with the reason; nothing was added.
      throw outcome.firstError;
    }
    // A link put into a locked Collection becomes a redacted card on Home / 보관함: the lists read themselves again.
    notifyItemsChanged({ kind: 'refresh' });
    if (outcome.failed.length > 0) {
      setState(current => withoutIds(current, outcome.succeeded));
      toast.showNotice(`${formatMessage(dictionary.selectionAddedToCollectionsPartial, { total: ids.length, ok: outcome.succeeded.length })} ${failedNotice(outcome.failed.length)}`, 'error');
      return;
    }
    toast.showNotice(formatMessage(dictionary.selectionAddedToCollections, { links: outcome.succeeded.length, collections: collectionIds.length }));
    exit();
  };

  return (
    <LinkSelectionContext.Provider value={selection.api}>
      {children}
      {selection.active ? (
        <SelectionToolbar
          actions={[
            { key: 'add', label: dictionary.selectionAddToCollections, icon: 'Folder', onClick: () => setDialog('add') },
            { key: 'copy', label: dictionary.selectionCopyLinks, icon: 'Copy', onClick: () => void copyLinks() },
            { key: 'delete', label: dictionary.delete, icon: 'Trash', destructive: true, onClick: () => setDialog('delete') },
          ]}
          busy={busy}
          count={count}
          dictionary={dictionary}
          onExit={exit}
          onSelectAll={
            selectAllIds
              ? () => {
                  const links = selectAllIds().filter(isSelectableLink);
                  setState(current => ({ selected: new Set([...current.selected, ...links.map(link => link.id)]), anchor: current.anchor }));
                }
              : undefined
          }
        />
      ) : null}
{dialog === 'delete' ? (
      <ConfirmDialog
        busy={busy}
        cancelLabel={dictionary.cancel}
        confirmLabel={busy ? dictionary.deleting : dictionary.delete}
        destructive
        message={count > 1 ? formatMessage(dictionary.selectionDeleteLinksMessage, { count }) : dictionary.inboxDeleteConfirmMessage}
        onCancel={() => setDialog(null)}
        onConfirm={() => void deleteLinks()}
        open={dialog === 'delete'}
        title={count > 1 ? formatMessage(dictionary.selectionDeleteLinksTitle, { count }) : dictionary.inboxDeleteConfirmTitle}
      />
) : null}
      {dialog === 'add' ? (
        <DestinationDialog
          confirmLabel={dictionary.selectionAddToCollections}
          errorMessage={() => dictionary.selectionActionFailed}
          onClose={() => setDialog(null)}
          onSubmit={addToCollections}
          selection="multiple"
          title={formatMessage(dictionary.selectionAddToCollectionsTitle, { count })}
        />
      ) : null}
    </LinkSelectionContext.Provider>
  );
}

/**
 * A Collection's links (mobile useCollectionLinkSelection, with its action policy - lib/selectionRules collectionLinkActions):
 *  - 삭제 = 이 컬렉션에서 제거: the Owner any link, a member only their own; the link stays in its owner's 보관함; one 되돌리기.
 *  - 이동: only links I added, into ONE Collection of mine. A mixed selection says how many will and will not move BEFORE anything
 *    happens. The server's atomic move where the two Collections are nobody else's (it has an undo), otherwise add-then-remove (no undo,
 *    and a failure in between leaves the link in both, never in neither).
 *  - 컬렉션에 복사: into my own Collections (the server's copy call, in chunks, with this visit's grant and a locked destination's grant).
 *  - 신고: each selected link of another person is its OWN report (same reason and explanation); nothing is deleted or blocked by it.
 * Every call is one request per link; a partial result is reported as one and the failed links stay selected.
 */
export function CollectionLinkSelection({
  children,
  collectionId,
  role,
  source,
}: {
  readonly children: ReactNode;
  readonly collectionId: number;
  readonly role: CollectionRole;
  /** This Collection as the move rules need it (owner / collaboration). */
  readonly source: Pick<CollectionSummary, 'accessRole' | 'hasCollaborators' | 'isPublicShareActive'>;
}) {
  const { api: request, dictionary, onSessionLost } = useSignedInApp();
  const toast = useToast();
  const safety = useSafety();
  const selection = useLinkSelectionState();
  const { state, setState, selectedLinks, exit } = selection;
  const [dialog, setDialog] = useState<'remove' | 'copy' | 'moveMixed' | 'move' | null>(null);
  const [busy, setBusy] = useState(false);
  const count = state.selected.size;
  const scope = collectionLinkScope(role, source.hasCollaborators === true || source.isPublicShareActive === true);
  const { mine, others } = partitionByAuthor(selectedLinks, scope);
  const removable = removableLinks(selectedLinks, scope);
  const kept = selectedLinks.length - removable.length;
  const available = new Set(collectionLinkActions(scope, selectedLinks));

  const failedKept = (failed: number) => formatMessage(dictionary.selectionResultFailedKept, { count: failed });
  const keepOnly = (ids: readonly number[]) => setState(current => ({ selected: new Set(ids), anchor: current.anchor }));

  const copyLinks = async () => {
    const text = formatLinkList(selectedLinks.map(link => link.externalUrl));
    const copied = text.length > 0 && (await copyText(text));
    toast.showNotice(copied ? formatMessage(dictionary.selectionLinksCopied, { count: selectedLinks.length }) : dictionary.itemLinkCopyFailed, copied ? 'info' : 'error');
  };

  const copyTo = async (picked: readonly PickedDestination[]) => {
    const itemIds = selectedLinks.map(link => link.id);
    let result: CopyResult = NO_COPY;
    let failures = 0;
    let firstError: unknown = null;
    for (const destination of picked) {
      for (const chunk of chunkIds(itemIds)) {
        try {
          const copied = await request<CopyResult>({
            method: 'POST',
            path: copyItemsPath(collectionId),
            body: { destinationCollectionId: destination.collection.id, itemIds: chunk },
            headers: grantHeaders(unlockTokenFor(collectionId), destination.unlockToken),
          });
          result = addCopyResults(result, copied);
        } catch (error) {
          failures += 1;
          firstError ??= error;
        }
      }
    }
    if (failures > 0 && result.copiedCount === 0 && result.skippedCount === 0) {
      throw firstError;
    }
    toast.showNotice(failures > 0 ? `${copyResultMessage(result, dictionary)} ${dictionary.selectionActionFailed}` : copyResultMessage(result, dictionary), failures > 0 ? 'error' : 'info');
    if (failures === 0) {
      exit();
    }
  };

  const remove = async () => {
    // Re-decided from the CURRENT selection right before running: another person's link is never removed by a member.
    const ids = removableLinks(selectedLinks, scope).map(link => link.id);
    setBusy(true);
    const outcome = await runBatch(ids, id => request<void>({ method: 'DELETE', path: membershipPath(collectionId, id), headers: unlockHeaders(collectionId) }));
    setBusy(false);
    setDialog(null);
    if (outcome.failed.length > 0 && isSessionLost(outcome.firstError)) {
      onSessionLost();
      return;
    }
    for (const id of outcome.succeeded) {
      notifyItemsChanged({ kind: 'removedFromCollection', itemId: id, collectionId });
    }
    setState(current => withoutIds(current, outcome.succeeded));
    if (outcome.succeeded.length === 0) {
      toast.showNotice(dictionary.selectionActionFailed, 'error');
      return;
    }
    if (outcome.failed.length > 0) {
      toast.showNotice(`${formatMessage(dictionary.selectionRemovedLinksPartial, { total: ids.length, ok: outcome.succeeded.length })} ${failedKept(outcome.failed.length)}`, 'error');
      return;
    }
    // The grant of this visit is taken now: 되돌리기 may be pressed after the page forgot it.
    const undoHeaders = unlockHeaders(collectionId);
    const restored = outcome.succeeded;
    toast.showUndo({
      message: formatMessage(dictionary.selectionRemovedLinks, { count: restored.length }),
      errorMessage: dictionary.toastUndoRemoveError,
      undo: async () => {
        const undo = await runBatch(restored, id => request<unknown>({ method: 'PUT', path: membershipPath(collectionId, id), headers: undoHeaders }).then(() => undefined));
        notifyItemsChanged({ kind: 'refresh' });
        if (undo.failed.length > 0) {
          throw undo.firstError;
        }
      },
    });
    if (kept === 0) {
      exit();
    }
  };

  /** One link moved; the undo of an atomic move, or null when the two permitted steps were composed (they have no undo). */
  const moveOne = async (itemId: number, target: PickedDestination): Promise<(() => Promise<void>) | null> => {
    if (moveStrategy(source, target.collection) === 'atomic') {
      const headers = grantHeaders(unlockTokenFor(collectionId), target.unlockToken);
      try {
        const result = await request<{ readonly targetMembershipCreated?: boolean } | undefined>({ method: 'POST', path: transferPath(collectionId, itemId), body: { targetCollectionId: target.collection.id }, headers });
        const targetMembershipCreated = result?.targetMembershipCreated === true;
        return async () => {
          await request<void>({ method: 'POST', path: moveUndoPath(collectionId, itemId), body: { targetCollectionId: target.collection.id, targetMembershipCreated }, headers });
        };
      } catch (caught) {
        // A still-pending invitation also makes the server refuse the atomic move: compose the two permitted steps instead.
        if (!isCollaborationActive(caught)) {
          throw caught;
        }
      }
    }
    await request<unknown>({ method: 'PUT', path: membershipPath(target.collection.id, itemId), headers: grantHeaders(target.unlockToken) });
    await request<void>({ method: 'DELETE', path: membershipPath(collectionId, itemId), headers: unlockHeaders(collectionId) });
    return null;
  };

  const moveTo = async (picked: readonly PickedDestination[]) => {
    const target = picked[0];
    const ids = moveTargets(selectedLinks, scope).map(link => link.id);
    if (!target || ids.length === 0) {
      return;
    }
    const undos = new Map<number, () => Promise<void>>();
    const outcome = await runBatch(ids, async id => {
      const undo = await moveOne(id, target);
      if (undo) {
        undos.set(id, undo);
      }
    });
    if (outcome.succeeded.length === 0) {
      // The picker stays open with the reason; nothing moved.
      throw outcome.firstError;
    }
    for (const id of outcome.succeeded) {
      notifyItemsChanged({ kind: 'removedFromCollection', itemId: id, collectionId });
    }
    if (outcome.failed.length > 0) {
      keepOnly(outcome.failed);
      toast.showNotice(`${formatMessage(dictionary.selectionMovedLinksPartial, { total: ids.length, ok: outcome.succeeded.length })} ${failedKept(outcome.failed.length)}`, 'error');
      return;
    }
    exit();
    const message = outcome.succeeded.length === 1 ? dictionary.toastMoved : formatMessage(dictionary.selectionMovedLinks, { count: outcome.succeeded.length });
    // Only when every link went by the atomic move can the whole move be undone (the composed way has no server-side reverse).
    if (undos.size === outcome.succeeded.length) {
      toast.showUndo({
        message,
        errorMessage: dictionary.toastUndoMoveError,
        undo: async () => {
          const undone = await runBatch([...undos.keys()], id => (undos.get(id) as () => Promise<void>)());
          notifyItemsChanged({ kind: 'refresh' });
          if (undone.failed.length > 0) {
            throw undone.firstError;
          }
        },
      });
    } else {
      toast.showNotice(message);
    }
  };

  const startMove = () => {
    // Say what will and will not move BEFORE anything happens.
    setDialog(others.length > 0 ? 'moveMixed' : 'move');
  };

  const startReport = () => {
    const targets = others.map(link => ({ type: 'Item' as const, itemId: link.id, collectionId }));
    safety.reportMany(targets, outcome => {
      const lines = [formatMessage(dictionary.selectionReportReceived, { count: outcome.received.length + outcome.alreadyReported.length })];
      if (outcome.alreadyReported.length > 0) {
        lines.push(formatMessage(dictionary.selectionReportAlready, { count: outcome.alreadyReported.length }));
      }
      if (outcome.failed.length > 0) {
        lines.push(outcome.rateLimited ? dictionary.selectionReportLimit : formatMessage(dictionary.selectionReportFailed, { count: outcome.failed.length }));
        keepOnly(outcome.failed.flatMap(target => (target.type === 'Item' ? [target.itemId] : [])));
        toast.showNotice(lines.join(' '), 'error');
        return;
      }
      exit();
      toast.showNotice(lines.join(' '));
    });
  };

  const actions: SelectionAction[] = [
    ...(available.has('delete') ? [{ key: 'remove', label: dictionary.removeFromCollectionAction, icon: 'Trash' as const, destructive: true, disabled: removable.length === 0, onClick: () => setDialog('remove') }] : []),
    ...(available.has('move') ? [{ key: 'move', label: dictionary.selectionMoveToCollection, icon: 'Move' as const, onClick: startMove }] : []),
    { key: 'copyTo', label: dictionary.selectionCopyToCollection, icon: 'Copy', onClick: () => setDialog('copy') },
    { key: 'copy', label: dictionary.selectionCopyLinks, icon: 'Link', onClick: () => void copyLinks() },
    ...(available.has('report')
      ? [{ key: 'report', label: mine.length > 0 ? formatMessage(dictionary.selectionReportOthers, { count: others.length }) : dictionary.selectionReport, icon: 'Flag' as const, destructive: true, onClick: startReport }]
      : []),
  ];

  return (
    <LinkSelectionContext.Provider value={selection.api}>
      {children}
      {selection.active ? <SelectionToolbar actions={actions} busy={busy} count={count} dictionary={dictionary} onExit={exit} /> : null}
{dialog === 'remove' ? (
      <ConfirmDialog
        busy={busy}
        cancelLabel={dictionary.cancel}
        confirmLabel={busy ? dictionary.deleting : dictionary.delete}
        destructive
        message={kept > 0 ? formatMessage(dictionary.selectionRemoveKeptNote, { count: kept }) : undefined}
        onCancel={() => setDialog(null)}
        onConfirm={() => void remove()}
        open={dialog === 'remove'}
        title={formatMessage(dictionary.selectionRemoveLinksTitle, { count: removable.length })}
      />
) : null}
{dialog === 'moveMixed' ? (
      <ConfirmDialog
        cancelLabel={dictionary.cancel}
        confirmLabel={dictionary.selectionMoveContinue}
        message={mine.length > 0 ? formatMessage(dictionary.selectionMoveMixedMessage, { mine: mine.length, others: others.length }) : dictionary.selectionMoveNothingMessage}
        onCancel={() => setDialog(null)}
        onConfirm={() => setDialog(mine.length > 0 ? 'move' : null)}
        open={dialog === 'moveMixed'}
        title={dictionary.selectionMoveMixedTitle}
      />
) : null}
      {dialog === 'move' ? (
        <DestinationDialog
          confirmLabel={dictionary.confirmMove}
          errorMessage={() => dictionary.selectionActionFailed}
          excluded={[collectionId]}
          onClose={() => setDialog(null)}
          onSubmit={moveTo}
          selection="single"
          title={formatMessage(dictionary.selectionMoveTitle, { count: mine.length })}
        />
      ) : null}
      {dialog === 'copy' ? (
        <DestinationDialog
          confirmLabel={dictionary.selectionCopyToCollection}
          errorMessage={() => dictionary.selectionActionFailed}
          excluded={[collectionId]}
          onClose={() => setDialog(null)}
          onSubmit={copyTo}
          selection="multiple"
          title={formatMessage(dictionary.selectionCopyTitle, { count })}
        />
      ) : null}
    </LinkSelectionContext.Provider>
  );
}
