import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAppToast } from '../components/AppToast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { RowSelection } from '../components/SwipeableItemRow';
import { closeOpenRow } from '../components/swipeableRowCoordinator';
import { CopyIcon } from '../icons/CopyIcon';
import { EditIcon } from '../icons/EditIcon';
import { ExternalLinkIcon } from '../icons/ExternalLinkIcon';
import { FlagIcon } from '../icons/FlagIcon';
import { MoreIcon } from '../icons/MoreIcon';
import { MoveIcon } from '../icons/MoveIcon';
import { ShareIcon } from '../icons/ShareIcon';
import { SmileyPlusIcon } from '../icons/SmileyPlusIcon';
import { ArchiveIcon } from '../icons/ArchiveIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { copySavedLinkUrl, systemAnnouncesCopy } from '../items/copyLink';
import { formatLinkList } from '../items/formatLinkList';
import { shareLinks } from '../items/shareItem';
import type { ItemHistoryEntry } from '../items/api/itemsApi';
import { ReportModal, type BulkReportOutcome } from '../safety/ReportModal';
import { blockedInteractionKey, type ReportTarget } from '../safety/safetyApi';
import { formatBulkResult } from '../selection/bulkResultMessage';
import {
  deleteTargets,
  getLinkSelectionActions,
  moveTargets,
  type LinkBarActionKey,
  type LinkSelectionScope,
  type SelectedLink,
} from '../selection/linkSelectionPolicy';
import { runBatch } from '../selection/runBatch';
import type { SelectionBarAction, SelectionBarModel, SelectionMenuRow } from '../selection/SelectionBarContext';
import { SelectionTopBar } from '../selection/SelectionTopBar';
import { useMultiSelect } from '../selection/useMultiSelect';
import { useSelectionChrome } from '../selection/useSelectionChrome';
import { DestinationPickerSheet } from './DestinationPickerSheet';
import {
  addItemToCollection,
  addItemToCollections,
  copyCollectionItems,
  getCollectionItems,
  MAX_ITEMS_PER_COPY,
  removeItemFromCollection,
  transferCollectionItem,
  undoTransferCollectionItem,
  type Collection,
  type CollectionItemEntry,
} from './api/collectionsApi';
import { isCollaborative } from './collectionAccess';
import { getCollectionUnlockToken } from './collectionUnlockGrants';
import { contentGateOfError, getCollectionItemsErrorMessage } from './useCollectionItems';
import { useCollectionDestinationPicker, type PickedDestination } from './useCollectionDestinationPicker';

/** 전체 선택 reads the Collection with the item API's largest page. */
const SELECT_ALL_PAGE_SIZE = 100;

type PickerMode = 'copy' | 'move';

interface UseCollectionLinkSelectionOptions {
  readonly collectionId: number;
  readonly collection: Collection | null;
  readonly isOwner: boolean;
  /** The content is behind a lock / share password: nothing can be selected. */
  readonly isContentLocked: boolean;
  /** The links are loading / refreshing: a temporarily empty list must not end the selection. */
  readonly isLoading?: boolean;
  /** Reactions exist (a Collection other people are in). */
  readonly reactionsEnabled: boolean;
  /** Every link the screen has loaded (the list, or a search's results), in display order. */
  readonly loadedItems: readonly CollectionItemEntry[];
  /** Links really left this Collection: the screen drops them from its lists and counts. */
  readonly onRemoved: (itemIds: readonly number[]) => void;
  /** The screen re-reads the Collection and its links. */
  readonly onChanged: () => void;
  readonly onOpenOriginal: (url: string) => void;
  /** 수정 of my own link: the same Item Details a tap opens. */
  readonly onEditOwn: (item: CollectionItemEntry) => void;
  /** 링크 저장 of another person's link: the ordinary save screen with the address and title filled in. */
  readonly onSaveOther: (item: CollectionItemEntry) => void;
  /** The emoji picker for one link. */
  readonly onReact: (item: CollectionItemEntry) => void;
  /** An error the screen shows in its own notice dialog. */
  readonly onNotice: (message: string) => void;
}

function scopeOf(collection: Collection | null, isOwner: boolean): LinkSelectionScope {
  if (!isOwner) {
    return 'foreignSharedCollection';
  }
  return collection && isCollaborative(collection) ? 'ownedSharedCollection' : 'personalCollection';
}

