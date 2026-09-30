import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { syncCategorySnapshotToNative } from '../categories/categorySnapshotSync';
import {
  deleteCollection,
  addItemToCollection,
  copyCollectionItems,
  getCollection,
  getCollectionNotificationPreference,
  getCollectionItems,
  getCollectionItemSections,
  getCollections,
  mergeCollection,
  removeItemFromCollection,
  renameCollection,
  restoreCollection,
  setCollectionColor,
  setCollectionFavorite,
  setCollectionIcon,
  setCollectionNotificationPreference,
  transferCollectionItem,
  undoCollectionMerge,
  undoTransferCollectionItem,
  MAX_ITEMS_PER_COPY,
  type Collection,
  type CollectionItemEntry,
} from '../collections/api/collectionsApi';
import { CopyDestinationPicker } from '../collections/CopyDestinationPicker';
import { CategoryPickerModal } from '../collections/CategoryPickerModal';
import { formatReplicateResultMessage, useReplicateItemPicker } from '../collections/useReplicateItemPicker';
import { formatCopyResultMessage } from '../collections/copyResultMessage';
import { CategoryEditorDialog } from '../collections/CategoryEditorDialog';
import { isCollaborative, isCollectionLocked, isSharedWithMe } from '../collections/collectionAccess';
import { formatItemAdder, shouldShowItemAdders } from '../collections/itemAdder';
import { CollectionLockDialog, type CollectionLockDialogMode } from '../collections/CollectionLockDialog';
import { beginCollectionVisit, forgetCollectionUnlock, getCollectionUnlockToken } from '../collections/collectionUnlockGrants';
import { CollectionParticipantsSheet } from '../collections/CollectionParticipantsSheet';
import { CollectionUnlockPanel } from '../collections/CollectionUnlockPanel';
import { formatParticipantSummary } from '../collections/participantSummary';
import { CategoryIconTile } from '../collections/CategoryIconTile';
import { applyCollectionIconImageChange, getIconImageSaveErrorMessage, type CollectionIconImageChange } from '../collections/collectionIconImage';
import {
  resolveEffectiveCollectionColorValue,
  type CollectionColorValue,
} from '../collections/collectionColors';
import { resolveCollectionIconKey, type CollectionIconKey } from '../collections/collectionIcons';
import { contentGateOfError, getCollectionItemsErrorMessage, isCollectionLockedError, NAME_ORDER_MAX_LINKS, useCollectionItems } from '../collections/useCollectionItems';
import { CenteredEmptyState } from '../components/CenteredEmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { useAppToast } from '../components/AppToast';
import { useToastBottomAnchor } from '../components/useToastBottomAnchor';
import { ActionMenuDialog, type ActionMenuDialogAction } from '../components/ActionMenuDialog';
import { SavedLinkGridCard } from '../components/SavedLinkGridCard';
import { SavedLinkRow } from '../components/SavedLinkRow';
import { SavedLinkRowSkeleton } from '../components/SavedLinkSkeleton';
import { SwipeableItemRow } from '../components/SwipeableItemRow';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { closeOpenRow } from '../components/swipeableRowCoordinator';
import { DateSectionHeader, dateAccordionStyles } from '../components/DateAccordion';
import {
  buildDateSectionRows,
  DateSectionErrorRow,
  DateSectionGridRow,
  DateSectionSkeletonRow,
  FIRST_PAGE_SKELETON_ROWS,
  useDateSectionViewability,
  type DateSectionRow,
} from '../components/DateSectionList';
import { BellIcon } from '../icons/BellIcon';
import { BellOffIcon } from '../icons/BellOffIcon';
import { CheckIcon } from '../icons/CheckIcon';
import { CopyIcon } from '../icons/CopyIcon';
import { EditIcon } from '../icons/EditIcon';
import { LockIcon } from '../icons/LockIcon';
import { MergeIcon } from '../icons/MergeIcon';
import { MoveIcon } from '../icons/MoveIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { UnlockIcon } from '../icons/UnlockIcon';
import { PeopleIcon } from '../icons/PeopleIcon';
import { ShareIcon } from '../icons/ShareIcon';
import { StarIcon } from '../icons/StarIcon';
import { MoreIcon } from '../icons/MoreIcon';
import { CollectionTargetPickerDialog } from '../collections/CollectionTargetPickerDialog';
import { sortCollectionItemsByName } from '../collections/sortCollectionItems';
import type { ItemHistoryEntry } from '../items/api/itemsApi';
import { historySectionLabel } from '../items/historyDateGrouping';
import { useDateSectionPages, type DateSectionPagesSource } from '../items/useDateSectionPages';
import { shareItem } from '../items/shareItem';
import type { RootStackParamList } from '../navigation/RootStack';
import { useSortPreference } from '../settings/sortPreference';
import { useViewModePreference } from '../settings/viewModePreference';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'CollectionDetails'>;

function getCollectionLoadErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'notFound') {
      return t('collections.errorNotFound');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('collections.errorDetailLoadFallback');
}

/** A target Collection that needs its lock (or, shared with me, its share password) opened first. */
function gateNoticeKey(error: unknown): string | null {
  const gate = contentGateOfError(error);
  return gate === 'sharePassword' ? 'collections.sharePasswordRequiredForAction' : gate === 'lock' ? 'collections.lockRequiredForAction' : null;
}

function getRenameErrorMessage(error: unknown, t: TFunction): string {
  if (isCollectionLockedError(error)) {
    return t('collections.lockRequiredForAction');
  }
  if (error instanceof ApiError) {
    if (error.kind === 'conflict') {
      return t('collections.errorNameConflict');
    }
    if (error.kind === 'badRequest') {
      return t('collections.errorNameInvalid');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('collections.errorRenameFallback');
}

function getIconUpdateErrorMessage(error: unknown, t: TFunction): string {
  if (isCollectionLockedError(error)) {
    return t('collections.lockRequiredForAction');
  }
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('collections.errorIconUpdateFallback');
}

function getColorUpdateErrorMessage(error: unknown, t: TFunction): string {
  if (isCollectionLockedError(error)) {
    return t('collections.lockRequiredForAction');
  }
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('collections.errorColorUpdateFallback');
}

function getDeleteErrorMessage(error: unknown, t: TFunction): string {
  if (isCollectionLockedError(error)) {
    return t('collections.lockRequiredForAction');
  }
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('collections.errorDeleteFallback');
}

function getRemoveItemErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  if (isCollectionLockedError(error)) {
    return t('collections.lockRequiredForAction');
  }
  return t('collections.errorRemoveItemFallback');
}

function getFavoriteToggleErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('collections.errorFavoriteToggleFallback');
}

/** Share.share only ever rejects on a genuine native module failure - a user dismissing/canceling the sheet resolves normally, never here. */
function getShareErrorMessage(t: TFunction): string {
  return t('item.shareError');
}

/** Mirrors the backend's CollectionNameNormalizer: trim, required, 100-character limit. */
function getNameValidationError(name: string, t: TFunction): string | null {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return t('collections.errorNameRequired');
  }
  if (trimmedName.length > 100) {
    return t('collections.errorNameTooLong');
  }
  return null;
}

/**
 * Adapts a CollectionItemEntry to the shape SavedLinkRow already knows how to render (Home/
 * History - see components/SavedLinkRow.tsx) - itemId/addedAtUtc are this endpoint's own field
 * names for the exact same concepts ItemHistoryEntry calls id/savedAtUtc; every other field is
 * identical. This is purely a display-shape adapter, not a new domain concept - CollectionItemEntry
 * remains the real API type everywhere else in this screen.
 */
function toSavedLinkRowItem(item: CollectionItemEntry): ItemHistoryEntry {
  return {
    id: item.itemId,
    url: item.url,
    title: item.title,
    memo: item.memo,
    savedAtUtc: item.addedAtUtc,
    representativeImage: item.representativeImage,
    previewImageUrl: item.previewImageUrl,
    coverImage: item.coverImage,
  };
}

