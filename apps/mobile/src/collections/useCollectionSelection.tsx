import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { ActionMenuDialog, type ActionMenuDialogAction } from '../components/ActionMenuDialog';
import { useAppToast } from '../components/AppToast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useActionAfterMenu } from '../components/useActionAfterMenu';
import { BellIcon } from '../icons/BellIcon';
import { BellOffIcon } from '../icons/BellOffIcon';
import { CloseIcon } from '../icons/CloseIcon';
import { EditIcon } from '../icons/EditIcon';
import { LockIcon } from '../icons/LockIcon';
import { LogoutIcon } from '../icons/LogoutIcon';
import { MoreIcon } from '../icons/MoreIcon';
import { PlusIcon } from '../icons/PlusIcon';
import { ShareIcon } from '../icons/ShareIcon';
import { StarIcon } from '../icons/StarIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { UnlockIcon } from '../icons/UnlockIcon';
import { formatBulkResult } from '../selection/bulkResultMessage';
import { collectionSelectionLabelKeys } from '../selection/collectionSelectionLabels';
import { favoriteStateOf, getCollectionSelectionActions, lockableCollections, partitionDeleteLeave } from '../selection/collectionSelectionPolicy';
import { runBatch } from '../selection/runBatch';
import type { SelectionBarAction, SelectionBarModel } from '../selection/SelectionBarContext';
import { SelectionTopBar } from '../selection/SelectionTopBar';
import { useMultiSelect } from '../selection/useMultiSelect';
import { useSelectionChrome } from '../selection/useSelectionChrome';
import { collectionShortcutService } from '../shortcuts/CollectionShortcutService';
import { useCollectionShortcutSupport } from '../shortcuts/useCollectionShortcutSupport';
import { leaveCollection } from './api/collaborationApi';
import {
  deleteCollection,
  getCollectionNotificationPreference,
  restoreCollection,
  setCollectionFavorite,
  setCollectionLock,
  setCollectionNotificationPreference,
  setMemberCollectionLock,
  type Collection,
} from './api/collectionsApi';
import { isCollectionLocked } from './collectionAccess';
import { getCollectionCapabilities } from './collectionCapabilities';
import type { CollectionManagementAction } from './collectionManagementAction';

interface UseCollectionSelectionOptions {
  /** The Collections the active list shows (전체 선택 chooses these; a refresh prunes the selection against them). */
  readonly collections: readonly Collection[];
  /** A Collection's favorite mark changed (the server's answer): the screen updates every cached list. */
  readonly onCollectionUpdated: (collection: Collection) => void;
  /** The screen re-reads its lists (after a lock, delete or leave). */
  readonly onChanged: () => void;
  /** One Collection's own screen with one of its dialogs (수정, 공유, 잠금 설정/해제, 삭제, 나가기) - used for a single selection. */
  readonly onManage: (collection: Collection, action: CollectionManagementAction) => void;
  /** The list is loading / refreshing: a temporarily empty list must not end the selection. */
  readonly isLoading?: boolean;
}

type PendingBulk =
  | { readonly kind: 'favoriteChoice' }
  | { readonly kind: 'lock' }
  | { readonly kind: 'deleteLeaveChoice' }
  | { readonly kind: 'delete' }
  | { readonly kind: 'leave' };

const FilledStarIcon = (props: { readonly color?: string; readonly size?: number }) => <StarIcon {...props} filled />;

