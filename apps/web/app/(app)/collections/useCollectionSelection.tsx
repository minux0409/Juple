'use client';

import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { formatMessage } from '../../../lib/appI18n';
import { isSessionLost } from '../../../lib/authSession';
import { collectionPath } from '../../../lib/collectionDetails';
import { collectionDeletePath, collectionLeavePath, collectionSetLockPath, collectionSetMemberLockPath } from '../../../lib/collectionManagement';
import type { CollectionSummary } from '../../../lib/collectionsView';
import { lockableCollections, planCollectionBulk } from '../../../lib/selectionRules';
import { isSharedWithMe } from '../../../lib/collectionSharing';
import { ApiHttpError } from '../../../lib/appApi';
import { cardClickIntent, emptySelection, runBatch, selectRange, toggleSelection, withoutIds, type MultiSelectState } from '../../../lib/multiSelect';
import { useSignedInApp } from '../AppRoot';
import { ConfirmDialog } from '../ConfirmDialog';
import { SelectionToolbar, type SelectionAction } from '../SelectionToolbar';
import { useToast } from '../Toaster';

/**
 * Multi-selection on the Collections list: the card check starts it (Shift+click = a range), a click on a card toggles it while it runs,
 * the bar offers 즐겨찾기 (all on / all off), 삭제 (own, open) and 나가기 (shared with me). Every Collection is its own server call, a few
 * at a time; a partial failure keeps the failed ones chosen. The list is told what changed (`onChanged`) so it updates in place.
 */
