import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import DragList from 'react-native-draglist';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import i18n from '../i18n';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { syncCategorySnapshotToNative } from '../categories/categorySnapshotSync';
import {
  deleteCollection,
  enableCollectionShare,
  getCollection,
  getCollectionShare,
  moveCollectionItem,
  removeItemFromCollection,
  renameCollection,
  revokeCollectionShare,
  setCollectionFavorite,
  type Collection,
  type CollectionItemEntry,
  type CollectionShare,
} from '../collections/api/collectionsApi';
import { useCollectionItems } from '../collections/useCollectionItems';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SwipeableItemRow } from '../components/SwipeableItemRow';
import { closeOpenRow } from '../components/swipeableRowCoordinator';
import { EditIcon } from '../icons/EditIcon';
import { ShareIcon } from '../icons/ShareIcon';
import { StarIcon } from '../icons/StarIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { ItemRepresentativeThumbnail } from '../images/ItemRepresentativeThumbnail';
import { shareItem } from '../items/shareItem';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';

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

function formatAddedTime(addedAtUtc: string): string {
  return new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(addedAtUtc));
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
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

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

  const [pendingUnlinkItemId, setPendingUnlinkItemId] = useState<number | null>(null);

  const [isReordering, setIsReordering] = useState(false);
  const [isReorderErrorVisible, setIsReorderErrorVisible] = useState(false);
  // Synchronous guard against a second drag being dropped while the first move's API call is
  // still in flight - isReordering (state) drives the disabled UI, this ref is what the handler
  // itself checks, since a state update is not guaranteed to have committed before the next call.
  const isReorderingRef = useRef(false);

  const {
    items,
    isLoading,
    isRefreshing,
    isLoadingMore,
    error,
    refresh,
    loadMore,
    removeLocally,
    reorderLocally,
    restoreOrder,
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
    setIsEditingName(true);
    setRenameError(null);
  };

  const cancelEditName = () => {
    if (isRenaming) {
      return;
    }
    setIsEditingName(false);
    setRenameError(null);
  };

  const submitRename = async () => {
    if (isRenaming) {
      return;
    }

    const validationError = getNameValidationError(nameDraft, t);
    if (validationError) {
      setRenameError(validationError);
      return;
    }
    const trimmedName = nameDraft.trim();

    setIsRenaming(true);
    setRenameError(null);
    try {
      await renameCollection(authenticatedRequest, collectionId, trimmedName);
      setCollection(previous => (previous ? { ...previous, name: trimmedName } : previous));
      setIsEditingName(false);
      syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
    } catch (caughtError) {
      setRenameError(getRenameErrorMessage(caughtError, t));
    } finally {
      setIsRenaming(false);
    }
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

  /**
   * Drops a drag at toIndex (react-native-draglist's own from/to-index contract - splice out at
   * fromIndex, splice back in at toIndex, in that order). Reorders the in-memory list immediately
   * (optimistic), fires the one anchor-based move call, and rolls back to the exact prior order on
   * failure - never a partial/guessed order. A second reorder dropped while one is still in flight
   * is ignored outright (no queue) - see isReorderingRef.
   */
  const handleReordered = async (fromIndex: number, toIndex: number) => {
    if (isReorderingRef.current || fromIndex === toIndex) {
      return;
    }
    const movingItem = items[fromIndex];
    if (!movingItem) {
      return;
    }

    const reordered = [...items];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const afterItemId = toIndex === 0 ? null : reordered[toIndex - 1].itemId;

    isReorderingRef.current = true;
    setIsReordering(true);
    const previousItems = reorderLocally(movingItem.itemId, afterItemId);
    try {
      await moveCollectionItem(authenticatedRequest, collectionId, movingItem.itemId, afterItemId);
    } catch {
      restoreOrder(previousItems);
      setIsReorderErrorVisible(true);
    } finally {
      isReorderingRef.current = false;
      setIsReordering(false);
    }
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
      <DragList
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}
        data={[...items]}
        keyExtractor={(item: CollectionItemEntry) => item.itemId.toString()}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        onReordered={handleReordered}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
        ListHeaderComponent={
          <View>
            {isEditingName ? (
              <View>
                <TextInput
                  autoFocus
                  editable={!isRenaming}
                  onChangeText={setNameDraft}
                  style={styles.nameInput}
                  value={nameDraft}
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
                  <Text style={styles.title}>{collection.name}</Text>
                  <View style={styles.headerActions}>
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
                  </View>
                </View>
                <Text style={styles.itemCount}>
                  {t('collections.itemCount', { count: collection.itemCount })}
                </Text>
              </View>
            )}
            {renameError ? <Text style={styles.error}>{renameError}</Text> : null}
            {favoriteToggleError ? <Text style={styles.error}>{favoriteToggleError}</Text> : null}
            {deleteError ? <Text style={styles.error}>{deleteError}</Text> : null}

            <View style={styles.shareSection}>
              <View style={styles.shareToggleRow}>
                <Text style={styles.shareToggleLabel}>{t('collections.publicShareLabel')}</Text>
                <Switch
                  disabled={isManagingShare}
                  onValueChange={handleShareToggle}
                  value={share !== null}
                />
              </View>
              <Text style={styles.shareDescription}>{t('collections.publicShareDescription')}</Text>
            </View>
            {shareManagementError ? <Text style={styles.error}>{shareManagementError}</Text> : null}

            {collectionError ? <Text style={styles.error}>{collectionError}</Text> : null}
            {removeError ? <Text style={styles.error}>{removeError}</Text> : null}
            {shareError ? <Text style={styles.error}>{shareError}</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          !isLoading && !error ? <Text style={styles.empty}>{t('collections.itemsEmpty')}</Text> : undefined
        }
        onScrollBeginDrag={closeOpenRow}
        renderItem={({ item, index, onDragStart, onDragEnd, isActive }) => {
          const rowDisabled = itemActionInFlightId !== null || isRefreshing || isReordering;
          return (
            <View style={[styles.row, isActive && styles.rowActive]}>
              <Pressable
                accessibilityLabel={t('collections.reorderHandleA11yLabel', { position: index + 1 })}
                accessibilityRole="button"
                delayLongPress={350}
                disabled={rowDisabled}
                onLongPress={onDragStart}
                onPressOut={isActive ? onDragEnd : undefined}
                style={styles.numberBadge}
              >
                <Text style={styles.numberBadgeLabel}>{index + 1}</Text>
              </Pressable>
              <View style={styles.rowSwipeWrapper}>
                <SwipeableItemRow
                  disabled={itemActionInFlightId !== null || isRefreshing}
                  onDelete={() => confirmUnlinkItem(item.itemId)}
                  onPress={() => {
                    navigation.navigate('ItemDetails', { itemId: item.itemId });
                  }}
                  onShare={() => shareItemAction(item)}
                >
                  <CollectionItemContent item={item} />
                </SwipeableItemRow>
              </View>
            </View>
          );
        }}
        ListFooterComponent={
          isLoadingMore ? (
            <View style={styles.footerLoading}>
              <ActivityIndicator />
            </View>
          ) : undefined
        }
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
      <ConfirmDialog
        confirmLabel={t('common.confirm')}
        destructive={false}
        message={t('collections.errorReorderFallback')}
        onConfirm={() => setIsReorderErrorVisible(false)}
        title={t('collections.errorReorderTitle')}
        visible={isReorderErrorVisible}
      />
    </View>
  );
}

