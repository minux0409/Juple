import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAppToast } from '../components/AppToast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DestinationPickerSheet } from '../collections/DestinationPickerSheet';
import { addItemToCollections } from '../collections/api/collectionsApi';
import { useCollectionDestinationPicker, type PickedDestination } from '../collections/useCollectionDestinationPicker';
import { useItemCollectionChange } from '../collections/useItemCollectionChange';
import { isHandledSubscriptionRefusal } from '../billing/subscriptionRequired';
import { CopyIcon } from '../icons/CopyIcon';
import { EditIcon } from '../icons/EditIcon';
import { ExternalLinkIcon } from '../icons/ExternalLinkIcon';
import { FolderIcon } from '../icons/FolderIcon';
import { MoreIcon } from '../icons/MoreIcon';
import { ShareIcon } from '../icons/ShareIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { closeOpenRow } from '../components/swipeableRowCoordinator';
import type { RowSelection } from '../components/SwipeableItemRow';
import { formatBulkResult } from '../selection/bulkResultMessage';
import { runBatch } from '../selection/runBatch';
import type { SelectionBarModel } from '../selection/SelectionBarContext';
import { SelectionTopBar } from '../selection/SelectionTopBar';
import { useMultiSelect } from '../selection/useMultiSelect';
import { useSelectionChrome } from '../selection/useSelectionChrome';
import { copySavedLinkUrl, systemAnnouncesCopy } from './copyLink';
import { formatLinkList } from './formatLinkList';
import { deleteItem, restoreItem, type ItemHistoryEntry } from './api/itemsApi';
import { shareLinks } from './shareItem';

interface UseSavedLinkSelectionOptions {
  /** The links the screen has loaded, in display order (전체 선택 chooses these; a refresh prunes the selection against them). */
  readonly items: readonly ItemHistoryEntry[];
  /** 수정 / opening one link: the same Item Details a tap opens. */
  readonly onEdit: (item: ItemHistoryEntry) => void;
  /** 링크 열기: the saved original page in the browser. */
  readonly onOpenOriginal: (item: ItemHistoryEntry) => void;
  /** Links were really deleted: the screen drops them from its list and counts. */
  readonly onDeleted: (itemIds: readonly number[]) => void;
  /** The screen re-reads what it shows (after a Collection change or an undo). */
  readonly onChanged: () => void;
  /** The list is loading / refreshing: a temporarily empty list must not end the selection. */
  readonly isLoading?: boolean;
}

/** A card that is not a redacted (locked) one can be chosen. */
export function isSelectableLink(item: Pick<ItemHistoryEntry, 'isCollectionLocked'>): boolean {
  return item.isCollectionLocked !== true;
}

function failureText(error: unknown, t: (key: string) => string): string {
  if (isHandledSubscriptionRefusal(error)) {
    return '';
  }
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('inbox.errorDeleteFallback');
}

/**
 * Multi-selection of saved links for Home and the Archive (they share this so the two never drift): long-press starts it with that
 * link chosen, a tap chooses / un-chooses, the bottom bar offers 컬렉션 변경, 삭제 and 더보기.
 *
 *  - 삭제 deletes the links THEMSELVES (as the swipe / old menu did - recoverable from 최근 삭제한 항목, with an undo), after a
 *    confirmation that names the count. Every link is its own request, a few at a time; a partial failure is reported as such and
 *    the failed links stay selected for a retry.
 *  - 컬렉션 변경 for ONE link is the existing diff editor (add and remove). For several links it ADDS them to the Collections chosen
 *    in the same destination picker used elsewhere - memberships already there stay, nothing is removed in bulk.
 *  - 더보기: one link - 링크 열기, 링크 복사, 수정, 공유; several - 링크 복사 and 공유 as one text (one address per line).
 *  - A redacted (locked-Collection) card is never selectable.
 */
