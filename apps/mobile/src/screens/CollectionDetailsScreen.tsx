import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
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
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { syncCategorySnapshotToNative } from '../categories/categorySnapshotSync';
import {
  deleteCollection,
  enableCollectionShare,
  getCollection,
  getCollectionShare,
  removeItemFromCollection,
  renameCollection,
  revokeCollectionShare,
  setCollectionFavorite,
  setCollectionIcon,
  type Collection,
  type CollectionItemEntry,
  type CollectionShare,
} from '../collections/api/collectionsApi';
import { CollectionIconPicker } from '../collections/CollectionIconPicker';
import { CategoryIconTile } from '../collections/CategoryIconTile';
import { DEFAULT_COLLECTION_ICON, resolveCollectionIconKey, type CollectionIconKey } from '../collections/collectionIcons';
import { useCollectionItems } from '../collections/useCollectionItems';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SavedLinkRow } from '../components/SavedLinkRow';
import { SwipeableItemRow } from '../components/SwipeableItemRow';
import { closeOpenRow } from '../components/swipeableRowCoordinator';
import { EditIcon } from '../icons/EditIcon';
import { ShareIcon } from '../icons/ShareIcon';
import { StarIcon } from '../icons/StarIcon';
import { TrashIcon } from '../icons/TrashIcon';
import type { ItemHistoryEntry } from '../items/api/itemsApi';
import { shareItem } from '../items/shareItem';
import type { RootStackParamList } from '../navigation/RootStack';
import { cardShadow, colors, minTouchTarget, radii, spacing } from '../theme/tokens';

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

  /**
   * Saves the name and/or icon edit fields together (one Save button - see the edit form below),
   * but calls their two independent endpoints sequentially, never via Promise.all: both mutate the
   * same Collection row's RowVersion (see backend CollectionStore.RenameAsync/SetIconAsync), so
   * firing them concurrently risks one losing an optimistic-concurrency race against the other. A
   * name change that succeeds followed by an icon change that fails is left applied (not rolled
   * back) - the same "each attribute is its own independent action" contract this screen's
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

    if (!nameChanged && !iconChanged) {
      setIsEditingName(false);
      return;
    }

    setIsRenaming(true);
    setRenameError(null);

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
                <TextInput
                  autoFocus
                  editable={!isRenaming}
                  onChangeText={setNameDraft}
                  style={styles.nameInput}
                  value={nameDraft}
                />
                <Text style={styles.iconSectionTitle}>{t('collections.iconSectionTitle')}</Text>
                <CollectionIconPicker disabled={isRenaming} onSelect={setIconDraft} selected={iconDraft} />
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
                    <CategoryIconTile collectionId={collection.id} icon={collection.icon} size={32} />
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
                  </View>
                </View>
              </View>
            )}
            {renameError ? <Text style={styles.error}>{renameError}</Text> : null}
            {favoriteToggleError ? <Text style={styles.error}>{favoriteToggleError}</Text> : null}
            {deleteError ? <Text style={styles.error}>{deleteError}</Text> : null}

            <View style={styles.shareSection}>
              <View style={styles.shareToggleRow}>
                <View style={styles.shareToggleTextColumn}>
                  <Text style={styles.shareToggleLabel}>{t('collections.publicShareLabel')}</Text>
                  <Text style={styles.shareDescription}>{t('collections.publicShareDescription')}</Text>
                </View>
                <Switch
                  disabled={isManagingShare}
                  onValueChange={handleShareToggle}
                  value={share !== null}
                />
              </View>
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
  nameInput: {
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 20,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  iconSectionTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: spacing.sm,
    marginTop: spacing.md,
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
  // A compact, self-contained settings card (matches MyPageScreen's grouped-section language) -
  // previously this toggle+description just sat directly in the screen's own background, reading
  // as disconnected from everything else on the page.
  shareSection: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    ...cardShadow,
  },
  shareToggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  shareToggleTextColumn: {
    flex: 1,
    marginEnd: spacing.md,
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