interface CollectionItemContentProps {
  readonly item: CollectionItemEntry;
}

/**
 * Mirrors SavedLinkRow's visual language (Home/History - see components/SavedLinkRow.tsx) so
 * Category rows read as the same kind of row as the rest of the app: thumbnail, title primary /
 * URL secondary, memo, added time. The leading position number is a sibling handle rendered by
 * the caller (see CollectionDetailsScreen's renderItem), not this component - it must sit outside
 * SwipeableItemRow so its long-press-to-drag gesture never competes with the swipe gesture.
 */
function CollectionItemContent({ item }: CollectionItemContentProps) {
  return (
    <View style={styles.rowContent}>
      <ItemRepresentativeThumbnail representativeImage={item.representativeImage} />
      <View style={styles.rowTextColumn}>
        {/* item.title is the user's own text (any language/direction) when present; the fallback
            to item.url below is a technical identifier and needs LTR isolation the same way
            SavedLinkRow's equivalent fallback does. */}
        <Text numberOfLines={2} style={[styles.url, !item.title && ltrTextStyle]}>
          {item.title ?? item.url}
        </Text>
        {item.title ? (
          <Text numberOfLines={1} style={[styles.secondaryUrl, ltrTextStyle]}>
            {item.url}
          </Text>
        ) : null}
        {item.memo ? (
          <Text numberOfLines={2} style={styles.memoPreview}>
            {item.memo}
          </Text>
        ) : null}
        <Text style={styles.addedTime}>{formatAddedTime(item.addedAtUtc)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
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
  // No numberOfLines/ellipsizeMode - a long or foreign-language category name must be fully
  // readable, never truncated (see this round's "long title must NOT be truncated").
  title: {
    flex: 1,
    flexShrink: 1,
    fontSize: 22,
    fontWeight: '700',
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
  nameInput: {
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 20,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 10,
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
  itemCount: {
    color: '#666666',
    fontSize: 14,
    marginTop: spacing.xs,
  },
  shareSection: {
    marginTop: spacing.md,
  },
  shareToggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  shareToggleLabel: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  shareDescription: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  error: {
    color: '#B42318',
    fontSize: 14,
    marginTop: 12,
  },
  empty: {
    color: '#666666',
    fontSize: 14,
    paddingVertical: 16,
  },
  // Card treatment matching Home/History (see DailyInboxScreen's `card`/DateHistoryScreen's
  // `historyCard`) - a rounded, bordered card with a real margin, rather than the old edge-to-edge
  // top-border-only divider that read as a clipped rectangle. Now the outer container for the
  // whole row unit (number handle + swipeable content) rather than just SwipeableItemRow's own
  // wrapper, since the handle must be a layout sibling of SwipeableItemRow, not nested inside it -
  // see CollectionDetailsScreen's renderItem.
  row: {
    alignItems: 'stretch',
    borderColor: colors.divider,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  // Clearly visible while a row is the active drag target - a colored border plus a real
  // elevation/shadow lift, not just a faint tint, so the dragged row never reads as having
  // vanished mid-drag.
  rowActive: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.brand,
    borderWidth: 2,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  rowSwipeWrapper: {
    flex: 1,
  },
  rowContent: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  // The drag handle - long-press starts a reorder (see renderItem's onLongPress={onDragStart}).
  // A sibling of SwipeableItemRow, not a child, so its touches never enter SwipeableItemRow's own
  // PanResponder region and vice versa (see components/SwipeableItemRow.tsx's own remarks on this
  // exact composition pattern).
  numberBadge: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    width: minTouchTarget,
  },
  numberBadgeLabel: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  rowTextColumn: {
    flex: 1,
    marginStart: spacing.sm,
  },
  url: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryUrl: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  memoPreview: {
    color: colors.textSecondary,
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  addedTime: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  disabledButton: {
    opacity: 0.5,
  },
  footerLoading: {
    paddingVertical: 20,
  },
});