export function useSavedLinkSelection({ items, onEdit, onOpenOriginal, onDeleted, onChanged, isLoading = false }: UseSavedLinkSelectionOptions) {
  const { t } = useTranslation();
  const request = useAuthenticatedApi();
  const { showNotificationToast, showUndoToast } = useAppToast();
  const selection = useMultiSelect<number>();
  const { isActive, selectedIds, enter, toggle, selectAll, clear, exit, prune, replace } = selection;
  const [isBusy, setIsBusy] = useState(false);
  const busyRef = useRef(false);
  const [isDeleteConfirmVisible, setIsDeleteConfirmVisible] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const selectableIds = useMemo(() => items.filter(isSelectableLink).map(item => item.id), [items]);

  // The selection follows the list: a deleted, refreshed-away or paged-out link leaves it; the others stay.
  useEffect(() => {
    prune(new Set(selectableIds), { isLoading });
  }, [isLoading, prune, selectableIds]);

  const selectedItems = useMemo(
    () => items.filter(item => selectedIds.has(item.id)),
    [items, selectedIds],
  );

  const collectionChange = useItemCollectionChange(() => { onChanged(); exit(); });

  // ---- 컬렉션 변경 for several links: add them to the chosen Collections ----
  const targetIdsRef = useRef<readonly number[]>([]);
  const addToCollections = async (destinations: readonly PickedDestination[]) => {
    const ids = targetIdsRef.current;
    const collectionIds = destinations.map(destination => destination.collection.id);
    const unlockTokens: Record<number, string> = {};
    destinations.forEach(destination => {
      if (destination.unlockToken) {
        unlockTokens[destination.collection.id] = destination.unlockToken;
      }
    });
    const outcome = await runBatch(ids, id => addItemToCollections(request, id, collectionIds, unlockTokens));
    if (outcome.succeeded.length === 0 && outcome.failed.length > 0) {
      // Nothing went through: the picker stays open for another try.
      throw outcome.failed[0].error;
    }
    if (outcome.succeeded.length > 0) {
      onChanged();
    }
    if (outcome.failed.length === 0) {
      exit();
      showNotificationToast(t('selection.addedToCollections', { links: ids.length, collections: collectionIds.length }));
    } else {
      replace(outcome.failed.map(entry => entry.id));
      setNotice(formatBulkResult(t, { succeeded: outcome.succeeded.length, failed: outcome.failed.length }, { allKey: 'selection.addedToCollectionsAll', partialKey: 'selection.addedToCollectionsPartial' }));
    }
  };
  const destinationPicker = useCollectionDestinationPicker(request, t, {
    selection: 'multiple',
    onSubmit: addToCollections,
    errorMessage: () => t('collections.replicateError'),
  });

  const startChangeCollection = () => {
    if (selectedItems.length === 1) {
      collectionChange.start(selectedItems[0].id).catch(() => undefined);
      return;
    }
    if (selectedItems.length > 1) {
      targetIdsRef.current = selectedItems.map(item => item.id);
      destinationPicker.open();
    }
  };

  // ---- 삭제 ----
  const runDelete = async () => {
    const targets = selectedItems;
    if (targets.length === 0 || busyRef.current) {
      return;
    }
    busyRef.current = true;
    setIsBusy(true);
    try {
      const outcome = await runBatch(targets.map(item => item.id), id => deleteItem(request, id));
      const deletedIds = outcome.succeeded.map(entry => entry.id);
      if (deletedIds.length > 0) {
        onDeleted(deletedIds);
      }
      if (outcome.failed.length === 0) {
        exit();
        showUndoToast({
          actionLabel: t('toast.undoAction'),
          message: deletedIds.length === 1 ? t('toast.deleteSuccess') : t('selection.deletedLinks', { count: deletedIds.length }),
          noticeTitle: t('common.notice'),
          confirmLabel: t('common.confirm'),
          undoErrorMessage: t('toast.undoDeleteError'),
          onUndo: async () => {
            const restored = await runBatch(deletedIds, id => restoreItem(request, id));
            onChanged();
            if (restored.failed.length > 0) {
              throw restored.failed[0].error;
            }
          },
        });
      } else {
        // What was deleted stays deleted (and can be undone from 최근 삭제한 항목); the rest stays selected for another try.
        replace(outcome.failed.map(entry => entry.id));
        setNotice(
          outcome.succeeded.length === 0
            ? failureText(outcome.failed[0].error, t) || t('inbox.errorDeleteFallback')
            : formatBulkResult(t, { succeeded: outcome.succeeded.length, failed: outcome.failed.length }, { allKey: 'selection.deletedLinks', partialKey: 'selection.deletedPartial' }),
        );
      }
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  };

  // ---- 더보기 ----
  const copySelectedLinks = () => {
    const urls = selectedItems.map(item => item.url);
    if (!copySavedLinkUrl(formatLinkList(urls))) {
      showNotificationToast(t('item.linkCopyFailed'));
    } else if (!systemAnnouncesCopy()) {
      showNotificationToast(t(urls.length === 1 ? 'item.linkCopied' : 'selection.linksCopied', { count: urls.length }));
    }
  };
  const shareSelectedLinks = () => {
    shareLinks(selectedItems.map(item => item.url), selectedItems.length === 1 ? selectedItems[0].title : null).catch(() => setNotice(t('item.shareError')));
  };

  const single = selectedItems.length === 1 ? selectedItems[0] : null;
  const hasSelection = selectedItems.length > 0;

  // Rebuilt every render on purpose: useSelectionBar publishes only what the bar DRAWS and calls the newest handlers.
  const buildBar = (): SelectionBarModel => {
    if (!hasSelection) {
      return {
        actions: [
          { key: 'changeCollection', label: t('collections.changeCollection'), icon: FolderIcon, disabled: true },
          { key: 'delete', label: t('common.delete'), icon: TrashIcon, destructive: true, disabled: true },
        ],
      };
    }
    return {
      actions: [
        { key: 'changeCollection', label: t('collections.changeCollection'), icon: FolderIcon, busy: isBusy, onPress: startChangeCollection },
        { key: 'delete', label: t('common.delete'), icon: TrashIcon, destructive: true, busy: isBusy, onPress: () => setIsDeleteConfirmVisible(true) },
        {
          key: 'more',
          label: t('selection.more'),
          icon: MoreIcon,
          busy: isBusy,
          menu: [
            ...(single ? [{ key: 'open', label: t('item.goToUrlA11y'), icon: ExternalLinkIcon, onPress: () => onOpenOriginal(single) }] : []),
            { key: 'copy', label: single ? t('item.copyLink') : t('selection.copyLinks'), icon: CopyIcon, onPress: copySelectedLinks },
            ...(single ? [{ key: 'edit', label: t('common.edit'), icon: EditIcon, onPress: () => onEdit(single) }] : []),
            { key: 'share', label: single ? t('common.share') : t('selection.shareLinks'), icon: ShareIcon, onPress: shareSelectedLinks },
          ],
        },
      ],
    };
  };
  useSelectionChrome(isActive, exit, isActive ? buildBar() : null);

  // ---- card wiring ----
  const startSelection = useCallback((item: Pick<ItemHistoryEntry, 'id' | 'isCollectionLocked'>) => {
    if (isSelectableLink(item)) {
      closeOpenRow();
      enter(item.id);
    }
  }, [enter]);

  const rowSelection = (item: ItemHistoryEntry): RowSelection | undefined =>
    isActive
      ? { selected: selectedIds.has(item.id), onToggle: () => { if (!busyRef.current && isSelectableLink(item)) { toggle(item.id); } } }
      : undefined;

  const toggleImage = useCallback((item: ItemHistoryEntry) => {
    if (!busyRef.current && isSelectableLink(item)) {
      toggle(item.id);
    }
  }, [toggle]);
  const imageSelection = useMemo(
    () => (isActive ? { isActive, selectedIds, onToggle: toggleImage } : undefined),
    [isActive, selectedIds, toggleImage],
  );

  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selectedIds.has(id));
  const topBar: ReactNode = isActive ? (
    <SelectionTopBar
      allSelected={allSelected}
      canSelectAll={selectableIds.length > 0}
      count={selectedIds.size}
      disabled={isBusy}
      onClear={clear}
      onExit={exit}
      onSelectAll={() => selectAll(selectableIds)}
    />
  ) : null;

  const element = (
    <>
      {collectionChange.element}
      {/* Dialogs exist only while open: a screen full of cards carries no idle Modals. */}
      {destinationPicker.isVisible ? (
        <DestinationPickerSheet
          picker={destinationPicker}
          submitLabel={destinationPicker.selectedIds.size > 0 ? t('selection.addToCollectionsCount', { count: destinationPicker.selectedIds.size }) : t('selection.addToCollections')}
          title={t('selection.addToCollectionsTitle', { count: targetIdsRef.current.length })}
        />
      ) : null}
      {isDeleteConfirmVisible && selectedItems.length > 0 ? (
        <ConfirmDialog
          busy={isBusy}
          cancelLabel={t('common.cancel')}
          confirmLabel={t('common.delete')}
          message={selectedItems.length > 1 ? t('selection.deleteLinksMessage', { count: selectedItems.length }) : t('inbox.deleteConfirmMessage')}
          onCancel={() => setIsDeleteConfirmVisible(false)}
          onConfirm={() => {
            setIsDeleteConfirmVisible(false);
            runDelete().catch(() => undefined);
          }}
          title={selectedItems.length > 1 ? t('selection.deleteLinksTitle', { count: selectedItems.length }) : t('inbox.deleteConfirmTitle')}
          visible
        />
      ) : null}
      {notice !== null ? <ConfirmDialog confirmLabel={t('common.confirm')} destructive={false} message={notice} onConfirm={() => setNotice(null)} title={t('common.notice')} visible /> : null}
    </>
  );

  return { selection, topBar, startSelection, rowSelection, imageSelection, element, isBusy } as const;
}