/**
 * Multi-selection of Collections in the 컬렉션 tab: long-press starts it with that Collection chosen, a tap chooses / un-chooses, and the
 * bottom bar offers 즐겨찾기, 잠금, 바로가기, 삭제/나가기 and (for ONE Collection) 더보기. What each action does to which Collection is
 * decided by selection/collectionSelectionPolicy (never by hiding buttons alone); the server remains the judge of every call.
 *
 *  - 즐겨찾기: all favorites -> remove, none -> add; a mix asks which direction.
 *  - 잠금: ONE Collection uses its own flow (set or remove, with the lock password rules); for several, only Collections that can be locked
 *    and are not yet are locked after a confirmation. Taking a lock off is NEVER done in bulk (it needs the password).
 *  - 바로가기: Android's own Home-icon dialog, one Collection at a time (the system asks per icon); not drawn where the launcher cannot.
 *  - 삭제 / 나가기: deleting (my own Collections) and leaving (someone else's) are separate actions with their own confirmation, never one.
 *    One Collection keeps its own screen's flow (password prompt, undo).
 *  - 더보기 (one Collection): 새 링크 알림, 공유, 수정, 공유 대상에서 제거.
 */
export function useCollectionSelection({ collections, onCollectionUpdated, onChanged, onManage, isLoading = false }: UseCollectionSelectionOptions) {
  const { t } = useTranslation();
  const request = useAuthenticatedApi();
  const { showNotificationToast, showUndoToast } = useAppToast();
  const selection = useMultiSelect<number>();
  const { isActive, selectedIds, enter, toggle, selectAll, clear, exit, prune } = selection;
  const { homePinSupport, refreshHomePinSupport } = useCollectionShortcutSupport();
  const { afterMenuCloses, onMenuDismiss } = useActionAfterMenu();
  const [isBusy, setIsBusy] = useState(false);
  const busyRef = useRef(false);
  const [pending, setPending] = useState<PendingBulk | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const collectionIds = useMemo(() => new Set(collections.map(collection => collection.id)), [collections]);
  useEffect(() => {
    prune(collectionIds, { isLoading });
  }, [collectionIds, isLoading, prune]);

  const selected = useMemo(() => collections.filter(collection => selectedIds.has(collection.id)), [collections, selectedIds]);
  const single = selected.length === 1 ? selected[0] : null;

  // The launcher is asked once when selection starts (Android only; elsewhere it simply answers "not supported").
  useEffect(() => {
    if (isActive) {
      refreshHomePinSupport().catch(() => undefined);
    }
  }, [isActive, refreshHomePinSupport]);

  // ONE selected Collection: its own notification setting (read once for it) and whether it is a share target.
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean | null>(null);
  const [isPinned, setIsPinned] = useState<boolean | null>(null);
  const singleId = single?.id ?? null;
  const singleCanNotify = single ? getCollectionCapabilities(single).canToggleNotification : false;
  useEffect(() => {
    setNotificationsEnabled(null);
    setIsPinned(null);
    if (singleId === null) {
      return undefined;
    }
    let cancelled = false;
    collectionShortcutService.getPinnedCollectionIds()
      .then(ids => { if (!cancelled) { setIsPinned(ids.has(singleId)); } })
      .catch(() => undefined);
    if (singleCanNotify) {
      getCollectionNotificationPreference(request, singleId)
        .then(preference => { if (!cancelled) { setNotificationsEnabled(preference.newItemNotificationsEnabled); } })
        // Without the current setting the row is simply not offered - never a guessed label.
        .catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [request, singleCanNotify, singleId]);

  const guarded = async (work: () => Promise<void>) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setIsBusy(true);
    try {
      await work();
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  };

  // ---- 즐겨찾기 ----
  const applyFavorite = (desired: boolean) => guarded(async () => {
    const targets = selected.filter(collection => collection.isFavorite !== desired);
    if (targets.length === 0) {
      return;
    }
    const outcome = await runBatch(targets.map(collection => collection.id), id => setCollectionFavorite(request, id, desired));
    outcome.succeeded.forEach(entry => onCollectionUpdated(entry.value));
    if (outcome.failed.length === 0) {
      exit();
      showNotificationToast(t(desired ? 'selection.favoritesAdded' : 'selection.favoritesRemoved', { count: outcome.succeeded.length }));
    } else {
      // Failed Collections stay selected so the same action can be retried.
      selection.replace(outcome.failed.map(entry => entry.id));
      setMessage(formatBulkResult(t, { succeeded: outcome.succeeded.length, failed: outcome.failed.length }, { allKey: 'selection.favoritesAdded', partialKey: 'selection.favoritesPartial' }));
    }
  });
  const onFavoritePress = () => {
    const state = favoriteStateOf(selected);
    if (state === 'mixed') {
      setPending({ kind: 'favoriteChoice' });
    } else {
      applyFavorite(state === 'noneFavorite').catch(() => undefined);
    }
  };

  // ---- 잠금 ----
  const runLock = () => guarded(async () => {
    const targets = lockableCollections(selected);
    const outcome = await runBatch(
      targets.map(collection => collection.id),
      async id => {
        const collection = targets.find(entry => entry.id === id);
        if (collection && getCollectionCapabilities(collection).canChangeLock) {
          await setCollectionLock(request, id);
        } else {
          await setMemberCollectionLock(request, id);
        }
      },
    );
    if (outcome.succeeded.length > 0) {
      onChanged();
    }
    const notConfigured = outcome.failed.some(entry => entry.error instanceof ApiError && entry.error.kind === 'conflict' && entry.error.code === 'collectionLockPasswordNotConfigured');
    if (outcome.failed.length === 0) {
      exit();
      showNotificationToast(t('selection.locked', { count: outcome.succeeded.length }));
    } else {
      selection.replace(outcome.failed.map(entry => entry.id));
      setMessage(notConfigured
        ? t('collections.lockPasswordNotConfigured')
        : formatBulkResult(t, { succeeded: outcome.succeeded.length, failed: outcome.failed.length }, { allKey: 'selection.locked', partialKey: 'selection.lockedPartial' }));
    }
  });
  const onLockPress = () => {
    if (single) {
      // ONE Collection: its own flow (set it with a confirmation, or take it off with the lock password).
      onManage(single, 'lock');
      return;
    }
    setPending({ kind: 'lock' });
  };

  // ---- 바로가기 (Android's own dialog, one icon at a time) ----
  const runShortcuts = () => guarded(async () => {
    let requested = 0;
    let stopped: 'limit' | 'unsupported' | null = null;
    let limit = 0;
    for (const collection of selected) {
      try {
        const outcome = await collectionShortcutService.requestHomeShortcut(collection);
        if (outcome.status === 'requested') {
          requested += 1;
        } else if (outcome.status === 'limit') {
          stopped = 'limit';
          limit = outcome.max;
          break;
        } else {
          stopped = 'unsupported';
          break;
        }
      } catch {
        stopped = 'unsupported';
        break;
      }
    }
    if (stopped === 'limit') {
      setMessage(t('collections.shortcutLimitReached', { count: limit }));
    } else if (stopped === 'unsupported') {
      setMessage(t('collections.homeShortcutUnsupported'));
    } else if (selected.some(collection => isCollectionLocked(collection))) {
      setMessage(t('collections.homeShortcutLocked'));
    }
    if (requested > 0 || stopped === null) {
      exit();
    }
  });
  // Only offered for exactly one Collection (the policy hides it otherwise): Android's own dialog creates one icon per request.
  const onShortcutPress = () => {
    runShortcuts().catch(() => undefined);
  };

  // ---- 삭제 / 나가기 ----
  const { deletable, leavable } = partitionDeleteLeave(selected);
  // A locked Collection asks for its password to be deleted (in its own screen) - it is never deleted from here.
  const deletableNow = deletable.filter(collection => !isCollectionLocked(collection));
  const lockedSkipped = deletable.length - deletableNow.length;

  const runDelete = () => guarded(async () => {
    const outcome = await runBatch(deletableNow.map(collection => collection.id), id => deleteCollection(request, id));
    const deletedIds = outcome.succeeded.map(entry => entry.id);
    deletedIds.forEach(id => collectionShortcutService.unpin(id).catch(() => undefined));
    if (deletedIds.length > 0) {
      onChanged();
    }
    if (outcome.failed.length === 0 && lockedSkipped === 0) {
      exit();
    } else {
      selection.replace([...outcome.failed.map(entry => entry.id), ...deletable.filter(collection => isCollectionLocked(collection)).map(collection => collection.id)]);
    }
    if (deletedIds.length > 0) {
      showUndoToast({
        actionLabel: t('toast.undoAction'),
        message: deletedIds.length === 1 ? t('toast.collectionDeleteSuccess') : t('selection.collectionsDeleted', { count: deletedIds.length }),
        noticeTitle: t('common.notice'),
        confirmLabel: t('common.confirm'),
        undoErrorMessage: t('toast.undoCollectionDeleteError'),
        onUndo: async () => {
          const restored = await runBatch(deletedIds, id => restoreCollection(request, id));
          onChanged();
          if (restored.failed.length > 0) {
            throw restored.failed[0].error;
          }
        },
      });
    }
    if (outcome.failed.length > 0 || lockedSkipped > 0) {
      const base = outcome.failed.length > 0
        ? formatBulkResult(t, { succeeded: outcome.succeeded.length, failed: outcome.failed.length, skipped: 0 }, { allKey: 'selection.collectionsDeleted', partialKey: 'selection.collectionsDeletedPartial' })
        : '';
      setMessage([base, lockedSkipped > 0 ? t('selection.deleteSkippedLocked', { count: lockedSkipped }) : ''].filter(Boolean).join(' '));
    }
  });

  const runLeave = () => guarded(async () => {
    const outcome = await runBatch(leavable.map(collection => collection.id), id => leaveCollection(request, id));
    outcome.succeeded.forEach(entry => collectionShortcutService.unpin(entry.id).catch(() => undefined));
    if (outcome.succeeded.length > 0) {
      onChanged();
    }
    if (outcome.failed.length === 0) {
      exit();
      showNotificationToast(t('selection.collectionsLeft', { count: outcome.succeeded.length }));
    } else {
      selection.replace(outcome.failed.map(entry => entry.id));
      setMessage(formatBulkResult(t, { succeeded: outcome.succeeded.length, failed: outcome.failed.length }, { allKey: 'selection.collectionsLeft', partialKey: 'selection.collectionsLeftPartial' }));
    }
  });

  const onDeleteOrLeavePress = () => {
    if (single) {
      // ONE Collection: its own screen's flow (password prompt for a locked one, confirmation, undo).
      onManage(single, getCollectionCapabilities(single).canDelete ? 'delete' : 'leave');
      return;
    }
    if (deletable.length > 0 && leavable.length > 0) {
      setPending({ kind: 'deleteLeaveChoice' });
    } else {
      setPending({ kind: deletable.length > 0 ? 'delete' : 'leave' });
    }
  };

  // ---- the bar ----
  const policy = getCollectionSelectionActions(selected, { shortcutSupported: homePinSupport === 'supported' });
  const keys = collectionSelectionLabelKeys(single, policy.favoriteState, deletable.length, leavable.length);

  const buildBar = (): SelectionBarModel => {
    const actions: SelectionBarAction[] = [];
    const build = (key: string): SelectionBarAction | null => {
      switch (key) {
        case 'favorite':
          return { key, label: t(keys.favorite), icon: policy.favoriteState === 'allFavorite' ? FilledStarIcon : StarIcon, busy: isBusy, onPress: onFavoritePress };
        case 'lock':
          return { key, label: t(keys.lock), icon: keys.lock === 'collections.lockRemoveAction' ? UnlockIcon : LockIcon, busy: isBusy, onPress: onLockPress };
        case 'shortcut':
          return { key, label: t('selection.shortcut'), icon: PlusIcon, busy: isBusy, onPress: onShortcutPress };
        case 'deleteOrLeave':
          return { key, label: t(keys.deleteOrLeave), icon: keys.deleteOrLeave === 'collections.leaveAction' ? LogoutIcon : TrashIcon, destructive: true, busy: isBusy, onPress: onDeleteOrLeavePress };
        case 'more': {
          if (!single) {
            return null;
          }
          const capabilities = getCollectionCapabilities(single);
          return {
            key,
            label: t('selection.more'),
            icon: MoreIcon,
            busy: isBusy,
            menu: [
              ...(capabilities.canToggleNotification && notificationsEnabled !== null
                ? [{
                  key: 'notify',
                  label: notificationsEnabled ? t('collections.newLinkNotificationsTurnOff') : t('collections.newLinkNotificationsTurnOn'),
                  icon: notificationsEnabled ? BellOffIcon : BellIcon,
                  onPress: () => {
                    const next = !notificationsEnabled;
                    setCollectionNotificationPreference(request, single.id, next)
                      .then(() => setNotificationsEnabled(next))
                      .catch(() => showNotificationToast(t('collections.newLinkNotificationsError')));
                  },
                }]
                : []),
              ...(capabilities.canShare ? [{ key: 'share', label: t('collections.shareAction'), icon: ShareIcon, onPress: () => onManage(single, 'share') }] : []),
              ...(capabilities.canEdit ? [{ key: 'edit', label: t('common.edit'), icon: EditIcon, onPress: () => onManage(single, 'edit') }] : []),
              ...(isPinned === true && collectionShortcutService.isSupported()
                ? [{
                  key: 'unpin',
                  label: t('collections.shortcutRemove'),
                  icon: CloseIcon,
                  onPress: () => { collectionShortcutService.unpin(single.id).catch(() => setMessage(t('collections.errorMembershipFallback'))); },
                }]
                : []),
            ],
          };
        }
        default:
          return null;
      }
    };
    policy.bar.forEach(key => {
      const action = build(key);
      if (action) {
        actions.push(action);
      }
    });
    if (actions.length === 0) {
      // Nothing chosen yet: the bar keeps its place with the buttons off, like a gallery.
      actions.push(
        { key: 'favorite', label: t('collections.addFavorite'), icon: StarIcon, disabled: true },
        { key: 'deleteOrLeave', label: t('selection.deleteOrLeave'), icon: TrashIcon, destructive: true, disabled: true },
      );
    }
    return { actions };
  };
  useSelectionChrome(isActive, exit, isActive ? buildBar() : null);

  // ---- card wiring ----
  const startSelection = useCallback((collection: Collection) => { enter(collection.id); }, [enter]);
  const cardSelection = (collection: Collection) =>
    isActive ? { selected: selectedIds.has(collection.id), onToggle: () => { if (!busyRef.current) { toggle(collection.id); } } } : undefined;

  const allSelected = collections.length > 0 && collections.every(collection => selectedIds.has(collection.id));
  const topBar: ReactNode = isActive ? (
    <SelectionTopBar
      allSelected={allSelected}
      canSelectAll={collections.length > 0}
      count={selectedIds.size}
      disabled={isBusy}
      onClear={clear}
      onExit={exit}
      onSelectAll={() => selectAll(collections.map(collection => collection.id))}
    />
  ) : null;

  // ---- dialogs ----
  // The choice menu stays mounted until it has finished closing: on iOS a follow-up dialog (and the chosen action) runs from the Modal's
  // onDismiss, which a Modal that is already unmounted never reports.
  const choiceOpen = pending?.kind === 'favoriteChoice' || pending?.kind === 'deleteLeaveChoice';
  const [isChoiceMounted, setIsChoiceMounted] = useState(false);
  const [lastChoiceKind, setLastChoiceKind] = useState<'favoriteChoice' | 'deleteLeaveChoice'>('favoriteChoice');
  useEffect(() => {
    if (pending?.kind === 'favoriteChoice' || pending?.kind === 'deleteLeaveChoice') {
      setLastChoiceKind(pending.kind);
      setIsChoiceMounted(true);
    }
  }, [pending]);
  const closePending = () => {
    setPending(null);
    if (Platform.OS !== 'ios') {
      setIsChoiceMounted(false);
    }
  };
  const choiceActions: ActionMenuDialogAction[] =
    lastChoiceKind === 'favoriteChoice'
      ? [
        { label: t('selection.favoriteAddAll'), icon: FilledStarIcon, onPress: () => afterMenuCloses(closePending, () => { applyFavorite(true).catch(() => undefined); }) },
        { label: t('selection.favoriteRemoveAll'), icon: StarIcon, onPress: () => afterMenuCloses(closePending, () => { applyFavorite(false).catch(() => undefined); }) },
      ]
      : lastChoiceKind === 'deleteLeaveChoice'
        ? [
          { label: t('selection.deleteCollectionsAction', { count: deletable.length }), destructive: true, icon: TrashIcon, onPress: () => afterMenuCloses(closePending, () => setPending({ kind: 'delete' })) },
          { label: t('selection.leaveCollectionsAction', { count: leavable.length }), destructive: true, icon: LogoutIcon, onPress: () => afterMenuCloses(closePending, () => setPending({ kind: 'leave' })) },
        ]
        : [];

  const sharedDeletedCount = deletableNow.filter(collection => collection.hasCollaborators === true || collection.isPublicShareActive === true).length;
  const lockTargets = lockableCollections(selected);

  const element = (
    <>
      {/* Dialogs exist only while open: a screen full of cards carries no idle Modals. */}
      {isChoiceMounted ? (
        <ActionMenuDialog
          actions={choiceActions}
          cancelLabel={t('common.cancel')}
          onCancel={closePending}
          onDismiss={() => { setIsChoiceMounted(false); onMenuDismiss(); }}
          title={lastChoiceKind === 'favoriteChoice' ? t('selection.favoriteMixedTitle') : t('selection.deleteLeaveTitle')}
          visible={choiceOpen}
        />
      ) : null}
      {pending?.kind === 'lock' ? (
        <ConfirmDialog
          busy={isBusy}
          cancelLabel={t('common.cancel')}
          confirmLabel={t('collections.lockSetTitle')}
          destructive={false}
          message={[
            t('selection.lockConfirmMessage', { count: lockTargets.length }),
            selected.length - lockTargets.length > 0 ? t('selection.lockConfirmSkipped', { count: selected.length - lockTargets.length }) : '',
          ].filter(Boolean).join(' ')}
          onCancel={closePending}
          onConfirm={() => { closePending(); runLock().catch(() => undefined); }}
          title={t('selection.lockConfirmTitle', { count: lockTargets.length })}
          visible
        />
      ) : null}
      {pending?.kind === 'delete' && deletableNow.length > 0 ? (
        <ConfirmDialog
          busy={isBusy}
          cancelLabel={t('common.cancel')}
          confirmLabel={t('common.delete')}
          message={[
            t('collections.deleteConfirmMessage'),
            sharedDeletedCount > 0 ? t('selection.deleteSharedWarning', { count: sharedDeletedCount }) : '',
            lockedSkipped > 0 ? t('selection.deleteSkippedLocked', { count: lockedSkipped }) : '',
          ].filter(Boolean).join(' ')}
          onCancel={closePending}
          onConfirm={() => { closePending(); runDelete().catch(() => undefined); }}
          title={t('selection.deleteCollectionsTitle', { count: deletableNow.length })}
          visible
        />
      ) : null}
      {pending?.kind === 'leave' && leavable.length > 0 ? (
        <ConfirmDialog
          busy={isBusy}
          cancelLabel={t('common.cancel')}
          confirmLabel={t('collections.leaveConfirmButton')}
          message={t('selection.leaveCollectionsMessage', { count: leavable.length })}
          onCancel={closePending}
          onConfirm={() => { closePending(); runLeave().catch(() => undefined); }}
          title={t('selection.leaveCollectionsTitle', { count: leavable.length })}
          visible
        />
      ) : null}
      {message !== null ? <ConfirmDialog confirmLabel={t('common.confirm')} destructive={false} message={message} onConfirm={() => setMessage(null)} title={t('common.notice')} visible /> : null}
    </>
  );

  return { selection, topBar, startSelection, cardSelection, element, isBusy } as const;
}