/**
 * Multi-selection of the links INSIDE one Collection (personal, shared and mine, shared and someone else's). The set of bottom-bar
 * actions, and the links each action may touch, come from selection/linkSelectionPolicy - never from hiding buttons alone:
 *  - 삭제 removes the link from THIS Collection only (the saved link itself is never deleted); the Owner may remove any link, a member
 *    only their own. 이동 moves only links I added - another person's link is never moved or removed by it, and a mixed selection
 *    says how many will move and how many will not before it does anything.
 *  - 복사: my own links join the chosen Collections of mine as themselves (the existing 복제); another person's links become my own
 *    new links (the existing 내 컬렉션으로 복사) - the source Collection keeps everything.
 *  - 신고: each selected link of another person is its OWN report (same reason and explanation, one request each); nothing is deleted
 *    or blocked by reporting.
 * Every call is one request per link, a few at a time; each link's result is kept apart, a partial success is reported as one, and the
 * links that failed stay selected for another try. The server still enforces ownership, locks and roles on every request.
 */
export function useCollectionLinkSelection(options: UseCollectionLinkSelectionOptions) {
  const {
    collectionId, collection, isOwner, isContentLocked, isLoading = false, reactionsEnabled, loadedItems,
    onRemoved, onChanged, onOpenOriginal, onEditOwn, onSaveOther, onReact, onNotice,
  } = options;
  const { t } = useTranslation();
  const request = useAuthenticatedApi();
  const { showNotificationToast, showUndoToast } = useAppToast();
  const selection = useMultiSelect<number>();
  const { isActive, selectedIds, enter, toggle, selectAll, clear, exit, prune, replace } = selection;
  const [isBusy, setIsBusy] = useState(false);
  const busyRef = useRef(false);
  const [isSelectingAll, setIsSelectingAll] = useState(false);
  const [dialog, setDialog] = useState<'delete' | 'move' | null>(null);
  const [isReporting, setIsReporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Links the server's pages gave 전체 선택 that this screen has not loaded - their author is needed to decide the actions.
  const [fetchedEntries, setFetchedEntries] = useState<ReadonlyMap<number, CollectionItemEntry>>(new Map());

  const scope = scopeOf(collection, isOwner);

  const knownEntries = useMemo(() => {
    const map = new Map<number, CollectionItemEntry>(fetchedEntries);
    loadedItems.forEach(entry => map.set(entry.itemId, entry));
    return map;
  }, [fetchedEntries, loadedItems]);
  const knownIds = useMemo(() => new Set(knownEntries.keys()), [knownEntries]);
  useEffect(() => {
    prune(knownIds, { isLoading });
  }, [isLoading, knownIds, prune]);
  useEffect(() => {
    if (!isActive) {
      setFetchedEntries(previous => (previous.size === 0 ? previous : new Map()));
    }
  }, [isActive]);
  // Content that turned out to be locked (a lock set meanwhile) cannot stay selected.
  useEffect(() => {
    if (isContentLocked && isActive) {
      exit();
    }
  }, [exit, isActive, isContentLocked]);

  // In the order the links are shown (the screen's loaded order first), never the order they were tapped.
  const selectedEntries = useMemo(() => {
    const ordered = new Map<number, CollectionItemEntry>();
    loadedItems.forEach(entry => ordered.set(entry.itemId, entry));
    fetchedEntries.forEach(entry => { if (!ordered.has(entry.itemId)) { ordered.set(entry.itemId, entry); } });
    return [...ordered.values()].filter(entry => selectedIds.has(entry.itemId));
  }, [fetchedEntries, loadedItems, selectedIds]);
  const selectedLinks = useMemo<readonly SelectedLink[]>(
    () => selectedEntries.map(entry => ({ id: entry.itemId, isMine: entry.isMine !== false })),
    [selectedEntries],
  );
  const entryOf = (id: number): CollectionItemEntry | undefined => knownEntries.get(id);
  const hasSelection = selectedEntries.length > 0;
  const single = selectedEntries.length === 1 ? selectedEntries[0] : null;
  const actions = getLinkSelectionActions({ scope, selected: selectedLinks }, hasSelection);
  const { mine, others } = actions.partition;

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

  const failureNotice = (error: unknown): string => {
    const gate = contentGateOfError(error);
    if (gate !== null) {
      return t(gate === 'sharePassword' ? 'collections.sharePasswordRequiredForAction' : 'collections.lockRequiredForAction');
    }
    const blocked = blockedInteractionKey(error);
    if (blocked) {
      return t(blocked);
    }
    if (error instanceof ApiError && error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
    return t('selection.actionFailed');
  };

  // ---- 삭제 (= 이 컬렉션에서 제거) ----
  const runDelete = () => guarded(async () => {
    // Re-decided from the CURRENT selection right before running: another person's link is never removed by a member.
    const targets = deleteTargets(scope, selectedLinks);
    if (targets.length === 0) {
      return;
    }
    const removable = targets.map(link => link.id);
    const outcome = await runBatch(removable, id => removeItemFromCollection(request, collectionId, id));
    const removedIds = outcome.succeeded.map(entry => entry.id);
    if (removedIds.length > 0) {
      onRemoved(removedIds);
    }
    if (outcome.failed.length === 0) {
      exit();
    } else {
      replace(outcome.failed.map(entry => entry.id));
      setNotice(formatBulkResult(t, { succeeded: outcome.succeeded.length, failed: outcome.failed.length }, { allKey: 'selection.removedLinks', partialKey: 'selection.removedLinksPartial' }));
    }
    if (removedIds.length === 0) {
      if (outcome.failed.length > 0) {
        setNotice(failureNotice(outcome.failed[0].error));
      }
      return;
    }
    // Undo puts links back through the normal add, which only works for links I added myself: no undo is offered otherwise.
    const allMine = removedIds.every(id => entryOf(id)?.isMine !== false);
    const canUndo = allMine && (isOwner || collection?.accessRole === 'contributor');
    const message = removedIds.length === 1 ? t('toast.unlinkSuccess') : t('selection.removedLinks', { count: removedIds.length });
    if (canUndo && outcome.failed.length === 0) {
      showUndoToast({
        actionLabel: t('toast.undoAction'),
        message,
        noticeTitle: t('common.notice'),
        confirmLabel: t('common.confirm'),
        undoErrorMessage: t('toast.undoUnlinkError'),
        onUndo: async () => {
          const restored = await runBatch(removedIds, id => addItemToCollection(request, collectionId, id));
          onChanged();
          if (restored.failed.length > 0) {
            throw restored.failed[0].error;
          }
        },
      });
    } else if (outcome.failed.length === 0) {
      showNotificationToast(message);
    }
  });

  // ---- 이동 / 복사 ----
  const [pickerMode, setPickerMode] = useState<PickerMode>('copy');
  const pickerModeRef = useRef<PickerMode>('copy');
  const pickerTargetsRef = useRef<{ readonly mine: readonly number[]; readonly others: readonly number[] }>({ mine: [], others: [] });

  /** Returns the server-created flag of an atomic move (what its undo needs), or null when the two permitted steps were composed. */
  const moveOne = async (itemId: number, destination: PickedDestination): Promise<boolean | null> => {
    const target = destination.collection;
    const canTransferAtomically = isOwner && collection?.hasCollaborators !== true && target.hasCollaborators !== true;
    if (canTransferAtomically) {
      try {
        const moved = await transferCollectionItem(request, collectionId, itemId, target.id, destination.unlockToken);
        return moved.targetMembershipCreated;
      } catch (caughtError) {
        // Someone with a still-pending invitation also makes the server refuse the atomic move: compose the two permitted steps.
        if (!(caughtError instanceof ApiError && caughtError.kind === 'conflict' && caughtError.code === 'collaborationActive')) {
          throw caughtError;
        }
      }
    }
    // A failure between the two steps leaves the link in both Collections, never in neither.
    const added = await addItemToCollection(request, target.id, itemId, { unlockToken: destination.unlockToken });
    if (added !== 'added') {
      // A proposal only waits for approval: the link must not leave here before it really joined the destination.
      throw new ApiError('conflict');
    }
    await removeItemFromCollection(request, collectionId, itemId);
    return null;
  };

  const runMove = async (destinations: readonly PickedDestination[]) => {
    const ids = pickerTargetsRef.current.mine;
    const target = destinations[0];
    if (ids.length === 0) {
      return;
    }
    const outcome = await runBatch(ids, id => moveOne(id, target));
    if (outcome.succeeded.length === 0 && outcome.failed.length > 0) {
      throw outcome.failed[0].error;
    }
    const movedIds = outcome.succeeded.map(entry => entry.id);
    onRemoved(movedIds);
    // Only an atomic move can be undone (it has a server-side undo); a composed add + remove has none.
    const atomic = outcome.succeeded.filter(entry => entry.value !== null);
    if (outcome.failed.length === 0) {
      exit();
      const message = movedIds.length === 1 ? t('toast.moveSuccess') : t('selection.movedLinks', { count: movedIds.length });
      if (atomic.length === movedIds.length) {
        showUndoToast({
          actionLabel: t('toast.undoAction'),
          message,
          noticeTitle: t('common.notice'),
          confirmLabel: t('common.confirm'),
          undoErrorMessage: t('toast.undoMoveError'),
          onUndo: async () => {
            const undone = await runBatch(atomic.map(entry => entry.id), id => undoTransferCollectionItem(request, collectionId, id, target.collection.id, atomic.find(entry => entry.id === id)?.value === true));
            onChanged();
            if (undone.failed.length > 0) {
              throw undone.failed[0].error;
            }
          },
        });
      } else {
        showNotificationToast(message);
      }
    } else {
      replace(outcome.failed.map(entry => entry.id));
      setNotice(formatBulkResult(t, { succeeded: movedIds.length, failed: outcome.failed.length }, { allKey: 'selection.movedLinks', partialKey: 'selection.movedLinksPartial' }));
    }
  };

  const runCopy = async (destinations: readonly PickedDestination[]) => {
    const { mine: mineIds, others: otherIds } = pickerTargetsRef.current;
    const destinationIds = destinations.map(destination => destination.collection.id);
    const unlockTokens: Record<number, string> = {};
    destinations.forEach(destination => {
      if (destination.unlockToken) {
        unlockTokens[destination.collection.id] = destination.unlockToken;
      }
    });
    const failedIds = new Set<number>();
    let succeededLinks = 0;
    let skipped = 0;
    let firstError: unknown = null;
    let attempted = 0;

    // My own links: they join the chosen Collections as themselves (never a duplicate of the link).
    if (mineIds.length > 0) {
      attempted += mineIds.length;
      const outcome = await runBatch(mineIds, id => addItemToCollections(request, id, destinationIds, unlockTokens));
      outcome.succeeded.forEach(entry => {
        succeededLinks += 1;
        if (entry.value.addedCount === 0) {
          skipped += 1;
        }
      });
      outcome.failed.forEach(entry => {
        failedIds.add(entry.id);
        firstError ??= entry.error;
      });
    }

    // Another person's links: my own new links in each chosen Collection (the server copies only what is shared).
    if (otherIds.length > 0) {
      attempted += otherIds.length;
      const chunks: number[][] = [];
      for (let index = 0; index < otherIds.length; index += MAX_ITEMS_PER_COPY) {
        chunks.push(otherIds.slice(index, index + MAX_ITEMS_PER_COPY));
      }
      const jobs = chunks.flatMap(chunk => destinations.map(destination => ({ chunk, destination })));
      const results = await runBatch(
        jobs.map((_, index) => index),
        index => copyCollectionItems(request, collectionId, jobs[index].chunk, jobs[index].destination.collection.id, jobs[index].destination.unlockToken),
      );
      const failedJobs = new Set(results.failed.map(entry => entry.id));
      results.failed.forEach(entry => { firstError ??= entry.error; });
      otherIds.forEach(id => {
        const jobIndexes = jobs.map((job, index) => (job.chunk.includes(id) ? index : -1)).filter(index => index >= 0);
        if (jobIndexes.length > 0 && jobIndexes.every(index => failedJobs.has(index))) {
          failedIds.add(id);
        } else {
          succeededLinks += 1;
        }
      });
      results.succeeded.forEach(entry => { skipped += entry.value.skippedCount; });
    }

    if (failedIds.size >= attempted && attempted > 0) {
      // Nothing went through: the picker stays open for another try.
      throw firstError ?? new ApiError('unavailable');
    }
    onChanged();
    if (failedIds.size === 0) {
      exit();
      showNotificationToast(
        skipped > 0
          ? t('selection.copiedWithSkipped', { links: succeededLinks, collections: destinationIds.length, skipped })
          : t('selection.copiedLinks', { links: succeededLinks, collections: destinationIds.length }),
      );
    } else {
      replace([...failedIds]);
      setNotice(formatBulkResult(t, { succeeded: succeededLinks, failed: failedIds.size, skipped }, { allKey: 'selection.copiedLinksAll', partialKey: 'selection.copiedLinksPartial' }));
    }
  };

  const destinationPicker = useCollectionDestinationPicker(request, t, {
    selection: pickerMode === 'move' ? 'single' : 'multiple',
    onSubmit: async destinations => {
      if (pickerModeRef.current === 'move') {
        await runMove(destinations);
      } else {
        await runCopy(destinations);
      }
    },
    errorMessage: caughtError => {
      if (caughtError instanceof ApiError && caughtError.code === 'collectionLocked') {
        // A grant expired between choosing and the action - choosing that Collection again asks for its password.
        return t('collections.lockRequiredForAction');
      }
      const gate = contentGateOfError(caughtError);
      if (gate !== null) {
        return t(gate === 'sharePassword' ? 'collections.sharePasswordRequiredForAction' : 'collections.lockRequiredForAction');
      }
      const blocked = blockedInteractionKey(caughtError);
      if (blocked) {
        return t(blocked);
      }
      return pickerModeRef.current === 'move' ? t('collections.moveError') : t('collections.copyError');
    },
  });

  const openPicker = (mode: PickerMode) => {
    const links = actions.partition;
    pickerModeRef.current = mode;
    setPickerMode(mode);
    pickerTargetsRef.current = mode === 'move'
      ? { mine: moveTargets(selectedLinks).map(link => link.id), others: [] }
      : { mine: links.mine.map(link => link.id), others: links.others.map(link => link.id) };
    destinationPicker.open(mode === 'move' ? { disabledIds: [collectionId] } : undefined);
  };
  const onMovePress = () => {
    if (others.length > 0) {
      // Say what will and will not move BEFORE anything happens.
      setDialog('move');
    } else {
      openPicker('move');
    }
  };

  // ---- 신고: one report per link ----
  const reportTargets: readonly ReportTarget[] = others.map(link => ({ type: 'Item', itemId: link.id, collectionId }));
  const onReported = (outcome: BulkReportOutcome) => {
    setIsReporting(false);
    const failedIds = outcome.failed.map(target => (target.type === 'Item' ? target.itemId : -1)).filter(id => id >= 0);
    const received = outcome.received.length;
    const already = outcome.alreadyReported.length;
    const lines = [t('selection.reportReceived', { count: received + already })];
    if (already > 0) {
      lines.push(t('selection.reportAlready', { count: already }));
    }
    if (failedIds.length > 0) {
      lines.push(outcome.rateLimited ? t('selection.reportLimit') : t('selection.reportFailed', { count: failedIds.length }));
      replace(failedIds);
      setNotice(lines.join(' '));
    } else {
      exit();
      showNotificationToast(lines.join(' '));
    }
  };

  // ---- 더보기 ----
  const copyLinkUrls = () => {
    const urls = selectedEntries.map(entry => entry.url);
    if (!copySavedLinkUrl(formatLinkList(urls))) {
      showNotificationToast(t('item.linkCopyFailed'));
    } else if (!systemAnnouncesCopy()) {
      showNotificationToast(t(urls.length === 1 ? 'item.linkCopied' : 'selection.linksCopied', { count: urls.length }));
    }
  };
  const shareLinkUrls = () => {
    shareLinks(selectedEntries.map(entry => entry.url), single?.title ?? null).catch(() => setNotice(t('item.shareError')));
  };

  const moreRows = (): SelectionMenuRow[] => {
    const rows: SelectionMenuRow[] = [];
    if (single) {
      rows.push({ key: 'open', label: t('item.goToUrlA11y'), icon: ExternalLinkIcon, onPress: () => onOpenOriginal(single.url) });
    }
    rows.push({ key: 'copyLinks', label: single ? t('item.copyLink') : t('selection.copyLinks'), icon: CopyIcon, onPress: copyLinkUrls });
    if (single) {
      if (single.isMine === false) {
        rows.push({ key: 'save', label: t('item.saveDialogTitle'), icon: ArchiveIcon, onPress: () => onSaveOther(single) });
      } else {
        rows.push({ key: 'edit', label: t('common.edit'), icon: EditIcon, onPress: () => onEditOwn(single) });
      }
      if (reactionsEnabled) {
        rows.push({ key: 'react', label: t('selection.react'), icon: SmileyPlusIcon, onPress: () => onReact(single) });
      }
    }
    rows.push({ key: 'shareLinks', label: single ? t('common.share') : t('selection.shareLinks'), icon: ShareIcon, onPress: shareLinkUrls });
    if (actions.moveInMore) {
      rows.push({ key: 'move', label: t('selection.moveToCollection'), icon: MoveIcon, onPress: onMovePress });
    }
    if (actions.reportInMore) {
      rows.push({ key: 'reportOthers', label: t('selection.reportOthers', { count: others.length }), icon: FlagIcon, destructive: true, onPress: () => setIsReporting(true) });
    }
    return rows;
  };

  const buildBar = (): SelectionBarModel => {
    const bar: SelectionBarAction[] = [];
    const push = (key: LinkBarActionKey) => {
      switch (key) {
        case 'delete':
          bar.push({ key, label: t('common.delete'), icon: TrashIcon, destructive: true, busy: isBusy, onPress: () => setDialog('delete') });
          break;
        case 'move':
          bar.push({ key, label: t('selection.moveToCollection'), icon: MoveIcon, busy: isBusy, onPress: onMovePress });
          break;
        case 'copy':
          bar.push({ key, label: t('selection.copyToCollection'), icon: CopyIcon, busy: isBusy, onPress: () => openPicker('copy') });
          break;
        case 'report':
          bar.push({ key, label: t('selection.report'), icon: FlagIcon, destructive: true, busy: isBusy, onPress: () => setIsReporting(true) });
          break;
        case 'more':
          bar.push({ key, label: t('selection.more'), icon: MoreIcon, busy: isBusy, menu: moreRows() });
          break;
        default:
          break;
      }
    };
    if (!hasSelection) {
      // Nothing chosen yet: the bar keeps its place with the buttons off, like a gallery.
      const idle: LinkBarActionKey[] = scope === 'foreignSharedCollection' ? ['copy'] : ['delete', 'move', 'copy'];
      idle.forEach(key => push(key));
      return { actions: bar.map(action => ({ ...action, disabled: true, onPress: undefined })) };
    }
    actions.bar.forEach(push);
    return { actions: bar };
  };
  useSelectionChrome(isActive && !isContentLocked, exit, isActive && !isContentLocked ? buildBar() : null);

  // ---- 전체 선택: every link of this Collection the server lists (up to the copy limit), read page by page ----
  const selectEverything = async (visibleIds: readonly number[]) => {
    if (isSelectingAll) {
      return;
    }
    setIsSelectingAll(true);
    try {
      const entries = new Map<number, CollectionItemEntry>();
      let cursor: string | undefined;
      do {
        const page = await getCollectionItems(request, collectionId, {
          limit: SELECT_ALL_PAGE_SIZE,
          cursor,
          sort: 'dateDesc',
          unlockToken: getCollectionUnlockToken(collectionId),
        });
        page.items.forEach(entry => entries.set(entry.itemId, entry));
        cursor = page.nextCursor ?? undefined;
      } while (cursor && entries.size < MAX_ITEMS_PER_COPY);
      const chosen = [...entries.keys()].slice(0, MAX_ITEMS_PER_COPY);
      setFetchedEntries(entries);
      selectAll(chosen.length > 0 ? chosen : visibleIds);
      if (cursor || entries.size > MAX_ITEMS_PER_COPY) {
        showNotificationToast(t('collections.copySelectionLimit', { max: MAX_ITEMS_PER_COPY }));
      }
    } catch (caughtError) {
      onNotice(getCollectionItemsErrorMessage(caughtError, t));
    } finally {
      setIsSelectingAll(false);
    }
  };

  // ---- card wiring ----
  const startSelection = useCallback((entry: CollectionItemEntry) => {
    if (!isContentLocked) {
      closeOpenRow();
      enter(entry.itemId);
    }
  }, [enter, isContentLocked]);
  /** Selection with nothing chosen yet (the Collection menu's 내 컬렉션으로 복사). */
  const begin = useCallback(() => {
    if (!isContentLocked) {
      selection.begin();
    }
  }, [isContentLocked, selection]);

  const rowSelection = (entry: CollectionItemEntry): RowSelection | undefined =>
    isActive ? { selected: selectedIds.has(entry.itemId), onToggle: () => { if (!busyRef.current) { toggle(entry.itemId); } } } : undefined;
  const toggleImage = useCallback((item: ItemHistoryEntry) => {
    if (!busyRef.current) {
      toggle(item.id);
    }
  }, [toggle]);
  const imageSelection = useMemo(
    () => (isActive ? { isActive, selectedIds, onToggle: toggleImage } : undefined),
    [isActive, selectedIds, toggleImage],
  );

  const allSelected = loadedItems.length > 0 && loadedItems.every(entry => selectedIds.has(entry.itemId)) && (collection?.itemCount ?? 0) <= loadedItems.length;
  const topBar: ReactNode = isActive && !isContentLocked ? (
    <SelectionTopBar
      allSelected={allSelected}
      canSelectAll={loadedItems.length > 0}
      count={selectedIds.size}
      disabled={isBusy}
      isSelectingAll={isSelectingAll}
      onClear={clear}
      onExit={exit}
      onSelectAll={() => { selectEverything(loadedItems.map(entry => entry.itemId)).catch(() => undefined); }}
    />
  ) : null;

  const removable = deleteTargets(scope, selectedLinks);
  const keptCount = selectedLinks.length - removable.length;
  const deleteMessage = [
    t('collections.unlinkConfirmMessage'),
    scope !== 'personalCollection' && others.length > 0 && removable.length > 0 ? t('selection.removeOthersNote', { count: others.length }) : '',
    keptCount > 0 ? t('selection.removeKeptNote', { count: keptCount }) : '',
  ].filter(Boolean).join(' ');

  const element = (
    <>
      {destinationPicker.isVisible ? (
      <DestinationPickerSheet
        picker={destinationPicker}
        submitLabel={pickerMode === 'move'
          ? t('selection.moveToCollection')
          : destinationPicker.selectedIds.size > 0
            ? t('selection.copyToCount', { count: destinationPicker.selectedIds.size })
            : t('selection.copyToCollection')}
        title={pickerMode === 'move' ? t('selection.moveTitle', { count: pickerTargetsRef.current.mine.length }) : t('selection.copyTitle', { count: selectedLinks.length })}
      />
      ) : null}
      {dialog === 'delete' && removable.length > 0 ? (
        <ConfirmDialog
          busy={isBusy}
          cancelLabel={t('common.cancel')}
          confirmLabel={t('common.delete')}
          message={deleteMessage}
          onCancel={() => setDialog(null)}
          onConfirm={() => { setDialog(null); runDelete().catch(() => undefined); }}
          title={t('selection.removeLinksTitle', { count: removable.length })}
          visible
        />
      ) : null}
      {dialog === 'move' && mine.length > 0 ? (
        <ConfirmDialog
          cancelLabel={t('common.cancel')}
          confirmLabel={t('selection.moveContinue')}
          destructive={false}
          message={t('selection.moveMixedMessage', { mine: mine.length, others: others.length })}
          onCancel={() => setDialog(null)}
          onConfirm={() => { setDialog(null); openPicker('move'); }}
          title={t('selection.moveMixedTitle')}
          visible
        />
      ) : null}
      {dialog === 'move' && mine.length === 0 ? (
        <ConfirmDialog
          confirmLabel={t('common.confirm')}
          destructive={false}
          message={t('selection.moveNothingMessage')}
          onConfirm={() => setDialog(null)}
          title={t('common.notice')}
          visible
        />
      ) : null}
      {isReporting && reportTargets.length > 0 ? (
        <ReportModal
          bulkTargets={reportTargets}
          onBulkReported={onReported}
          onClose={() => setIsReporting(false)}
          onReported={() => setIsReporting(false)}
          target={reportTargets[0]}
          targetLabel={reportTargets.length === 1 ? (entryOf(reportTargets[0].type === 'Item' ? reportTargets[0].itemId : -1)?.title ?? undefined) : t('selection.reportLinksCount', { count: reportTargets.length })}
        />
      ) : null}
      {notice !== null ? <ConfirmDialog confirmLabel={t('common.confirm')} destructive={false} message={notice} onConfirm={() => setNotice(null)} title={t('common.notice')} visible /> : null}
    </>
  );

  return { selection, topBar, startSelection, begin, rowSelection, imageSelection, element, isBusy } as const;
}
