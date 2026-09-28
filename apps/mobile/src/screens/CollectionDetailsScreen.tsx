import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  SectionList,
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
  getCollection,
  getCollections,
  mergeCollection,
  removeItemFromCollection,
  renameCollection,
  restoreCollection,
  setCollectionColor,
  setCollectionFavorite,
  setCollectionIcon,
  transferCollectionItem,
  undoCollectionMerge,
  undoTransferCollectionItem,
  type Collection,
  type CollectionItemEntry,
} from '../collections/api/collectionsApi';
import { CategoryEditorDialog } from '../collections/CategoryEditorDialog';
import { isCollectionLocked, isSharedWithMe } from '../collections/collectionAccess';
import { formatItemAdder, shouldShowItemAdders } from '../collections/itemAdder';
import { CollectionLockDialog, type CollectionLockDialogMode } from '../collections/CollectionLockDialog';
import { beginCollectionVisit, getCollectionUnlockToken } from '../collections/collectionUnlockGrants';
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
import { isCollectionLockedError, NAME_ORDER_MAX_LINKS, useCollectionItems } from '../collections/useCollectionItems';
import { CenteredEmptyState } from '../components/CenteredEmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { useAppToast } from '../components/AppToast';
import { useToastBottomAnchor } from '../components/useToastBottomAnchor';
import { ActionMenuDialog } from '../components/ActionMenuDialog';
import { SavedLinkGridCard } from '../components/SavedLinkGridCard';
import { SavedLinkRow } from '../components/SavedLinkRow';
import { SwipeableItemRow } from '../components/SwipeableItemRow';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { closeOpenRow } from '../components/swipeableRowCoordinator';
import { DateSectionHeader, dateAccordionStyles } from '../components/DateAccordion';
import { useNearEndLoadMore } from '../components/useNearEndLoadMore';
import { EditIcon } from '../icons/EditIcon';
import { LockIcon } from '../icons/LockIcon';
import { PeopleIcon } from '../icons/PeopleIcon';
import { ShareIcon } from '../icons/ShareIcon';
import { StarIcon } from '../icons/StarIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { MoreIcon } from '../icons/MoreIcon';
import { CollectionTargetPickerDialog } from '../collections/CollectionTargetPickerDialog';
import { groupCollectionItemsByDate, sortCollectionItemsByName } from '../collections/sortCollectionItems';
import type { ItemHistoryEntry } from '../items/api/itemsApi';
import { todayDateKey } from '../items/historyDateGrouping';
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
  const [targetMode, setTargetMode] = useState<'add' | 'move' | 'merge' | null>(null);
  const [targetCollections, setTargetCollections] = useState<readonly Collection[]>([]);
  const [targetNextCursor, setTargetNextCursor] = useState<string | null>(null);
  const [isLoadingMoreTargets, setIsLoadingMoreTargets] = useState(false);
  const loadingMoreTargetsRef = useRef(false);
  const [isLoadingTargets, setIsLoadingTargets] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<Collection | null>(null);
  const [isMembershipMutation, setIsMembershipMutation] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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
  // 일자순 (newest ↓ / oldest ↑) is ordered by the server over the whole Collection and paged as
  // the list scrolls; 이름순 loads the whole Collection first and sorts it here.
  const dateSortDirection = effectiveSort === 'title' ? null : effectiveSort;

  const {
    items,
    isLoading,
    isRefreshing,
    isLoadingMore,
    error,
    isLocked: isContentLocked,
    hasMore,
    isTooLargeForNameOrder,
    refresh,
    loadMore,
    removeLocally,
  } = useCollectionItems(collectionId, dateSortDirection === null ? 'whole' : dateSortDirection === 'oldest' ? 'dateAsc' : 'dateDesc');

  useEffect(() => {
    if (isTooLargeForNameOrder) {
      setIsNameOrderTooLarge(true);
      setNotice(t('collections.sortNameTooLarge', { max: NAME_ORDER_MAX_LINKS }));
    }
  }, [isTooLargeForNameOrder, t]);

  // Name order only ever over the whole Collection (the 'whole' load publishes nothing until every
  // link is in); date order exactly as the server returned it - never re-sorted here.
  const displayedItems = useMemo(
    () => (dateSortDirection === null ? sortCollectionItemsByName(items) : items),
    [dateSortDirection, items],
  );
  const dateSections = useMemo(
    () => (dateSortDirection ? groupCollectionItemsByDate(items, dateSortDirection === 'oldest' ? 'dateAsc' : 'dateDesc', t) : []),
    [dateSortDirection, items, t],
  );
  // Which date sections are open - chosen once (today's, else the first), then only by the user: a
  // refresh, a page that loads more, a removed link or flipping ↓/↑ never resets it (section keys
  // are the same in both directions).
  const [expandedDateKeys, setExpandedDateKeys] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (expandedDateKeys !== null || dateSections.length === 0) {
      return;
    }
    const initialKey = dateSections.find(section => section.dateKey === todayDateKey())?.dateKey ?? dateSections[0]?.dateKey;
    if (initialKey) {
      setExpandedDateKeys(new Set([initialKey]));
    }
  }, [dateSections, expandedDateKeys]);
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
  // Collapsed dates can absorb a whole page without the list growing - keep paging near the end.
  const nearEndLoadMore = useNearEndLoadMore({ hasMore, isLoadingMore, loadedCount: items.length, loadMore });
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

  const openTargetPicker = async (mode: 'add' | 'move' | 'merge') => {
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
    if (targetMode === 'add') { void addToTarget(target); return; }
    setPendingTarget(target);
  };

  const addToTarget = async (target: Collection) => {
    if (!actionMenuItem || isMembershipMutation) return;
    setIsMembershipMutation(true); setTargetMode(null);
    try { await addItemToCollection(authenticatedRequest, target.id, actionMenuItem.itemId); showNotificationToast(t('collections.addSuccess')); }
    catch (caughtError) { setNotice(t(isCollectionLockedError(caughtError) ? 'collections.lockRequiredForAction' : 'collections.addError')); }
    finally { setActionMenuItem(null); setTargetMode(null); setIsMembershipMutation(false); }
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
      if (isCollectionLockedError(caughtError)) setNotice(t('collections.lockRequiredForAction'));
      else setNotice(t(targetMode === 'merge' ? 'collections.mergeError' : 'collections.moveError'));
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

  const listHeader = (
    <View>
      <View>
          <View style={styles.headerTitleRow}>
            <View style={styles.headerIconBadge}>
              <CategoryIconTile collectionId={collection.id} color={collection.color} icon={collection.icon} imageUrl={collection.iconImageUrl} imageVersion={collection.iconImageVersion} size={32} />
            </View>
            <Text style={styles.title}>{collection.name}</Text>
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
            {isOwner ? (
            <>
              <Pressable accessibilityLabel={t('common.edit')} accessibilityRole="button" onPress={() => runUnlocked(openEditDialog)} style={styles.iconButton} testID="collection-details-edit">
                <EditIcon color={colors.textPrimary} size={20} />
              </Pressable>
              {/* The single entry point for sharing - opens the one Share screen;
                  tapping it never turns anything on by itself. */}
              <Pressable
                accessibilityLabel={t('collections.shareAction')}
                accessibilityRole="button"
                onPress={() => runUnlocked(() => navigation.navigate('CollectionShare', { collectionId }))}
                style={styles.iconButton}
                testID="collection-details-share"
              >
                <ShareIcon color={colors.textPrimary} size={20} />
              </Pressable>
              <Pressable accessibilityLabel={t('collections.manageAction')} accessibilityRole="button" onPress={() => setIsCollectionMenuVisible(true)} style={styles.iconButton}><MoreIcon color={colors.textSecondary} size={20} /></Pressable>
              <Pressable
                accessibilityLabel={t('common.delete')}
                accessibilityRole="button"
                accessibilityState={{ disabled: isDeletingCollection, busy: isDeletingCollection }}
                disabled={isDeletingCollection}
                onPress={() => runUnlocked(confirmDeleteCollection)}
                testID="collection-details-delete"
                style={[styles.iconButton, isDeletingCollection && styles.disabledButton]}
              >
                <TrashIcon color={colors.danger} size={20} />
              </Pressable>
            </>
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

  const listEmpty = isContentLocked ? (
    <CollectionUnlockPanel collectionId={collectionId} isOwner={isOwner} onUnlocked={refresh} />
  ) : isLoading ? (
    <ActivityIndicator style={styles.listLoading} testID="collection-items-loading" />
  ) : !error ? <CenteredEmptyState message={t('collections.itemsEmpty')} /> : undefined;

  const listFooter = isLoadingMore ? (
    <View style={styles.footerLoading}>
      <ActivityIndicator />
    </View>
  ) : undefined;

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      {dateSortDirection && !isContentLocked ? (
        <SectionList
          key={viewMode}
          contentContainerStyle={styles.content}
          style={styles.list}
          sections={dateSections.map(section => ({
            ...section,
            data: viewMode === 'list' && expandedDateKeys?.has(section.dateKey) ? section.items : [],
          }))}
          keyExtractor={(item: CollectionItemEntry) => item.itemId.toString()}
          {...nearEndLoadMore}
          onEndReached={loadMore}
          onEndReachedThreshold={1}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
          onScrollBeginDrag={closeOpenRow}
          renderSectionHeader={({ section }) => (
            <DateSectionHeader
              count={section.items.length}
              isExpanded={expandedDateKeys?.has(section.dateKey) ?? false}
              label={section.label}
              onPress={() => toggleDateSection(section.dateKey)}
            />
          )}
          renderItem={({ item, index, section }) =>
            renderCollectionItem(item, [dateAccordionStyles.row, index === section.data.length - 1 && dateAccordionStyles.rowLast])
          }
          renderSectionFooter={({ section }) =>
            viewMode === 'grid' && expandedDateKeys?.has(section.dateKey) ? (
              <View style={dateAccordionStyles.gridBody} testID={`collection-date-grid-${section.dateKey}`}>
                <View style={dateAccordionStyles.gridWrap}>
                  {section.items.map(item => <Fragment key={item.itemId}>{renderCollectionItem(item, styles.gridCard)}</Fragment>)}
                </View>
              </View>
            ) : null
          }
          ListFooterComponent={listFooter}
        />
      ) : (
        <FlatList
          key={viewMode}
          contentContainerStyle={styles.content}
          style={styles.list}
          data={isContentLocked ? [] : displayedItems}
          keyExtractor={(item: CollectionItemEntry) => item.itemId.toString()}
          numColumns={viewMode === 'grid' ? 2 : 1}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
          onScrollBeginDrag={closeOpenRow}
          renderItem={({ item }) => renderCollectionItem(item)}
          ListFooterComponent={listFooter}
        />
      )}
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
      <ActionMenuDialog actions={[{ label: t('collections.addToOther'), onPress: () => void openTargetPicker('add') }, ...(collection.hasCollaborators ? [] : [{ label: t('collections.moveToOther'), onPress: () => void openTargetPicker('move') }])]} cancelLabel={t('common.cancel')} onCancel={() => { setIsItemActionMenuVisible(false); setActionMenuItem(null); }} visible={isItemActionMenuVisible} />
      <ActionMenuDialog
        actions={[
          // The lock password itself is managed only in Settings > 컬렉션 잠금 - here a Collection is
          // just locked (a confirmation) or unlocked (that password).
          ...(isCollectionLocked(collection)
            ? [
                {
                  label: t('collections.lockRemoveAction'),
                  destructive: true,
                  onPress: () => {
                    setIsCollectionMenuVisible(false);
                    setLockDialogMode('remove');
                  },
                },
              ]
            : [
                {
                  label: t('collections.lockSetTitle'),
                  onPress: () => {
                    setIsCollectionMenuVisible(false);
                    setLockDialogMode('lock');
                  },
                },
              ]),
          // Merging moves this Category's links, so it is offered only once its content is unlocked.
          ...(collection.hasCollaborators || isContentLocked ? [] : [{ label: t('collections.mergeWithOther'), onPress: () => void openTargetPicker('merge') }]),
        ]}
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
  // Top-aligned (not flex-end) - the title is now allowed to wrap to as many lines as it needs
  // (no numberOfLines cap, see `title` below), so pinning the action icons to the top keeps them
  // right under the nav header at a fixed position instead of drifting further down every time a
  // longer name adds another line.
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
  // No numberOfLines/ellipsizeMode - a long or foreign-language category name must be fully
  // readable, never truncated (see this round's "long title must NOT be truncated").
  title: {
    color: colors.textPrimary,
    flex: 1,
    flexShrink: 1,
    fontSize: 22,
    fontWeight: '800',
  },
  // Item count on the start edge, share/edit/delete icons pinned to the end edge - a second row
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
  footerLoading: {
    paddingVertical: 20,
  },
  listLoading: {
    paddingVertical: spacing.xl,
  },
});