/**
 * A single Collection's detail: rename/delete the Collection itself, and its Item list
 * (newest-added-first, paginated - see useCollectionItems). "Collection에서 제거" only removes the
 * membership row - the Item itself, and its membership in any other Collection, is untouched (see
 * removeItemAction below and CollectionItem's Cascade design in the backend).
 */
export function CollectionDetailsScreen({ route, navigation }: Props) {
  const { collectionId } = route.params;
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const { showNotificationToast, showUndoToast } = useAppToast();
  // A stack screen, not a tab screen - there is no Juple tab bar below it reserving the system
  // nav/gesture-area inset. The layout itself reserves it via the StackScreenSafeArea root (real
  // container padding, not list content padding - see that component's remarks); the raw inset is
  // only still needed here to anchor toasts above the system bar.
  const insets = useSafeAreaInsets();
  useToastBottomAnchor(insets.bottom);

  const [collection, setCollection] = useState<Collection | null>(null);
  const [isLoadingCollection, setIsLoadingCollection] = useState(true);
  const [collectionError, setCollectionError] = useState<string | null>(null);

  // Editing name/icon/color is a centered CategoryEditorDialog now (this round's Category UX
  // rework), not an inline expand-below form - a single editError surfaces whichever step of
  // submitEdit's sequential name/icon/color calls actually failed (see that function's own
  // remarks), shown directly inside the still-open dialog rather than a separate popup.
  const [isEditDialogVisible, setIsEditDialogVisible] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [isDeletingCollection, setIsDeletingCollection] = useState(false);
  const [isDeleteConfirmVisible, setIsDeleteConfirmVisible] = useState(false);

  // Mirrors DailyInboxScreen/DateHistoryScreen's SwipeableItemRow usage: one shared in-flight id
  // disables every row's swipe actions while any single row's share/remove is running.
  const [itemActionInFlightId, setItemActionInFlightId] = useState<number | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false);
  const [favoriteToggleError, setFavoriteToggleError] = useState<string | null>(null);

  const [isParticipantsSheetVisible, setIsParticipantsSheetVisible] = useState(false);

  const [pendingUnlinkItemId, setPendingUnlinkItemId] = useState<number | null>(null);
  const [actionMenuItem, setActionMenuItem] = useState<CollectionItemEntry | null>(null);
  const [isItemActionMenuVisible, setIsItemActionMenuVisible] = useState(false);
  const [isCollectionMenuVisible, setIsCollectionMenuVisible] = useState(false);
  const [targetMode, setTargetMode] = useState<'move' | 'merge' | null>(null);
  const [targetCollections, setTargetCollections] = useState<readonly Collection[]>([]);
  const [targetNextCursor, setTargetNextCursor] = useState<string | null>(null);
  const [isLoadingMoreTargets, setIsLoadingMoreTargets] = useState(false);
  const loadingMoreTargetsRef = useRef(false);
  const [isLoadingTargets, setIsLoadingTargets] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<Collection | null>(null);
  const [isMembershipMutation, setIsMembershipMutation] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // 새 링크 알림 - the caller's own setting for this Collection (null until loaded / not offered).
  const [newLinkNotifications, setNewLinkNotifications] = useState<boolean | null>(null);
  const notificationRequestRef = useRef(0);
  // 내 컬렉션으로 복사: non-null while selecting (the chosen link ids, in the order they were picked).
  const [selectedItemIds, setSelectedItemIds] = useState<ReadonlySet<number> | null>(null);
  const [isCopyPickerVisible, setIsCopyPickerVisible] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [lockDialogMode, setLockDialogMode] = useState<CollectionLockDialogMode | null>(null);
  // An Owner management action (edit/delete/share) waiting for the password on a locked Collection;
  // it runs right after a successful unlock, so the user never has to find the menu again.
  const [pendingUnlockAction, setPendingUnlockAction] = useState<(() => void) | null>(null);

  // Independent of view mode on purpose - switching List/Grid must never reset the chosen sort
  // (this round's explicit "View mode를 바꿔도 현재 sort 유지" requirement). Both are separately
  // persisted screen preferences (see viewModePreference.ts/sortPreference.ts), not one combined
  // state.
  const { viewMode, changeViewMode } = useViewModePreference('collectionDetailsViewMode');
  const { sortOption, setSortOption } = useSortPreference('collectionDetailsLinkSort');
  // 이름순 needs the whole Collection (see NAME_ORDER_MAX_LINKS): a larger one - known up front
  // from its link count, or found while loading - stays on 일자순 instead of a partial name order.
  const [isNameOrderTooLarge, setIsNameOrderTooLarge] = useState(false);
  const isNameOrderUnavailable = isNameOrderTooLarge || (collection?.itemCount ?? 0) > NAME_ORDER_MAX_LINKS;
  const effectiveSort = sortOption === 'title' && isNameOrderUnavailable ? 'newest' : sortOption;
  // 일자순 (newest ↓ / oldest ↑): the Collection's date sections and exact counts first, then each
  // expanded section's links from the server a page at a time (see useDateSectionPages). 이름순
  // loads the whole Collection first and sorts it here (see NAME_ORDER_MAX_LINKS).
  const dateSortDirection = effectiveSort === 'title' ? null : effectiveSort;
  const isDateOrder = dateSortDirection !== null;
  const pageSort = dateSortDirection === 'oldest' ? 'dateAsc' : 'dateDesc';

  const nameOrdered = useCollectionItems(collectionId, 'whole', !isDateOrder);

  // Which date sections are open - chosen once (today's, else the first shown), then only by the
  // user: a refresh, a page that loads more, a removed link or flipping ↓/↑ never resets it
  // (section keys are the same in both directions).
  const [expandedDateKeys, setExpandedDateKeys] = useState<ReadonlySet<string> | null>(null);
  const expandedDateKeysRef = useRef<ReadonlySet<string>>(new Set());
  expandedDateKeysRef.current = expandedDateKeys ?? new Set();
  const isDateSectionExpanded = useCallback((key: string) => expandedDateKeysRef.current.has(key), []);
  // Which password withheld the date-ordered content (the Owner's lock, or - for a member - the share password).
  const [dateOrderLockKind, setDateOrderLockKind] = useState<'lock' | 'sharePassword' | null>(null);
  const dateSource = useMemo<DateSectionPagesSource<CollectionItemEntry>>(
    () => ({
      loadSections: () => getCollectionItemSections(authenticatedRequest, collectionId, getCollectionUnlockToken(collectionId)),
      loadPage: (section, limit, cursor) =>
        getCollectionItems(authenticatedRequest, collectionId, {
          limit,
          cursor,
          sort: pageSort,
          fromUtc: section.fromUtc,
          toUtc: section.toUtc,
          unlockToken: getCollectionUnlockToken(collectionId),
        }),
      idOf: item => item.itemId,
      errorMessage: caughtError => getCollectionItemsErrorMessage(caughtError, t),
      // Locked (or share-password protected) with no valid grant: a stale grant is dropped and
      // nothing stays on screen - never a flash of the content behind it.
      onBlockingError: caughtError => {
        const gate = contentGateOfError(caughtError);
        if (!gate) {
          return false;
        }
        forgetCollectionUnlock(collectionId);
        setDateOrderLockKind(gate);
        return true;
      },
      onSectionsLoaded: () => setDateOrderLockKind(null),
    }),
    [authenticatedRequest, collectionId, pageSort, t],
  );
  const dated = useDateSectionPages(dateSource, isDateSectionExpanded, { enabled: isDateOrder, resetKey: pageSort });

  const isLoading = isDateOrder ? dated.isLoading : nameOrdered.isLoading;
  const isRefreshing = isDateOrder ? dated.isRefreshing : nameOrdered.isRefreshing;
  const error = isDateOrder ? dated.error : nameOrdered.error;
  const isContentLocked = isDateOrder ? dateOrderLockKind !== null : nameOrdered.isLocked;
  const contentLockKind = isDateOrder ? dateOrderLockKind : nameOrdered.lockKind;
  const isTooLargeForNameOrder = nameOrdered.isTooLargeForNameOrder;
  const refresh = isDateOrder ? dated.refresh : nameOrdered.refresh;
  const removeLocally = (itemId: number) => {
    dated.removeItem(itemId);
    nameOrdered.removeLocally(itemId);
  };
  // Every link currently loaded, whichever way the Collection is shown.
  const items = useMemo(
    () => (isDateOrder ? [...dated.pages.values()].flatMap(page => page.items) : nameOrdered.items),
    [dated.pages, isDateOrder, nameOrdered.items],
  );

  useEffect(() => {
    if (isTooLargeForNameOrder) {
      setIsNameOrderTooLarge(true);
      setNotice(t('collections.sortNameTooLarge', { max: NAME_ORDER_MAX_LINKS }));
    }
  }, [isTooLargeForNameOrder, t]);

  // Name order only ever over the whole Collection (the 'whole' load publishes nothing until every
  // link is in).
  const displayedItems = useMemo(() => sortCollectionItemsByName(nameOrdered.items), [nameOrdered.items]);
  // The server's sections are newest first; ↑ oldest shows them (and each one's pages) the other way.
  const dateSections = useMemo(
    () => (dateSortDirection === 'oldest' ? [...dated.sections].reverse() : dated.sections),
    [dateSortDirection, dated.sections],
  );
  useEffect(() => {
    if (expandedDateKeys !== null || dateSections.length === 0) {
      return;
    }
    const initial = dateSections.find(section => section.kind === 'today') ?? dateSections[0];
    setExpandedDateKeys(new Set([initial.key]));
  }, [dateSections, expandedDateKeys]);
  // An expanded section that has never loaded fetches its first page (collapsed ones never do).
  const { ensureLoaded: ensureDateSectionLoaded } = dated;
  useEffect(() => {
    if (isDateOrder) {
      expandedDateKeys?.forEach(key => ensureDateSectionLoaded(key));
    }
  }, [dated.sections, ensureDateSectionLoaded, expandedDateKeys, isDateOrder]);
  const dateRows = useMemo(
    () => (isDateOrder ? buildDateSectionRows(dateSections, dated.pages, expandedDateKeys ?? new Set(), viewMode, item => item.itemId) : []),
    [dateSections, dated.pages, expandedDateKeys, isDateOrder, viewMode],
  );
  const { onViewableItemsChanged, viewabilityConfig } = useDateSectionViewability(dated.pages, dated.loadMore);
  const toggleDateSection = (dateKey: string) => {
    setExpandedDateKeys(previous => {
      const next = new Set(previous ?? []);
      if (next.has(dateKey)) {
        next.delete(dateKey);
      } else {
        next.add(dateKey);
      }
      return next;
    });
  };
  /** 일자순: first press picks it (newest first); pressed again it flips ↓ newest ↔ ↑ oldest. */
  const pressDateSort = () => setSortOption(effectiveSort === 'newest' ? 'oldest' : 'newest');
  /** 이름순, unless this Collection is too large to be name-ordered as a whole - then it says so. */
  const pressNameSort = () => {
    if (isNameOrderUnavailable) {
      setNotice(t('collections.sortNameTooLarge', { max: NAME_ORDER_MAX_LINKS }));
      return;
    }
    setSortOption('title');
  };
  // Who added each link - only where more than one person can add (see shouldShowItemAdders).
  const showItemAdders = shouldShowItemAdders(collection, items);

  const loadCollection = useCallback(async () => {
    setIsLoadingCollection(true);
    setCollectionError(null);
    try {
      const fetched = await getCollection(authenticatedRequest, collectionId);
      setCollection(fetched);
    } catch (caughtError) {
      setCollectionError(getCollectionLoadErrorMessage(caughtError, t));
    } finally {
      setIsLoadingCollection(false);
    }
  }, [authenticatedRequest, collectionId, t]);

  // Refetches the Collection's own metadata (Name/ItemCount/participants) on every focus - entirely
  // independent of useCollectionItems' own focus-driven Item list load, mirroring ItemDetailsScreen's
  // Purchases/RepeatPurchases independence.
  // Owner vs Contributor always comes from the server's accessRole - never inferred here. Every
  // Owner-only control below is hidden for a Contributor, and the server independently refuses
  // them (403) regardless.
  const isOwner = collection !== null && !isSharedWithMe(collection);

  // 새 링크 알림 is offered wherever someone else can add links: a Collection shared with the caller,
  // or the caller's own one that has members or a public link. It is the header's bell - one tap
  // turns it on or off, no dialog.
  const offersNewLinkNotifications = collection !== null && isCollaborative(collection);
  useEffect(() => {
    if (!offersNewLinkNotifications) {
      setNewLinkNotifications(null);
      return undefined;
    }
    let isCurrent = true;
    getCollectionNotificationPreference(authenticatedRequest, collectionId)
      .then(preference => {
        if (isCurrent) {
          setNewLinkNotifications(preference.newItemNotificationsEnabled);
        }
      })
      .catch(() => undefined);
    return () => {
      isCurrent = false;
    };
  }, [authenticatedRequest, collectionId, offersNewLinkNotifications]);

  /** Flips at once; a failed save flips it back and says so briefly (only the latest change counts). */
  const changeNewLinkNotifications = (enabled: boolean) => {
    const previous = newLinkNotifications;
    const requestId = ++notificationRequestRef.current;
    setNewLinkNotifications(enabled);
    setCollectionNotificationPreference(authenticatedRequest, collectionId, enabled).catch(() => {
      if (requestId === notificationRequestRef.current) {
        setNewLinkNotifications(previous);
        showNotificationToast(t('collections.newLinkNotificationsError'));
      }
    });
  };

  const toggleCopySelection = (itemId: number) => {
    if (!selectedItemIds) {
      return;
    }
    const next = new Set(selectedItemIds);
    if (next.has(itemId)) {
      next.delete(itemId);
    } else if (next.size >= MAX_ITEMS_PER_COPY) {
      setNotice(t('collections.copySelectionLimit', { max: MAX_ITEMS_PER_COPY }));
      return;
    } else {
      next.add(itemId);
    }
    setSelectedItemIds(next);
  };

  const copySelectedTo = async (destination: Collection, destinationUnlockToken: string | null) => {
    setIsCopyPickerVisible(false);
    if (!selectedItemIds || selectedItemIds.size === 0 || isCopying) {
      return;
    }
    setIsCopying(true);
    try {
      const result = await copyCollectionItems(authenticatedRequest, collectionId, [...selectedItemIds], destination.id, destinationUnlockToken);
      setSelectedItemIds(null);
      showNotificationToast(formatCopyResultMessage(result, t));
    } catch (caughtError) {
      setNotice(
        caughtError instanceof ApiError && caughtError.kind === 'badRequest'
          ? t('collections.copySelectionLimit', { max: MAX_ITEMS_PER_COPY })
          : t(gateNoticeKey(caughtError) ?? 'collections.copyError'),
      );
    } finally {
      setIsCopying(false);
    }
  };

  // An unlock lasts for this visit only: while this screen is on the stack (child screens, sheets
  // and dialogs included) the grant is reused; once the user leaves the Collection it is forgotten,
  // and coming back asks for the password again.
  useEffect(() => beginCollectionVisit(collectionId), [collectionId]);

  useFocusEffect(
    useCallback(() => {
      loadCollection();
    }, [loadCollection]),
  );

  // Refresh signaling deliberately separate from AppToast state: revisiting this screen must never
  // recreate a toast or reset its timer - mirrors CollectionsScreen's own refreshToken effect,
  // needed because a Merge Undo toast's navigate() call back to this exact Collection can land on
  // an already-focused screen, which the useFocusEffect above will not re-fire for.
  useEffect(() => {
    if (route.params.refreshToken === undefined) {
      return;
    }
    navigation.setParams({ refreshToken: undefined });
    loadCollection();
    refresh();
  }, [route.params.refreshToken, navigation, loadCollection, refresh]);

  /**
   * Managing a locked Collection (edit, delete, share) needs the same unlock grant as its content -
   * the server refuses these without one. With a valid grant from this session the action runs at
   * once; otherwise the password prompt opens first and the action resumes after it succeeds.
   */
  const runUnlocked = (action: () => void) => {
    if (collection && isCollectionLocked(collection) && getCollectionUnlockToken(collectionId) === null) {
      setPendingUnlockAction(() => action);
      return;
    }
    action();
  };

  const openEditDialog = () => {
    if (!collection || isSavingEdit) {
      return;
    }
    setEditError(null);
    setIsEditDialogVisible(true);
  };

  const cancelEditName = () => {
    if (isSavingEdit) {
      return;
    }
    setIsEditDialogVisible(false);
    setEditError(null);
  };

  /**
   * Saves the name/icon/color edit fields together (one dialog, one Save button - see
   * CategoryEditorDialog), but calls their independent endpoints sequentially, never via
   * Promise.all: all three mutate the same Collection row's RowVersion (see backend
   * CollectionStore.RenameAsync/SetIconAsync/SetColorAsync), so firing them concurrently risks one
   * losing an optimistic-concurrency race against another. A name change that succeeds followed by
   * an icon or color change that fails is left applied (not rolled back) - the same "each attribute
   * is its own independent action" contract this screen's favorite/share/delete actions already
   * follow, not an all-or-nothing transaction. On any failure the dialog stays open (isEditDialogVisible
   * untouched) showing editError, so the user can see exactly what happened and retry.
   */
  const submitEdit = async (name: string, icon: CollectionIconKey, color: CollectionColorValue, imageChange: CollectionIconImageChange) => {
    if (isSavingEdit || !collection) {
      return;
    }

    const validationError = getNameValidationError(name, t);
    if (validationError) {
      setEditError(validationError);
      return;
    }
    const trimmedName = name.trim();
    const nameChanged = trimmedName !== collection.name;
    const iconChanged = icon !== resolveCollectionIconKey(collection.icon);
    const colorChanged = color !== resolveEffectiveCollectionColorValue(collection.color, collection.id);
    const imageChanged = imageChange.kind === 'set' || (imageChange.kind === 'remove' && !!collection.iconImageUrl);

    if (!nameChanged && !iconChanged && !colorChanged && !imageChanged) {
      setIsEditDialogVisible(false);
      return;
    }

    setIsSavingEdit(true);
    setEditError(null);

    if (nameChanged) {
      try {
        await renameCollection(authenticatedRequest, collectionId, trimmedName);
        setCollection(previous => (previous ? { ...previous, name: trimmedName } : previous));
      } catch (caughtError) {
        setEditError(getRenameErrorMessage(caughtError, t));
        setIsSavingEdit(false);
        return;
      }
    }

    if (iconChanged) {
      try {
        const updated = await setCollectionIcon(authenticatedRequest, collectionId, icon);
        setCollection(updated);
      } catch (caughtError) {
        setEditError(getIconUpdateErrorMessage(caughtError, t));
        setIsSavingEdit(false);
        return;
      }
    }

    if (colorChanged) {
      try {
        const updated = await setCollectionColor(authenticatedRequest, collectionId, color);
        setCollection(updated);
      } catch (caughtError) {
        setEditError(getColorUpdateErrorMessage(caughtError, t));
        setIsSavingEdit(false);
        return;
      }
    }

    if (imageChanged) {
      try {
        setCollection(await applyCollectionIconImageChange(authenticatedRequest, collection, imageChange));
      } catch (caughtError) {
        setEditError(getIconImageSaveErrorMessage(caughtError, t));
        setIsSavingEdit(false);
        return;
      }
    }

    setIsEditDialogVisible(false);
    syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
    setIsSavingEdit(false);
  };

  const deleteCollectionAction = async () => {
    if (isDeletingCollection) {
      return;
    }

    setIsDeletingCollection(true);
    try {
      await deleteCollection(authenticatedRequest, collectionId);
      syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
      showUndoToast({
        actionLabel: t('toast.undoAction'),
        message: t('toast.collectionDeleteSuccess'),
        onUndo: async () => {
          await restoreCollection(authenticatedRequest, collectionId);
          syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
          navigation.popTo('MainTabs', { screen: 'Collections', params: { refreshToken: Date.now() } });
        },
        undoErrorMessage: t('toast.undoCollectionDeleteError'), noticeTitle: t('common.notice'), confirmLabel: t('common.confirm'),
      });
      // Back to the MainTabs already under this screen - never a new one (replace, or navigate in
      // React Navigation 7, would mount fresh tabs and lose the Collections filter, History's
      // scroll/expanded dates and Home's state). The refreshToken makes Collections reload.
      navigation.popTo('MainTabs', {
        screen: 'Collections',
        params: { refreshToken: Date.now() },
      });
    } catch (caughtError) {
      setNotice(getDeleteErrorMessage(caughtError, t));
    } finally {
      setIsDeletingCollection(false);
    }
  };

  const confirmDeleteCollection = () => {
    if (isDeletingCollection) {
      return;
    }
    setIsDeleteConfirmVisible(true);
  };

  const removeItemAction = async (itemId: number) => {
    if (itemActionInFlightId !== null) {
      return;
    }

    setItemActionInFlightId(itemId);
    setRemoveError(null);
    try {
      await removeItemFromCollection(authenticatedRequest, collectionId, itemId);
      removeLocally(itemId);
      setCollection(previous =>
        previous ? { ...previous, itemCount: Math.max(0, previous.itemCount - 1) } : previous,
      );
      showUndoToast({ actionLabel: t('toast.undoAction'), message: t('toast.unlinkSuccess'), noticeTitle: t('common.notice'), confirmLabel: t('common.confirm'), undoErrorMessage: t('toast.undoUnlinkError'), onUndo: async () => {
        await addItemToCollection(authenticatedRequest, collectionId, itemId);
        setCollection(previous => previous ? { ...previous, itemCount: previous.itemCount + 1 } : previous);
        await refresh();
      } });
    } catch (caughtError) {
      setRemoveError(getRemoveItemErrorMessage(caughtError, t));
    } finally {
      setItemActionInFlightId(null);
    }
  };

  /** Shares the Item's original URL as-is via the OS Share Sheet - never a Juple-branded link. */
  const shareItemAction = async (item: CollectionItemEntry) => {
    if (itemActionInFlightId !== null) {
      return;
    }

    setItemActionInFlightId(item.itemId);
    setShareError(null);
    try {
      await shareItem(item.url, item.title);
    } catch {
      setShareError(getShareErrorMessage(t));
    } finally {
      setItemActionInFlightId(null);
    }
  };

  const toggleFavoriteAction = async () => {
    if (!collection || isTogglingFavorite) {
      return;
    }
    const desiredIsFavorite = !collection.isFavorite;

    setIsTogglingFavorite(true);
    setFavoriteToggleError(null);
    setCollection(previous => (previous ? { ...previous, isFavorite: desiredIsFavorite } : previous));
    try {
      const updated = await setCollectionFavorite(authenticatedRequest, collectionId, desiredIsFavorite);
      setCollection(updated);
      syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
    } catch (caughtError) {
      // Roll back the optimistic flip - never trust it once the request has failed.
      setCollection(previous => (previous ? { ...previous, isFavorite: !desiredIsFavorite } : previous));
      setFavoriteToggleError(getFavoriteToggleErrorMessage(caughtError, t));
    } finally {
      setIsTogglingFavorite(false);
    }
  };

  const confirmUnlinkItem = (itemId: number) => {
    setPendingUnlinkItemId(previous => previous ?? itemId);
  };

  const openTargetPicker = async (mode: 'move' | 'merge') => {
    setIsItemActionMenuVisible(false);
    if (mode === 'merge') setActionMenuItem(null);
    setIsCollectionMenuVisible(false);
    setTargetMode(mode);
    setIsLoadingTargets(true);
    try {
      let page = await getCollections(authenticatedRequest, { limit: 50 });
      let candidates = page.items.filter(candidate => candidate.id !== collectionId);
      // If the first page only contains the source, advance just until a usable target exists or
      // pagination ends; do not eagerly fetch every page once a target is available.
      while (candidates.length === 0 && page.nextCursor) {
        page = await getCollections(authenticatedRequest, { limit: 50, cursor: page.nextCursor });
        candidates = page.items.filter(candidate => candidate.id !== collectionId);
      }
      setTargetCollections(candidates);
      setTargetNextCursor(page.nextCursor);
      if (candidates.length === 0 && page.nextCursor === null) {
        setTargetMode(null);
        setNotice(t('collections.addModalEmpty'));
      }
    } catch {
      setTargetMode(null);
      setNotice(t('collections.errorTargetLoadFallback'));
    } finally { setIsLoadingTargets(false); }
  };

  const loadMoreTargets = () => {
    if (loadingMoreTargetsRef.current || !targetNextCursor || isLoadingTargets || isMembershipMutation) return;
    loadingMoreTargetsRef.current = true; setIsLoadingMoreTargets(true);
    void getCollections(authenticatedRequest, { limit: 50, cursor: targetNextCursor }).then(page => {
      setTargetCollections(previous => {
        const seen = new Set(previous.map(item => item.id));
        return [...previous, ...page.items.filter(item => item.id !== collectionId && !seen.has(item.id))];
      });
      setTargetNextCursor(page.nextCursor);
    }).catch(() => { setNotice(t('collections.errorTargetLoadFallback')); setTargetMode(null); })
      .finally(() => { loadingMoreTargetsRef.current = false; setIsLoadingMoreTargets(false); });
  };

  const selectTarget = (target: Collection) => {
    if (!targetMode) return;
    setPendingTarget(target);
  };

  // 다른 컬렉션에 복제: this link into any number of my own Collections at once (a multi-choice picker
  // of its own - 이동/병합 keep choosing exactly one target above).
  const replicatePicker = useReplicateItemPicker(authenticatedRequest, t, result => {
    showNotificationToast(formatReplicateResultMessage(result, t));
  });
  const openReplicatePicker = () => {
    setIsItemActionMenuVisible(false);
    if (actionMenuItem) {
      replicatePicker.open(actionMenuItem.itemId);
    }
    setActionMenuItem(null);
  };

  const confirmTargetAction = async () => {
    if (!pendingTarget || isMembershipMutation) return;
    setIsMembershipMutation(true);
    try {
      if (targetMode === 'merge') {
        const targetCollectionId = pendingTarget.id;
        const merge = await mergeCollection(authenticatedRequest, collectionId, targetCollectionId);
        // null only for the source-equals-target no-op (see MergeCollectionResult) - nothing was
        // merged, so there is nothing to offer an Undo for.
        if (merge.undoOperationId) {
          const undoOperationId = merge.undoOperationId;
          showUndoToast({
            actionLabel: t('toast.undoAction'),
            message: t('toast.collectionMergeSuccess'),
            onUndo: async () => {
              await undoCollectionMerge(authenticatedRequest, undoOperationId);
              // Backend is the sole source of truth for the restored membership state - this only
              // re-navigates to (and, via refreshToken, force-refreshes) the target Collection,
              // never reconstructs a local membership snapshot.
              navigation.navigate('CollectionDetails', { collectionId: targetCollectionId, refreshToken: Date.now() });
            },
            undoErrorMessage: t('toast.undoCollectionMergeError'),
            noticeTitle: t('common.notice'),
            confirmLabel: t('common.confirm'),
          });
        }
        navigation.replace('CollectionDetails', { collectionId: targetCollectionId });
      } else if (actionMenuItem) {
        const move = await transferCollectionItem(authenticatedRequest, collectionId, actionMenuItem.itemId, pendingTarget.id);
        removeLocally(actionMenuItem.itemId);
        setCollection(previous => previous ? { ...previous, itemCount: Math.max(0, previous.itemCount - 1) } : previous);
        const itemId = actionMenuItem.itemId;
        const targetCollectionId = pendingTarget.id;
        const targetMembershipCreated = move.targetMembershipCreated;
        showUndoToast({ actionLabel: t('toast.undoAction'), message: t('toast.moveSuccess'), noticeTitle: t('common.notice'), confirmLabel: t('common.confirm'), undoErrorMessage: t('toast.undoMoveError'), onUndo: async () => {
          await undoTransferCollectionItem(authenticatedRequest, collectionId, itemId, targetCollectionId, targetMembershipCreated);
          setCollection(previous => previous ? { ...previous, itemCount: previous.itemCount + 1 } : previous);
          await refresh();
        } });
      }
    } catch (caughtError) {
      setNotice(t(gateNoticeKey(caughtError) ?? (targetMode === 'merge' ? 'collections.mergeError' : 'collections.moveError')));
    }
    finally { setPendingTarget(null); setTargetMode(null); setActionMenuItem(null); setIsMembershipMutation(false); }
  };

  if (isLoadingCollection && !collection) {
    return (
      <StackScreenSafeArea style={styles.loadingContainer}>
        <ActivityIndicator />
      </StackScreenSafeArea>
    );
  }

  if (!collection) {
    return (
      <StackScreenSafeArea style={styles.loadingContainer}>
        {collectionError ? <Text style={styles.error}>{collectionError}</Text> : null}
      </StackScreenSafeArea>
    );
  }

  const participantSummary = formatParticipantSummary(collection, t);

  /**
   * One link of this Collection as a swipeable List row or Grid tile - the same in the flat 이름순
   * list and inside a 일자순 date section (which passes its accordion card's own row style).
   */
  const renderCollectionItem = (item: CollectionItemEntry, containerStyle?: StyleProp<ViewStyle>) => {
    // Another member's link: opened as the read-only shared view (the owner-only ItemDetails
    // would be a 404 anyway), and never offered Add/Move - those act on one's own Items.
    const isMine = item.isMine !== false;
    const canManageItem = isOwner && isMine;
    const openItemMenu = () => { setActionMenuItem(item); setIsItemActionMenuVisible(true); };
    const addedByLabel = showItemAdders ? formatItemAdder(item.addedBy, t) : null;
    if (selectedItemIds) {
      // 내 컬렉션으로 복사 selection: a tap only picks/unpicks - no swipe actions, menus or navigation.
      const isSelected = selectedItemIds.has(item.itemId);
      return (
        <Pressable
          accessibilityLabel={item.title ?? item.url}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isSelected, disabled: isCopying }}
          disabled={isCopying}
          onPress={() => toggleCopySelection(item.itemId)}
          style={containerStyle ?? [styles.row, viewMode === 'grid' && styles.gridCard]}
          testID={`collection-copy-select-${item.itemId}`}
        >
          <View>
            {viewMode === 'grid' ? (
              <SavedLinkGridCard addedByLabel={addedByLabel} dateDisplayMode="dateTime" isActionInFlight={false} item={toSavedLinkRowItem(item)} preferEffectiveThumbnail />
            ) : (
              <SavedLinkRow addedByLabel={addedByLabel} dateDisplayMode="dateTime" isActionInFlight={false} item={toSavedLinkRowItem(item)} preferEffectiveThumbnail />
            )}
            {/* Overlay: the selection mark sits on the card's top-start corner in both layouts. */}
            <View style={[styles.selectionMark, isSelected && styles.selectionMarkSelected]}>
              {isSelected ? <CheckIcon color={colors.surface} size={14} /> : null}
            </View>
          </View>
        </Pressable>
      );
    }
    return (
      <SwipeableItemRow
        containerStyle={containerStyle ?? [styles.row, viewMode === 'grid' && styles.gridCard]}
        disabled={itemActionInFlightId !== null || isRefreshing}
        // Removing a link from the Category is Owner-only (it never deletes anyone's Item).
        onDelete={isOwner ? () => confirmUnlinkItem(item.itemId) : undefined}
        deleteLabel={t('collections.removeFromCollection')}
        // Grid tiles have no room for a separate trailing "More" button (see SavedLinkGridCard) -
        // long-press reaches the exact same Add/Move menu List mode's trailingAction opens, so
        // Grid never loses that functionality, only its always-visible affordance.
        onLongPress={canManageItem ? openItemMenu : undefined}
        onPress={() => {
          if (isMine) {
            // Opened from this Collection: its delete action removes the link from here only.
            navigation.navigate('ItemDetails', { itemId: item.itemId, collectionContext: { collectionId, canRemove: isOwner } });
          } else {
            navigation.navigate('CollectionSharedItem', { collectionId, itemId: item.itemId });
          }
        }}
        onShare={() => shareItemAction(item)}
      >
        {/* Exactly Home/History's own row/tile - see SavedLinkRow.tsx/SavedLinkGridCard.tsx -
            so a Category's link cards are visually indistinguishable from the same Item shown
            anywhere else in the app. dateDisplayMode="dateTime" (not the default "time")
            because a Category's items span arbitrary dates, never a single grouped day the way
            a History section does - matches this row's own prior "always show the full date"
            behavior exactly - Grid passes the same mode, so both show the identical timestamp. */}
        {viewMode === 'grid' ? (
          <SavedLinkGridCard addedByLabel={addedByLabel} dateDisplayMode="dateTime" isActionInFlight={itemActionInFlightId === item.itemId} item={toSavedLinkRowItem(item)} preferEffectiveThumbnail />
        ) : (
          <SavedLinkRow
            addedByLabel={addedByLabel}
            dateDisplayMode="dateTime"
            isActionInFlight={itemActionInFlightId === item.itemId}
            item={toSavedLinkRowItem(item)}
            preferEffectiveThumbnail
            trailingAction={canManageItem ? { accessibilityLabel: t('collections.itemManageAction'), onPress: openItemMenu } : undefined}
          />
        )}
      </SwipeableItemRow>
    );
  };

  const closeCollectionMenuThen = (action: () => void) => () => {
    setIsCollectionMenuVisible(false);
    action();
  };

  // The Collection's ⋯ menu - what this caller may do, in a fixed order. The Owner: 수정, the lock,
  // 병합, then 삭제 last (destructive). Edit and delete used to be header icons of their own.
  const collectionMenuActions: ActionMenuDialogAction[] = isOwner
    ? [
        { label: t('common.edit'), icon: EditIcon, onPress: closeCollectionMenuThen(() => runUnlocked(openEditDialog)) },
        // The lock password itself is managed only in Settings > 컬렉션 잠금 - here a Collection is
        // just locked (a confirmation) or unlocked (that password).
        isCollectionLocked(collection)
          ? { label: t('collections.lockRemoveAction'), destructive: true, icon: UnlockIcon, onPress: closeCollectionMenuThen(() => setLockDialogMode('remove')) }
          : { label: t('collections.lockSetTitle'), icon: LockIcon, onPress: closeCollectionMenuThen(() => setLockDialogMode('lock')) },
        // Merging moves this Category's links, so it is offered only once its content is unlocked.
        ...(collection.hasCollaborators || isContentLocked ? [] : [{ label: t('collections.mergeWithOther'), icon: MergeIcon, onPress: () => void openTargetPicker('merge') }]),
        { label: t('common.delete'), destructive: true, icon: TrashIcon, onPress: closeCollectionMenuThen(() => runUnlocked(confirmDeleteCollection)) },
      ]
    : [
        // Shared with me: copying links into a Collection of my own - only once the content is open
        // (a share password first) and there is something to copy. 새 링크 알림 is the header's bell.
        ...(isContentLocked || items.length === 0
          ? []
          : [{ label: t('collections.copyToMine'), icon: CopyIcon, onPress: closeCollectionMenuThen(() => setSelectedItemIds(new Set())) }]),
      ];

  const listHeader = (
    <View>
      <View>
          <View style={styles.headerTitleRow}>
            <View style={styles.headerIconBadge}>
              <CategoryIconTile collectionId={collection.id} color={collection.color} icon={collection.icon} imageUrl={collection.iconImageUrl} imageVersion={collection.iconImageVersion} size={32} />
            </View>
            <Text ellipsizeMode="tail" numberOfLines={2} style={styles.title} testID="collection-details-title">{collection.name}</Text>
            {isCollectionLocked(collection) ? (
              <View accessibilityLabel={t('collections.lockedA11y')} testID="collection-details-locked">
                <LockIcon color={colors.textSecondary} size={18} />
              </View>
            ) : null}
          </View>
          {participantSummary ? (
            <Pressable
              accessibilityHint={t('collections.participantsTitle')}
              accessibilityRole="button"
              onPress={() => setIsParticipantsSheetVisible(true)}
              style={styles.sharedByRow}
              testID="collection-details-participants"
            >
              <PeopleIcon color={colors.brand} size={14} />
              <Text numberOfLines={1} style={styles.sharedByText}>{participantSummary}</Text>
            </Pressable>
          ) : null}
          <View style={styles.headerMetaRow}>
            <Text style={styles.itemCount}>
              {t('collections.detailItemCount', { count: collection.itemCount })}
            </Text>
            <View style={styles.headerActions}>
              {/* The caller's own favorite mark - a Contributor has one too; it changes
                  nothing for anyone else, so it is not an Owner-only control. */}
              <Pressable accessibilityLabel={collection.isFavorite ? t('collections.removeFavorite') : t('collections.addFavorite')} accessibilityRole="button" accessibilityState={{ disabled: isTogglingFavorite, busy: isTogglingFavorite }} disabled={isTogglingFavorite} onPress={toggleFavoriteAction} style={styles.iconButton} testID="collection-details-favorite">
                <StarIcon color={collection.isFavorite ? colors.warning : colors.border} filled={collection.isFavorite} size={20} />
              </Pressable>
              {/* 새 링크 알림 - a plain on/off toggle of the caller's own preference, shown once it is known. */}
              {offersNewLinkNotifications && newLinkNotifications !== null ? (
                <Pressable
                  accessibilityLabel={t(newLinkNotifications ? 'collections.newLinkNotificationsOnA11y' : 'collections.newLinkNotificationsOffA11y')}
                  accessibilityRole="button"
                  onPress={() => changeNewLinkNotifications(!newLinkNotifications)}
                  style={styles.iconButton}
                  testID="collection-details-notifications"
                >
                  {/* The shape alone tells the state: a bell when on, a slashed bell when off - no badge. */}
                  {newLinkNotifications
                    ? <BellIcon color={colors.textPrimary} size={20} />
                    : <BellOffIcon color={colors.textSecondary} size={20} />}
                </Pressable>
              ) : null}
            {isOwner ? (
              // The single entry point for sharing - opens the one Share screen; tapping it never
              // turns anything on by itself.
              <Pressable
                accessibilityLabel={t('collections.shareAction')}
                accessibilityRole="button"
                onPress={() => runUnlocked(() => navigation.navigate('CollectionShare', { collectionId }))}
                style={styles.iconButton}
                testID="collection-details-share"
              >
                <ShareIcon color={colors.textPrimary} size={20} />
              </Pressable>
            ) : null}
            {collectionMenuActions.length > 0 ? (
              <Pressable
                accessibilityLabel={t('collections.manageAction')}
                accessibilityRole="button"
                accessibilityState={{ disabled: isDeletingCollection, busy: isDeletingCollection }}
                disabled={isDeletingCollection}
                onPress={() => setIsCollectionMenuVisible(true)}
                style={[styles.iconButton, isDeletingCollection && styles.disabledButton]}
                testID="collection-details-more"
              >
                <MoreIcon color={colors.textSecondary} size={20} />
              </Pressable>
            ) : null}
            </View>
          </View>
      </View>
      {/* View mode (List/Grid) and sort are two independent, separately-persisted
          preferences (see useViewModePreference/useSortPreference) - switching one never
          resets the other, this round's explicit requirement. */}
      <View style={styles.sortRow}>
        <Pressable
          accessibilityLabel={
            effectiveSort === 'oldest' ? t('collections.sortDateOldestA11y') : t('collections.sortDateNewestA11y')
          }
          accessibilityRole="button"
          accessibilityState={{ selected: dateSortDirection !== null }}
          onPress={pressDateSort}
          style={[styles.sortChip, dateSortDirection !== null && styles.sortChipSelected]}
          testID="collection-sort-date"
        >
          <Text style={[styles.sortChipLabel, dateSortDirection !== null && styles.sortChipLabelSelected]}>
            {dateSortDirection === null
              ? t('collections.sortDate')
              : `${t('collections.sortDate')} ${dateSortDirection === 'oldest' ? '↑' : '↓'}`}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: effectiveSort === 'title' }}
          onPress={pressNameSort}
          style={[styles.sortChip, effectiveSort === 'title' && styles.sortChipSelected]}
          testID="collection-sort-name"
        >
          <Text style={[styles.sortChipLabel, effectiveSort === 'title' && styles.sortChipLabelSelected]}>
            {t('collections.sortName')}
          </Text>
        </Pressable>
        <View style={styles.sortRowSpacer} />
        <ViewModeToggle onChange={changeViewMode} value={viewMode} />
      </View>
      {favoriteToggleError ? <Text style={styles.error}>{favoriteToggleError}</Text> : null}

      {collectionError ? <Text style={styles.error}>{collectionError}</Text> : null}
      {removeError ? <Text style={styles.error}>{removeError}</Text> : null}
      {shareError ? <Text style={styles.error}>{shareError}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );

  // Nothing to show yet: where the links are about to appear (a whole name-ordered Collection, or
  // the date summary) - skeletons only while that request is actually on its way.
  const listEmpty = isContentLocked ? (
    <CollectionUnlockPanel collectionId={collectionId} isOwner={isOwner} kind={contentLockKind ?? 'lock'} onUnlocked={refresh} />
  ) : isLoading ? (
    <View testID="collection-items-loading">
      {Array.from({ length: FIRST_PAGE_SKELETON_ROWS }, (_, index) => (
        <View key={index} style={[styles.row, styles.skeletonRow]}>
          <SavedLinkRowSkeleton testID="collection-items-skeleton" />
        </View>
      ))}
    </View>
  ) : !error ? <CenteredEmptyState message={t('collections.itemsEmpty')} /> : undefined;

  const renderDateRow = ({ item: row }: { item: DateSectionRow<CollectionItemEntry> }) => {
    switch (row.kind) {
      case 'header':
        return (
          <DateSectionHeader
            count={row.section.count}
            isExpanded={expandedDateKeys?.has(row.section.key) ?? false}
            label={historySectionLabel(row.section, t)}
            onPress={() => toggleDateSection(row.section.key)}
          />
        );
      case 'item':
        return renderCollectionItem(row.item, [dateAccordionStyles.row, row.isLast && dateAccordionStyles.rowLast]);
      case 'gridRow':
        // Image view: each pair of tiles is one list row of the date's card.
        return (
          <DateSectionGridRow isFirst={row.isFirst} isLast={row.isLast} testID={`collection-date-grid-${row.section.key}-${row.position}`}>
            {row.items.map(item => (
              <View key={item.itemId} style={styles.gridCard}>
                {renderCollectionItem(item, styles.gridCardInner)}
              </View>
            ))}
          </DateSectionGridRow>
        );
      case 'skeleton':
        return <DateSectionSkeletonRow grid={row.grid} isFirst={row.isFirst} isLast={row.isLast} testID="collection-items-skeleton" />;
      case 'error':
        return (
          <DateSectionErrorRow
            message={row.message}
            onRetry={() => {
              const page = dated.pages.get(row.section.key);
              if (page && page.items.length > 0) {
                dated.loadMore(row.section.key);
              } else {
                dated.ensureLoaded(row.section.key);
              }
            }}
            retryTestID={`collection-section-retry-${row.section.key}`}
            testID={`collection-section-error-${row.section.key}`}
          />
        );
    }
  };

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      {isDateOrder && !isContentLocked ? (
        // One virtualized list: headers, the loaded rows of expanded dates (in image view one list
        // row per pair of tiles), skeletons while a page is on its way, and a retry row.
        <FlatList
          contentContainerStyle={styles.content}
          style={styles.list}
          data={dateRows}
          keyExtractor={row => row.key}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews={Platform.OS === 'android'}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
          onScrollBeginDrag={closeOpenRow}
          renderItem={renderDateRow}
        />
      ) : (
        <FlatList
          key={viewMode}
          contentContainerStyle={styles.content}
          style={styles.list}
          data={isContentLocked ? [] : displayedItems}
          keyExtractor={(item: CollectionItemEntry) => item.itemId.toString()}
          numColumns={viewMode === 'grid' ? 2 : 1}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews={Platform.OS === 'android'}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
          onScrollBeginDrag={closeOpenRow}
          renderItem={({ item }) => renderCollectionItem(item)}
        />
      )}
      {selectedItemIds ? (
        <View style={styles.selectionBar} testID="collection-copy-bar">
          <Text numberOfLines={2} style={styles.selectionCount}>{t('collections.copySelectedCount', { count: selectedItemIds.size })}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={isCopying}
            onPress={() => setSelectedItemIds(null)}
            style={styles.selectionButton}
            testID="collection-copy-cancel"
          >
            <Text style={styles.selectionCancelLabel}>{t('common.cancel')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: selectedItemIds.size === 0 || isCopying, busy: isCopying }}
            disabled={selectedItemIds.size === 0 || isCopying}
            onPress={() => setIsCopyPickerVisible(true)}
            style={[styles.selectionButton, styles.selectionPrimary, (selectedItemIds.size === 0 || isCopying) && styles.disabledButton]}
            testID="collection-copy-confirm"
          >
            {isCopying ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.selectionPrimaryLabel}>{t('collections.copyAction')}</Text>}
          </Pressable>
        </View>
      ) : null}
      <CopyDestinationPicker
        authenticatedRequest={authenticatedRequest}
        onCancel={() => setIsCopyPickerVisible(false)}
        onChosen={(destination, unlockToken) => {
          copySelectedTo(destination, unlockToken).catch(() => undefined);
        }}
        onLoadError={() => {
          setIsCopyPickerVisible(false);
          setNotice(t('collections.errorTargetLoadFallback'));
        }}
        visible={isCopyPickerVisible}
      />
      <CategoryEditorDialog
        error={editError}
        initialColor={resolveEffectiveCollectionColorValue(collection.color, collection.id)}
        initialIcon={resolveCollectionIconKey(collection.icon)}
        initialImageUrl={collection.iconImageUrl ?? null}
        initialName={collection.name}
        isSubmitting={isSavingEdit}
        mode="edit"
        onCancel={cancelEditName}
        onSubmit={submitEdit}
        visible={isEditDialogVisible}
      />
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
        message={t('collections.deleteConfirmMessage')}
        onCancel={() => setIsDeleteConfirmVisible(false)}
        onConfirm={() => {
          setIsDeleteConfirmVisible(false);
          deleteCollectionAction();
        }}
        title={t('collections.deleteConfirmTitle')}
        visible={isDeleteConfirmVisible}
      />
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('collections.removeFromCollection')}
        message={t('collections.unlinkConfirmMessage')}
        onCancel={() => setPendingUnlinkItemId(null)}
        onConfirm={() => {
          const itemId = pendingUnlinkItemId;
          setPendingUnlinkItemId(null);
          if (itemId !== null) {
            removeItemAction(itemId);
          }
        }}
        title={t('collections.unlinkConfirmTitle')}
        visible={pendingUnlinkItemId !== null}
      />
      <ActionMenuDialog
        actions={[
          { label: t('collections.addToOther'), icon: CopyIcon, onPress: openReplicatePicker },
          ...(collection.hasCollaborators ? [] : [{ label: t('collections.moveToOther'), icon: MoveIcon, onPress: () => void openTargetPicker('move') }]),
        ]}
        cancelLabel={t('common.cancel')}
        onCancel={() => { setIsItemActionMenuVisible(false); setActionMenuItem(null); }}
        visible={isItemActionMenuVisible}
      />
      <ActionMenuDialog
        actions={collectionMenuActions}
        cancelLabel={t('common.cancel')}
        onCancel={() => setIsCollectionMenuVisible(false)}
        visible={isCollectionMenuVisible}
      />
      <CollectionLockDialog
        collectionId={collectionId}
        mode={lockDialogMode ?? 'lock'}
        onCancel={() => setLockDialogMode(null)}
        onChanged={() => {
          setLockDialogMode(null);
          loadCollection();
          refresh();
        }}
        onOpenSettings={() => {
          setLockDialogMode(null);
          navigation.navigate('CollectionLockSettings');
        }}
        visible={lockDialogMode !== null}
      />
      <Modal
        animationType="fade"
        onRequestClose={() => setPendingUnlockAction(null)}
        transparent
        visible={pendingUnlockAction !== null}
      >
        <View style={styles.unlockOverlay} testID="collection-details-unlock-gate">
          <CollectionUnlockPanel
            collectionId={collectionId}
            isOwner={isOwner}
            onUnlocked={() => {
              const action = pendingUnlockAction;
              setPendingUnlockAction(null);
              refresh();
              action?.();
            }}
          />
          <Pressable accessibilityRole="button" onPress={() => setPendingUnlockAction(null)} style={styles.unlockCancel}>
            <Text style={styles.unlockCancelLabel}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </Modal>
      <CategoryPickerModal
        bottomInset={insets.bottom}
        collectionPool={replicatePicker.collections}
        disabledIds={replicatePicker.containedIds}
        error={replicatePicker.error}
        isCreatingCollection={false}
        isLoadingMore={replicatePicker.isLoadingMore}
        isLoadingOptions={replicatePicker.isLoading}
        onClose={replicatePicker.close}
        onLoadMore={replicatePicker.loadMore}
        onToggle={replicatePicker.toggle}
        onUnlockCancel={replicatePicker.cancelUnlock}
        onUnlockGranted={replicatePicker.onUnlockGranted}
        selectedIds={replicatePicker.selectedIds}
        showCreateTile={false}
        sort={{ value: replicatePicker.sort, onChange: replicatePicker.changeSort }}
        submit={{
          label: replicatePicker.selectedIds.size > 0
            ? t('collections.replicateSubmitCount', { count: replicatePicker.selectedIds.size })
            : t('collections.replicateSubmit'),
          onSubmit: replicatePicker.submit,
          isSubmitting: replicatePicker.isSubmitting,
        }}
        title={t('collections.targetPickerTitle')}
        unlockTarget={replicatePicker.unlockTarget}
        viewModeKey="replicatePickerViewMode"
        visible={replicatePicker.isVisible}
      />
      <CollectionTargetPickerDialog collections={targetCollections} isLoading={isLoadingTargets} isLoadingMore={isLoadingMoreTargets} onCancel={() => setTargetMode(null)} onLoadMore={loadMoreTargets} onSelect={selectTarget} visible={targetMode !== null && pendingTarget === null} />
      <ConfirmDialog cancelLabel={t('common.cancel')} confirmLabel={targetMode === 'merge' ? t('collections.mergeAction') : t('collections.moveAction')} destructive={targetMode === 'merge'} message={targetMode === 'merge' ? t('collections.mergeConfirmMessage', { source: collection.name, target: pendingTarget?.name }) : t('collections.moveConfirmMessage', { target: pendingTarget?.name })} onCancel={() => { if (!isMembershipMutation) { setPendingTarget(null); setTargetMode(null); } }} onConfirm={() => void confirmTargetAction()} title={targetMode === 'merge' ? t('collections.mergeTitle') : t('collections.moveTitle')} visible={pendingTarget !== null} />
      <CollectionParticipantsSheet
        authenticatedRequest={authenticatedRequest}
        collectionId={collectionId}
        onChanged={loadCollection}
        onClose={() => setIsParticipantsSheetVisible(false)}
        runUnlocked={runUnlocked}
        // Stepped aside while the password prompt is up (one modal at a time on iOS); it returns
        // after the unlock - with the resumed action running - or after a cancel.
        visible={isParticipantsSheetVisible && pendingUnlockAction === null}
      />
      {notice ? <ConfirmDialog confirmLabel={t('common.confirm')} message={notice} onConfirm={() => setNotice(null)} title={t('common.notice')} visible /> : null}
    </StackScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  unlockOverlay: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  unlockCancel: {
    alignItems: 'center',
    alignSelf: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.lg,
  },
  unlockCancelLabel: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '600',
  },
  sharedByRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  sharedByText: {
    color: colors.textSecondary,
    flexShrink: 1,
    fontSize: 13,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  // flex:1 inside StackScreenSafeArea's bottom-inset padding - the list viewport itself ends above
  // the system nav bar, for List and Grid alike (see StackScreenSafeArea's own remarks).
  list: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  // paddingTop is intentionally smaller than the other three sides - the navigation header above
  // already reserves its own vertical rhythm/elevation, so a full 24 on top read as an extra gap
  // beneath it (see this round's "content starts slightly higher" request). Horizontal/bottom stay
  // at the same 24 the rest of the screen (and other Juple detail screens) already use.
  content: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  // Top-aligned (not flex-end) - the title wraps to at most two lines (see `title` below).
  headerTitleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  // Spacing wrapper only - CategoryIconTile owns its own size/background/radius (see
  // CategoryIconTile.tsx) so this Collection's icon renders identically here, in the Categories
  // list, and in the New Link Review/Item Details category picker. The header previously showed
  // no icon at all. Sits beside the title's own line-height, never competing with it for space
  // (title still gets flex: 1 below).
  headerIconBadge: {
    marginEnd: spacing.sm,
    marginTop: 2,
  },
  // At most two lines, then "…" (numberOfLines/ellipsizeMode on the Text) - even a name with no
  // spaces at all; flexShrink/minWidth keep it from pushing the icon or the lock out of the row.
  title: {
    color: colors.textPrimary,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    fontSize: 22,
    fontWeight: '800',
  },
  // Item count on the start edge, the favorite/share/⋯ icons pinned to the end edge - a second row
  // below the title/favorite row (see this round's "개수 오른쪽 끝" header layout requirement).
  headerMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  itemCount: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    marginStart: spacing.sm,
  },
  // Icon-only, no border box (see this round's "버튼마다 큰 border box를 만들지 말 것") - the
  // Pressable itself is the full min touch target even though the icon drawn inside it is
  // visually compact (size=20), so the tappable area never shrinks below 44x44dp.
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
  },
  error: {
    color: '#B42318',
    fontSize: 14,
    marginTop: 12,
  },
  // Exactly Home's own `card` (see DailyInboxScreen) - passed as SwipeableItemRow's containerStyle,
  // the same way Home/History use it.
  row: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.sm + 2,
  },
  // Mirrors DailyInboxScreen's identical gridCard - 2 columns, no card border/background (the
  // thumbnail itself is the visual focus, matching Category tile's "icon + name" density).
  gridCard: { flexBasis: '50%', marginTop: spacing.sm, paddingHorizontal: 2 },
  // A tile inside a date card's grid row: the row cell (gridCard) already spaces it.
  gridCardInner: { flex: 1 },
  selectionMark: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    position: 'absolute',
    start: spacing.xs,
    top: spacing.xs,
    width: 22,
  },
  selectionMarkSelected: { backgroundColor: colors.brand, borderColor: colors.brand },
  selectionBar: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopColor: colors.divider,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  selectionCount: { color: colors.textPrimary, flex: 1, flexShrink: 1, fontSize: 15, fontWeight: '600' },
  selectionButton: {
    alignItems: 'center',
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  selectionCancelLabel: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  selectionPrimary: { backgroundColor: colors.brand },
  selectionPrimaryLabel: { color: colors.surface, fontSize: 15, fontWeight: '700' },
  skeletonRow: { overflow: 'hidden' },
  sortRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  sortRowSpacer: { flex: 1 },
  sortChip: {
    borderColor: colors.inputBorder,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
  },
  sortChipSelected: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  sortChipLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  sortChipLabelSelected: {
    color: colors.surface,
  },
  disabledButton: {
    opacity: 0.5,
  },
});