export function useCollectionSelection({
  items,
  onFavoriteChanged,
  onRemoved,
  onLocked,
}: {
  readonly items: readonly CollectionSummary[];
  /** The server's answer for one Collection's favorite (the list replaces it, and in 즐겨찾기 drops a removed one). */
  readonly onFavoriteChanged: (collection: CollectionSummary) => void;
  /** Deleted / left Collections: the list takes them out. */
  readonly onRemoved: (ids: readonly number[]) => void;
  /** Locked by this selection: the list shows them locked at once (and reads itself again). */
  readonly onLocked: (ids: readonly number[]) => void;
}) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const toast = useToast();
  const [state, setState] = useState<MultiSelectState<number>>(emptySelection);
  const [armed, setArmed] = useState(false);
  const [dialog, setDialog] = useState<'delete' | 'leave' | 'lock' | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = items.filter(collection => state.selected.has(collection.id));
  const active = armed || selected.length > 0;
  const plan = planCollectionBulk(selected);
  const lockTargets = lockableCollections(selected);

  const exit = useCallback(() => {
    setArmed(false);
    setState(emptySelection());
  }, []);

  // Only what is LISTED counts (another tab / search shows other Collections): `selected` is the chosen ids that are on screen.
  useEffect(() => {
    if (!active) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && document.querySelector('dialog[open]') === null) {
        exit();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, exit]);

  const order = items.map(collection => collection.id);
  const check = (collection: CollectionSummary, event: MouseEvent) => {
    setState(current => (event.shiftKey ? selectRange(current, order, collection.id) : toggleSelection(current, collection.id)));
  };
  const cardClick = (collection: CollectionSummary, event: MouseEvent): void => {
    const intent = cardClickIntent(active, event);
    if (intent === 'open') {
      return;
    }
    event.preventDefault();
    setState(current => (intent === 'range' ? selectRange(current, order, collection.id) : toggleSelection(current, collection.id)));
  };

  const failedKept = (count: number) => formatMessage(dictionary.selectionResultFailedKept, { count });

  const setFavorites = async () => {
    const target = plan.favoriteTarget;
    const chosen = selected.filter(collection => collection.isFavorite !== target);
    setBusy(true);
    const answers = new Map<number, CollectionSummary>();
    const outcome = await runBatch(
      chosen.map(collection => collection.id),
      id => api<CollectionSummary>({ method: 'PUT', path: `${collectionPath(id)}/favorite`, body: { isFavorite: target } }).then(updated => void answers.set(id, updated)),
    );
    setBusy(false);
    if (outcome.failed.length > 0 && isSessionLost(outcome.firstError)) {
      onSessionLost();
      return;
    }
    for (const collection of chosen) {
      const updated = answers.get(collection.id);
      if (updated) {
        onFavoriteChanged({ ...collection, ...updated });
      }
    }
    if (outcome.succeeded.length === 0 && chosen.length > 0) {
      toast.showNotice(dictionary.selectionActionFailed, 'error');
      return;
    }
    if (outcome.failed.length > 0) {
      setState(current => withoutIds(current, outcome.succeeded));
      toast.showNotice(`${formatMessage(dictionary.selectionFavoritesPartial, { total: chosen.length, ok: outcome.succeeded.length })} ${failedKept(outcome.failed.length)}`, 'error');
      return;
    }
    toast.showNotice(formatMessage(target ? dictionary.selectionFavoritesAdded : dictionary.selectionFavoritesRemoved, { count: selected.length }));
    exit();
  };

  const remove = async (kind: 'delete' | 'leave') => {
    const targets = kind === 'delete' ? plan.deletable : plan.leavable;
    setBusy(true);
    const outcome = await runBatch(
      targets.map(collection => collection.id),
      id => api<void>({ method: 'DELETE', path: kind === 'delete' ? collectionDeletePath(id) : collectionLeavePath(id) }),
    );
    setBusy(false);
    setDialog(null);
    if (outcome.failed.length > 0 && isSessionLost(outcome.firstError)) {
      onSessionLost();
      return;
    }
    if (outcome.succeeded.length > 0) {
      onRemoved(outcome.succeeded);
    }
    setState(current => withoutIds(current, outcome.succeeded));
    if (outcome.succeeded.length === 0) {
      toast.showNotice(dictionary.selectionActionFailed, 'error');
      return;
    }
    if (outcome.failed.length > 0) {
      const partial = kind === 'delete' ? dictionary.selectionCollectionsDeletedPartial : dictionary.selectionCollectionsLeftPartial;
      toast.showNotice(`${formatMessage(partial, { total: targets.length, ok: outcome.succeeded.length })} ${failedKept(outcome.failed.length)}`, 'error');
      return;
    }
    toast.showNotice(formatMessage(kind === 'delete' ? dictionary.selectionCollectionsDeleted : dictionary.selectionCollectionsLeft, { count: outcome.succeeded.length }));
    if (selected.length === outcome.succeeded.length) {
      exit();
    }
  };

  /**
   * 잠금 (mobile runLock): only the chosen Collections that are not locked yet, after a confirmation - the Owner's lock on mine, my own
   * personal lock on one shared with me (both under my lock password). Taking a lock off needs the password: never in bulk.
   */
  const lock = async () => {
    const targets = lockableCollections(selected);
    setBusy(true);
    const outcome = await runBatch(
      targets.map(collection => collection.id),
      id => {
        const collection = targets.find(entry => entry.id === id) as CollectionSummary;
        return api<void>({ method: 'PUT', path: isSharedWithMe(collection) ? collectionSetMemberLockPath(id) : collectionSetLockPath(id), body: {} });
      },
    );
    setBusy(false);
    setDialog(null);
    if (outcome.failed.length > 0 && isSessionLost(outcome.firstError)) {
      onSessionLost();
      return;
    }
    if (outcome.succeeded.length > 0) {
      onLocked(outcome.succeeded);
    }
    const notConfigured = outcome.firstError instanceof ApiHttpError && outcome.firstError.code === 'collectionLockPasswordNotConfigured';
    if (outcome.failed.length === 0) {
      toast.showNotice(formatMessage(dictionary.selectionLocked, { count: outcome.succeeded.length }));
      exit();
      return;
    }
    setState(current => withoutIds(current, outcome.succeeded));
    toast.showNotice(
      notConfigured
        ? dictionary.lockPasswordNotConfigured
        : outcome.succeeded.length === 0
          ? dictionary.selectionActionFailed
          : `${formatMessage(dictionary.selectionLockedPartial, { total: targets.length, ok: outcome.succeeded.length })} ${failedKept(outcome.failed.length)}`,
      'error',
    );
  };

  const actions: SelectionAction[] = [
    {
      key: 'favorite',
      label: plan.favoriteTarget ? dictionary.selectionFavoriteAddAll : dictionary.selectionFavoriteRemoveAll,
      icon: plan.favoriteTarget ? 'Star' : 'StarFilled',
      onClick: () => void setFavorites(),
    },
    ...(lockTargets.length > 0 ? [{ key: 'lock', label: dictionary.selectionLock, icon: 'Lock' as const, onClick: () => setDialog('lock') }] : []),
    ...(plan.leavable.length > 0
      ? [{ key: 'leave', label: formatMessage(dictionary.selectionLeaveCollectionsAction, { count: plan.leavable.length }), icon: 'Logout' as const, destructive: true, onClick: () => setDialog('leave') }]
      : []),
    ...(plan.deletable.length > 0 || plan.lockedSkipped > 0
      ? [
          {
            key: 'delete',
            label: formatMessage(dictionary.selectionDeleteCollectionsAction, { count: plan.deletable.length }),
            icon: 'Trash' as const,
            destructive: true,
            disabled: plan.deletable.length === 0,
            onClick: () => setDialog('delete'),
          },
        ]
      : []),
  ];

  const deleteMessage = [
    plan.sharedAmongDeletable > 0 ? formatMessage(dictionary.selectionDeleteSharedWarning, { count: plan.sharedAmongDeletable }) : null,
    plan.lockedSkipped > 0 ? formatMessage(dictionary.selectionDeleteSkippedLocked, { count: plan.lockedSkipped }) : null,
  ]
    .filter(Boolean)
    .join(' ');

  const ui = (
    <>
      {active ? (
        <SelectionToolbar
          actions={actions}
          busy={busy}
          count={selected.length}
          dictionary={dictionary}
          onExit={exit}
          onSelectAll={() => setState(current => ({ selected: new Set([...current.selected, ...order]), anchor: current.anchor }))}
        />
      ) : null}
{dialog === 'delete' ? (
      <ConfirmDialog
        busy={busy}
        cancelLabel={dictionary.cancel}
        confirmLabel={busy ? dictionary.deleting : dictionary.delete}
        destructive
        message={deleteMessage || undefined}
        onCancel={() => setDialog(null)}
        onConfirm={() => void remove('delete')}
        open={dialog === 'delete'}
        title={formatMessage(dictionary.selectionDeleteCollectionsTitle, { count: plan.deletable.length })}
      />
) : null}
{dialog === 'leave' ? (
      <ConfirmDialog
        busy={busy}
        cancelLabel={dictionary.cancel}
        confirmLabel={busy ? dictionary.processing : dictionary.collectionLeaveAction}
        destructive
        message={formatMessage(dictionary.selectionLeaveCollectionsMessage, { count: plan.leavable.length })}
        onCancel={() => setDialog(null)}
        onConfirm={() => void remove('leave')}
        open={dialog === 'leave'}
        title={formatMessage(dictionary.selectionLeaveCollectionsTitle, { count: plan.leavable.length })}
      />
) : null}
{dialog === 'lock' ? (
      <ConfirmDialog
        busy={busy}
        cancelLabel={dictionary.cancel}
        confirmLabel={busy ? dictionary.processing : dictionary.selectionLock}
        message={[
          formatMessage(dictionary.selectionLockConfirmMessage, { count: lockTargets.length }),
          selected.length - lockTargets.length > 0 ? formatMessage(dictionary.selectionLockConfirmSkipped, { count: selected.length - lockTargets.length }) : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onCancel={() => setDialog(null)}
        onConfirm={() => void lock()}
        open={dialog === 'lock'}
        title={formatMessage(dictionary.selectionLockConfirmTitle, { count: lockTargets.length })}
      />
) : null}
    </>
  );

  return { active, isSelected: (id: number) => state.selected.has(id), check, cardClick, arm: () => setArmed(true), ui };
}
