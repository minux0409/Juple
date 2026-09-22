import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { syncCategorySnapshotToNative } from '../categories/categorySnapshotSync';
import {
  deleteCollection,
  addItemToCollection,
  enableCollectionShare,
  getCollection,
  getCollectionShare,
  getCollections,
  mergeCollection,
  removeItemFromCollection,
  renameCollection,
  revokeCollectionShare,
  setCollectionColor,
  setCollectionFavorite,
  setCollectionIcon,
  transferCollectionItem,
  undoTransferCollectionItem,
  type Collection,
  type CollectionItemEntry,
  type CollectionShare,
} from '../collections/api/collectionsApi';
import { CategoryIconTile } from '../collections/CategoryIconTile';
import { CategoryNameAndIconField } from '../collections/CategoryNameAndIconField';
import {
  DEFAULT_COLLECTION_COLOR,
  resolveEffectiveCollectionColorKey,
  type CollectionColorKey,
} from '../collections/collectionColors';
import { DEFAULT_COLLECTION_ICON, resolveCollectionIconKey, type CollectionIconKey } from '../collections/collectionIcons';
import { useCollectionItems } from '../collections/useCollectionItems';
import { CenteredEmptyState } from '../components/CenteredEmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { NotificationToast } from '../components/NotificationToast';
import { UndoToast } from '../components/UndoToast';
import { ActionMenuDialog } from '../components/ActionMenuDialog';
import { SavedLinkRow } from '../components/SavedLinkRow';
import { SwipeableItemRow } from '../components/SwipeableItemRow';
import { closeOpenRow } from '../components/swipeableRowCoordinator';
import { EditIcon } from '../icons/EditIcon';
import { GlobeIcon } from '../icons/GlobeIcon';
import { InfoIcon } from '../icons/InfoIcon';
import { ShareIcon } from '../icons/ShareIcon';
import { StarIcon } from '../icons/StarIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { MoreIcon } from '../icons/MoreIcon';
import { CollectionTargetPickerDialog } from '../collections/CollectionTargetPickerDialog';
import type { ItemHistoryEntry } from '../items/api/itemsApi';
import { shareItem } from '../items/shareItem';
import type { RootStackParamList } from '../navigation/RootStack';
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
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('collections.errorIconUpdateFallback');
}

function getColorUpdateErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('collections.errorColorUpdateFallback');
}

function getDeleteErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('collections.errorDeleteFallback');
}

function getRemoveItemErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('collections.errorRemoveItemFallback');
}

function getFavoriteToggleErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('collections.errorFavoriteToggleFallback');
}

/**
 * ApiError here means the enable/revoke management call itself failed - a non-ApiError means
 * Share.share (the OS Share Sheet) threw after a successful enable, so reuses the same message as
 * the per-item quick-share failure (item.shareError) since it is the exact same failure mode.
 */
function getShareManagementErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
    return t('collections.errorShareManagementFallback');
  }
  return t('item.shareError');
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
  // A stack screen, not a tab screen - there is no Juple tab bar below it reserving the system
  // nav/gesture-area inset for itself, so (unlike the tab screens) this needs the raw inset
  // directly, the same way ItemDetailsScreen/NewLinkReviewScreen already do.
  const insets = useSafeAreaInsets();

  const [collection, setCollection] = useState<Collection | null>(null);
  const [isLoadingCollection, setIsLoadingCollection] = useState(true);
  const [collectionError, setCollectionError] = useState<string | null>(null);

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [iconDraft, setIconDraft] = useState<CollectionIconKey>(DEFAULT_COLLECTION_ICON);
  const [colorDraft, setColorDraft] = useState<CollectionColorKey>(DEFAULT_COLLECTION_COLOR);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  // Shown via the shared single-button ConfirmDialog (a notice, not inline near the Save/Cancel
  // buttons like renameError) - a color-update failure is otherwise easy to miss.
  const [colorUpdateError, setColorUpdateError] = useState<string | null>(null);

  const [isDeletingCollection, setIsDeletingCollection] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleteConfirmVisible, setIsDeleteConfirmVisible] = useState(false);

  // Mirrors DailyInboxScreen/DateHistoryScreen's SwipeableItemRow usage: one shared in-flight id
  // disables every row's swipe actions while any single row's share/remove is running.
  const [itemActionInFlightId, setItemActionInFlightId] = useState<number | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false);
  const [favoriteToggleError, setFavoriteToggleError] = useState<string | null>(null);

  const [share, setShare] = useState<CollectionShare | null>(null);
  const [isManagingShare, setIsManagingShare] = useState(false);
  const [shareManagementError, setShareManagementError] = useState<string | null>(null);
  const [isUnshareConfirmVisible, setIsUnshareConfirmVisible] = useState(false);
  // Purely presentational - the help text itself (publicShareDescription) is unchanged, only
  // whether it's shown inline below the row is toggled by tapping the info icon.
  const [isShareInfoExpanded, setIsShareInfoExpanded] = useState(false);

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
  const [notification, setNotification] = useState<string | null>(null);
  const [pendingMoveUndo, setPendingMoveUndo] = useState<{ readonly itemId: number; readonly targetCollectionId: number; readonly targetMembershipCreated: boolean } | null>(null);
  const [isUndoingMove, setIsUndoingMove] = useState(false);
  const isUndoingMoveRef = useRef(false);
  const [pendingUnlinkUndo, setPendingUnlinkUndo] = useState<number | null>(null);
  const [isUndoingUnlink, setIsUndoingUnlink] = useState(false);
  const isUndoingUnlinkRef = useRef(false);

  const {
    items,
    isLoading,
    isRefreshing,
    isLoadingMore,
    error,
    refresh,
    loadMore,
    removeLocally,
  } = useCollectionItems(collectionId);

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

  const loadShareStatus = useCallback(async () => {
    try {
      const activeShare = await getCollectionShare(authenticatedRequest, collectionId);
      setShare(activeShare);
    } catch {
      // A failed background status check is not worth its own error banner - the share
      // buttons below stay usable either way: EnableShareAsync is idempotent, so tapping
      // "share" still safely resolves to whatever the server's actual current state is.
    }
  }, [authenticatedRequest, collectionId]);

  // Refetches the Collection's own metadata (Name/ItemCount) on every focus - entirely independent
  // of useCollectionItems' own focus-driven Item list load, mirroring ItemDetailsScreen's
  // Purchases/RepeatPurchases independence. Share status is fetched the same independent way.
  useFocusEffect(
    useCallback(() => {
      loadCollection();
      loadShareStatus();
    }, [loadCollection, loadShareStatus]),
  );

  const startEditName = () => {
    if (!collection || isRenaming) {
      return;
    }
    setNameDraft(collection.name);
    setIconDraft(resolveCollectionIconKey(collection.icon));
    setColorDraft(resolveEffectiveCollectionColorKey(collection.color, collection.id));
    setIsEditingName(true);
    setRenameError(null);
    setColorUpdateError(null);
  };

  const cancelEditName = () => {
    if (isRenaming) {
      return;
    }
    setIsEditingName(false);
    setRenameError(null);
    setColorUpdateError(null);
  };

  /**
   * Saves the name/icon/color edit fields together (one Save button - see the edit form below), but
   * calls their independent endpoints sequentially, never via Promise.all: all three mutate the same
   * Collection row's RowVersion (see backend CollectionStore.RenameAsync/SetIconAsync/SetColorAsync),
   * so firing them concurrently risks one losing an optimistic-concurrency race against another. A
   * name change that succeeds followed by an icon or color change that fails is left applied (not
   * rolled back) - the same "each attribute is its own independent action" contract this screen's
   * favorite/share/delete actions already follow, not an all-or-nothing transaction.
   */
  const submitRename = async () => {
    if (isRenaming || !collection) {
      return;
    }

    const validationError = getNameValidationError(nameDraft, t);
    if (validationError) {
      setRenameError(validationError);
      return;
    }
    const trimmedName = nameDraft.trim();
    const nameChanged = trimmedName !== collection.name;
    const iconChanged = iconDraft !== resolveCollectionIconKey(collection.icon);
    const colorChanged = colorDraft !== resolveEffectiveCollectionColorKey(collection.color, collection.id);

    if (!nameChanged && !iconChanged && !colorChanged) {
      setIsEditingName(false);
      return;
    }

    setIsRenaming(true);
    setRenameError(null);
    setColorUpdateError(null);

    if (nameChanged) {
      try {
        await renameCollection(authenticatedRequest, collectionId, trimmedName);
        setCollection(previous => (previous ? { ...previous, name: trimmedName } : previous));
      } catch (caughtError) {
        setRenameError(getRenameErrorMessage(caughtError, t));
        setIsRenaming(false);
        return;
      }
    }

    if (iconChanged) {
      try {
        const updated = await setCollectionIcon(authenticatedRequest, collectionId, iconDraft);
        setCollection(updated);
      } catch (caughtError) {
        setRenameError(getIconUpdateErrorMessage(caughtError, t));
        setIsRenaming(false);
        return;
      }
    }

    if (colorChanged) {
      try {
        const updated = await setCollectionColor(authenticatedRequest, collectionId, colorDraft);
        setCollection(updated);
      } catch (caughtError) {
        setColorUpdateError(getColorUpdateErrorMessage(caughtError, t));
        setIsRenaming(false);
        return;
      }
    }

    setIsEditingName(false);
    syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
    setIsRenaming(false);
  };

  const deleteCollectionAction = async () => {
    if (isDeletingCollection) {
      return;
    }

    setIsDeletingCollection(true);
    setDeleteError(null);
    try {
      await deleteCollection(authenticatedRequest, collectionId);
      syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
      navigation.goBack();
    } catch (caughtError) {
      setDeleteError(getDeleteErrorMessage(caughtError, t));
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
      setPendingMoveUndo(null);
      setPendingUnlinkUndo(itemId);
    } catch (caughtError) {
      setRemoveError(getRemoveItemErrorMessage(caughtError, t));
    } finally {
      setItemActionInFlightId(null);
    }
  };

  const undoUnlink = async () => {
    if (pendingUnlinkUndo === null || isUndoingUnlinkRef.current) return;
    isUndoingUnlinkRef.current = true;
    setIsUndoingUnlink(true);
    try {
      await addItemToCollection(authenticatedRequest, collectionId, pendingUnlinkUndo);
      setPendingUnlinkUndo(null);
      setCollection(previous => previous ? { ...previous, itemCount: previous.itemCount + 1 } : previous);
      await refresh();
    } catch {
      setPendingUnlinkUndo(null);
      setNotice(t('toast.undoUnlinkError'));
    } finally {
      isUndoingUnlinkRef.current = false;
      setIsUndoingUnlink(false);
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

  /**
   * Idempotent, mirroring the Backend: if already shared, reuses the existing active link rather
   * than minting a new one. Enabling no longer also opens the OS Share Sheet - that is now the
   * separate, explicit "링크 공유" action below, so toggling the switch ON never itself triggers a
   * system share sheet.
   */
  const enableShareAction = async () => {
    if (!collection || isManagingShare) {
      return;
    }

    setIsManagingShare(true);
    setShareManagementError(null);
    try {
      const activeShare = share ?? (await enableCollectionShare(authenticatedRequest, collectionId));
      setShare(activeShare);
    } catch (caughtError) {
      setShareManagementError(getShareManagementErrorMessage(caughtError, t));
    } finally {
      setIsManagingShare(false);
    }
  };

  /** Shares the Collection's own Juple public link (never an Item's URL) via the OS Share Sheet. */
  const shareLinkAction = async () => {
    if (!collection || !share) {
      return;
    }
    try {
      await shareItem(share.shareUrl, collection.name);
    } catch {
      setShareManagementError(getShareErrorMessage(t));
    }
  };

  const revokeShareAction = async () => {
    if (isManagingShare) {
      return;
    }

    setIsManagingShare(true);
    setShareManagementError(null);
    try {
      await revokeCollectionShare(authenticatedRequest, collectionId);
      setShare(null);
    } catch (caughtError) {
      setShareManagementError(getShareManagementErrorMessage(caughtError, t));
    } finally {
      setIsManagingShare(false);
    }
  };

  const confirmUnshare = () => {
    if (isManagingShare) {
      return;
    }
    setIsUnshareConfirmVisible(true);
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
    try { await addItemToCollection(authenticatedRequest, target.id, actionMenuItem.itemId); setNotification(t('collections.addSuccess')); }
    catch { setNotice(t('collections.addError')); }
    finally { setActionMenuItem(null); setTargetMode(null); setIsMembershipMutation(false); }
  };

  const confirmTargetAction = async () => {
    if (!pendingTarget || isMembershipMutation) return;
    setIsMembershipMutation(true);
    try {
      if (targetMode === 'merge') {
        await mergeCollection(authenticatedRequest, collectionId, pendingTarget.id);
        navigation.replace('CollectionDetails', { collectionId: pendingTarget.id });
      } else if (actionMenuItem) {
        const move = await transferCollectionItem(authenticatedRequest, collectionId, actionMenuItem.itemId, pendingTarget.id);
        removeLocally(actionMenuItem.itemId);
        setCollection(previous => previous ? { ...previous, itemCount: Math.max(0, previous.itemCount - 1) } : previous);
        setPendingUnlinkUndo(null);
        setPendingMoveUndo({ itemId: actionMenuItem.itemId, targetCollectionId: pendingTarget.id, targetMembershipCreated: move.targetMembershipCreated });
      }
    } catch { setNotice(t(targetMode === 'merge' ? 'collections.mergeError' : 'collections.moveError')); }
    finally { setPendingTarget(null); setTargetMode(null); setActionMenuItem(null); setIsMembershipMutation(false); }
  };

  const undoMove = async () => {
    if (!pendingMoveUndo || isUndoingMoveRef.current) return;
    isUndoingMoveRef.current = true;
    setIsUndoingMove(true);
    try {
      await undoTransferCollectionItem(authenticatedRequest, collectionId, pendingMoveUndo.itemId, pendingMoveUndo.targetCollectionId, pendingMoveUndo.targetMembershipCreated);
      setPendingMoveUndo(null);
      setCollection(previous => previous ? { ...previous, itemCount: previous.itemCount + 1 } : previous);
      await refresh();
    } catch {
      setPendingMoveUndo(null);
      setNotice(t('toast.undoMoveError'));
    } finally { isUndoingMoveRef.current = false; setIsUndoingMove(false); }
  };

  const handleShareToggle = (value: boolean) => {
    if (value) {
      enableShareAction();
    } else {
      confirmUnshare();
    }
  };

  if (isLoadingCollection && !collection) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!collection) {
    return (
      <View style={styles.loadingContainer}>
        {collectionError ? <Text style={styles.error}>{collectionError}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.safeArea}>
      <FlatList
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}
        data={items}
        keyExtractor={(item: CollectionItemEntry) => item.itemId.toString()}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
        ListHeaderComponent={
          <View>
            {isEditingName ? (
              <View>
                <CategoryNameAndIconField
                  autoFocus
                  color={colorDraft}
                  disabled={isRenaming}
                  icon={iconDraft}
                  name={nameDraft}
                  onChangeColor={setColorDraft}
                  onChangeIcon={setIconDraft}
                  onChangeName={setNameDraft}
                />
                <View style={styles.nameEditActions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isRenaming}
                    onPress={submitRename}
                    style={styles.nameEditButton}
                  >
                    <Text style={styles.nameEditButtonLabel}>
                      {isRenaming ? t('common.saving') : t('common.save')}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isRenaming}
                    onPress={cancelEditName}
                    style={styles.nameEditButton}
                  >
                    <Text style={styles.nameEditButtonLabel}>{t('common.cancel')}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View>
                <View style={styles.headerTitleRow}>
                  <View style={styles.headerIconBadge}>
                    <CategoryIconTile collectionId={collection.id} color={collection.color} icon={collection.icon} size={32} />
                  </View>
                  <Text style={styles.title}>{collection.name}</Text>
                  <Pressable
                    accessibilityLabel={
                      collection.isFavorite ? t('collections.removeFavorite') : t('collections.addFavorite')
                    }
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isTogglingFavorite, busy: isTogglingFavorite }}
                    disabled={isTogglingFavorite}
                    onPress={toggleFavoriteAction}
                    style={styles.iconButton}
                  >
                    <StarIcon
                      color={collection.isFavorite ? colors.warning : colors.border}
                      filled={collection.isFavorite}
                      size={20}
                    />
                  </Pressable>
                </View>
                <View style={styles.headerMetaRow}>
                  <Text style={styles.itemCount}>
                    {t('collections.detailItemCount', { count: collection.itemCount })}
                  </Text>
                  <View style={styles.headerActions}>
                    {share ? (
                      <Pressable
                        accessibilityLabel={t('collections.shareAction')}
                        accessibilityRole="button"
                        onPress={shareLinkAction}
                        style={styles.iconButton}
                      >
                        <ShareIcon color={colors.textPrimary} size={20} />
                      </Pressable>
                    ) : null}
                    <Pressable
                      accessibilityLabel={t('common.edit')}
                      accessibilityRole="button"
                      onPress={startEditName}
                      style={styles.iconButton}
                    >
                      <EditIcon color={colors.textPrimary} size={20} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel={t('common.delete')}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: isDeletingCollection, busy: isDeletingCollection }}
                      disabled={isDeletingCollection}
                      onPress={confirmDeleteCollection}
                      style={[styles.iconButton, isDeletingCollection && styles.disabledButton]}
                    >
                      <TrashIcon color={colors.danger} size={20} />
                    </Pressable>
                    <Pressable accessibilityLabel={t('collections.manageAction')} accessibilityRole="button" onPress={() => setIsCollectionMenuVisible(true)} style={styles.iconButton}>
                      <MoreIcon color={colors.textSecondary} size={20} />
                    </Pressable>
                  </View>
                </View>
              </View>
            )}
            {renameError ? <Text style={styles.error}>{renameError}</Text> : null}
            {favoriteToggleError ? <Text style={styles.error}>{favoriteToggleError}</Text> : null}
            {deleteError ? <Text style={styles.error}>{deleteError}</Text> : null}

            <View style={styles.shareSection}>
              <View style={styles.shareToggleRow}>
                <GlobeIcon color={colors.textSecondary} size={16} />
                <Text style={styles.shareToggleLabel}>{t('collections.publicShareLabel')}</Text>
                <Pressable
                  accessibilityLabel={t('collections.publicShareInfoA11y')}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isShareInfoExpanded }}
                  hitSlop={8}
                  onPress={() => setIsShareInfoExpanded(previous => !previous)}
                  style={styles.shareInfoButton}
                >
                  <InfoIcon color={colors.textSecondary} size={16} />
                </Pressable>
                <View style={styles.shareToggleSpacer} />
                <Switch
                  disabled={isManagingShare}
                  onValueChange={handleShareToggle}
                  value={share !== null}
                />
              </View>
              {isShareInfoExpanded ? (
                <View style={styles.shareInfoBubble}>
                  <Text style={styles.shareDescription}>{t('collections.publicShareDescription')}</Text>
                </View>
              ) : null}
            </View>
            {shareManagementError ? <Text style={styles.error}>{shareManagementError}</Text> : null}

            {collectionError ? <Text style={styles.error}>{collectionError}</Text> : null}
            {removeError ? <Text style={styles.error}>{removeError}</Text> : null}
            {shareError ? <Text style={styles.error}>{shareError}</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          !isLoading && !error ? <CenteredEmptyState message={t('collections.itemsEmpty')} /> : undefined
        }
        onScrollBeginDrag={closeOpenRow}
        renderItem={({ item }) => (
          <SwipeableItemRow
            containerStyle={styles.row}
            disabled={itemActionInFlightId !== null || isRefreshing}
            onDelete={() => confirmUnlinkItem(item.itemId)}
            onPress={() => {
              navigation.navigate('ItemDetails', { itemId: item.itemId });
            }}
            onShare={() => shareItemAction(item)}
          >
            {/* Exactly Home/History's own row - see SavedLinkRow.tsx - so a Category's link
                cards are visually indistinguishable from the same Item's row anywhere else in
                the app. dateDisplayMode="dateTime" (not the default "time") because a Category's
                items span arbitrary dates, never a single grouped day the way a History section
                does - matches this row's own prior "always show the full date" behavior exactly. */}
            <SavedLinkRow
              dateDisplayMode="dateTime"
              isActionInFlight={itemActionInFlightId === item.itemId}
              item={toSavedLinkRowItem(item)}
              preferEffectiveThumbnail
              trailingAction={{ accessibilityLabel: t('collections.itemManageAction'), onPress: () => { setActionMenuItem(item); setIsItemActionMenuVisible(true); } }}
            />
          </SwipeableItemRow>
        )}
        ListFooterComponent={
          isLoadingMore ? (
            <View style={styles.footerLoading}>
              <ActivityIndicator />
            </View>
          ) : undefined
        }
      />
      {colorUpdateError !== null ? (
        <ConfirmDialog
          confirmLabel={t('common.confirm')}
          message={colorUpdateError}
          onConfirm={() => setColorUpdateError(null)}
          title={t('common.notice')}
          visible
        />
      ) : null}
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
        confirmLabel={t('collections.unshare')}
        message={t('collections.unshareConfirmMessage')}
        onCancel={() => setIsUnshareConfirmVisible(false)}
        onConfirm={() => {
          setIsUnshareConfirmVisible(false);
          revokeShareAction();
        }}
        title={t('collections.unshareConfirmTitle')}
        visible={isUnshareConfirmVisible}
      />
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('collections.unlinkAction')}
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
      <ActionMenuDialog actions={[{ label: t('collections.addToOther'), onPress: () => void openTargetPicker('add') }, { label: t('collections.moveToOther'), onPress: () => void openTargetPicker('move') }]} cancelLabel={t('common.cancel')} onCancel={() => { setIsItemActionMenuVisible(false); setActionMenuItem(null); }} visible={isItemActionMenuVisible} />
      <ActionMenuDialog actions={[{ label: t('collections.mergeWithOther'), onPress: () => void openTargetPicker('merge') }]} cancelLabel={t('common.cancel')} onCancel={() => setIsCollectionMenuVisible(false)} visible={isCollectionMenuVisible} />
      <CollectionTargetPickerDialog collections={targetCollections} isLoading={isLoadingTargets} isLoadingMore={isLoadingMoreTargets} onCancel={() => setTargetMode(null)} onLoadMore={loadMoreTargets} onSelect={selectTarget} visible={targetMode !== null && pendingTarget === null} />
      <ConfirmDialog cancelLabel={t('common.cancel')} confirmLabel={targetMode === 'merge' ? t('collections.mergeAction') : t('collections.moveAction')} destructive={targetMode === 'merge'} message={targetMode === 'merge' ? t('collections.mergeConfirmMessage', { source: collection.name, target: pendingTarget?.name }) : t('collections.moveConfirmMessage', { target: pendingTarget?.name })} onCancel={() => { if (!isMembershipMutation) { setPendingTarget(null); setTargetMode(null); } }} onConfirm={() => void confirmTargetAction()} title={targetMode === 'merge' ? t('collections.mergeTitle') : t('collections.moveTitle')} visible={pendingTarget !== null} />
      {notice ? <ConfirmDialog confirmLabel={t('common.confirm')} message={notice} onConfirm={() => setNotice(null)} title={t('common.notice')} visible /> : null}
      {notification ? <NotificationToast bottomOffset={insets.bottom} message={notification} onDismiss={() => setNotification(null)} /> : null}
      {pendingMoveUndo ? <UndoToast actionLabel={t('toast.undoAction')} bottomOffset={insets.bottom} isUndoing={isUndoingMove} message={t('toast.moveSuccess')} onDismiss={() => setPendingMoveUndo(null)} onUndo={() => void undoMove()} /> : null}
      {pendingUnlinkUndo !== null ? <UndoToast actionLabel={t('toast.undoAction')} bottomOffset={insets.bottom} isUndoing={isUndoingUnlink} message={t('toast.unlinkSuccess')} onDismiss={() => setPendingUnlinkUndo(null)} onUndo={() => void undoUnlink()} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
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
  nameEditActions: {
    flexDirection: 'row',
    marginTop: 10,
  },
  nameEditButton: {
    borderColor: '#9A9A9A',
    borderRadius: 6,
    borderWidth: 1,
    marginEnd: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  nameEditButtonLabel: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '600',
  },
  // Deliberately NOT the "white floating card + shadow" treatment every link/content card on this
  // screen uses (see `row` below) - a muted, low-elevation setting row reads unambiguously as
  // "설정", never mistaken for another content card. No shadow/elevation at all, and a compact
  // single-line height - the always-expanded description card this replaced is now hidden behind
  // the info icon (see isShareInfoExpanded/shareInfoBubble below), so this section takes up
  // almost no vertical space by default.
  shareSection: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  shareToggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs + 2,
    minHeight: 32,
  },
  shareToggleLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  shareInfoButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
  },
  // Pushes the Switch flush to the row's end edge regardless of label/info width.
  shareToggleSpacer: {
    flex: 1,
  },
  // The "말풍선/도움말 박스" - a muted inline panel directly under the row, only rendered while
  // isShareInfoExpanded is true. A touch lighter than the row's own surfaceMuted so it still
  // reads as a nested callout rather than blending into the row above it.
  shareInfoBubble: {
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    marginTop: spacing.xs,
    padding: spacing.sm,
  },
  shareDescription: {
    color: colors.textSecondary,
    fontSize: 12,
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
  disabledButton: {
    opacity: 0.5,
  },
  footerLoading: {
    paddingVertical: 20,
  },
});
