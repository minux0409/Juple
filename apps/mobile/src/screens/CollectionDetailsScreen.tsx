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
import { SafeAreaView } from 'react-native-safe-area-context';
import i18n from '../i18n';
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
  type Collection,
  type CollectionItemEntry,
  type CollectionShare,
} from '../collections/api/collectionsApi';
import { useCollectionItems } from '../collections/useCollectionItems';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SwipeableItemRow } from '../components/SwipeableItemRow';
import { closeOpenRow } from '../components/swipeableRowCoordinator';
import { ItemRepresentativeThumbnail } from '../images/ItemRepresentativeThumbnail';
import { shareItem } from '../items/shareItem';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, radii, spacing } from '../theme/tokens';

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

  const { items, isLoading, isRefreshing, isLoadingMore, error, refresh, loadMore, removeLocally } =
    useCollectionItems(collectionId);

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

  const handleShareToggle = (value: boolean) => {
    if (value) {
      enableShareAction();
    } else {
      confirmUnshare();
    }
  };

  if (isLoadingCollection && !collection) {
    return (
      <SafeAreaView edges={['top']} style={styles.loadingContainer}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  if (!collection) {
    return (
      <SafeAreaView edges={['top']} style={styles.loadingContainer}>
        {collectionError ? <Text style={styles.error}>{collectionError}</Text> : null}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <FlatList
        contentContainerStyle={styles.content}
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
              <View style={styles.nameRow}>
                <Text numberOfLines={2} style={styles.title}>
                  {collection.name}
                </Text>
                <Pressable
                  accessibilityLabel={
                    collection.isFavorite ? t('collections.removeFavorite') : t('collections.addFavorite')
                  }
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isTogglingFavorite, busy: isTogglingFavorite }}
                  disabled={isTogglingFavorite}
                  hitSlop={8}
                  onPress={toggleFavoriteAction}
                  style={styles.favoriteButton}
                >
                  <Text
                    style={[styles.favoriteButtonLabel, collection.isFavorite && styles.favoriteButtonLabelActive]}
                  >
                    {collection.isFavorite ? '★' : '☆'}
                  </Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={startEditName} style={styles.editButton}>
                  <Text style={styles.editButtonLabel}>{t('common.edit')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isDeletingCollection, busy: isDeletingCollection }}
                  disabled={isDeletingCollection}
                  onPress={confirmDeleteCollection}
                  style={[styles.deleteButton, isDeletingCollection && styles.disabledButton]}
                >
                  <Text style={styles.deleteButtonLabel}>
                    {isDeletingCollection ? t('common.deleting') : t('common.delete')}
                  </Text>
                </Pressable>
              </View>
            )}
            {renameError ? <Text style={styles.error}>{renameError}</Text> : null}
            {favoriteToggleError ? <Text style={styles.error}>{favoriteToggleError}</Text> : null}
            {deleteError ? <Text style={styles.error}>{deleteError}</Text> : null}

            <Text style={styles.itemCount}>
              {t('collections.itemCount', { count: collection.itemCount })}
            </Text>

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
              {share ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={shareLinkAction}
                  style={styles.shareLinkButton}
                >
                  <Text style={styles.shareLinkButtonLabel}>{t('collections.shareLinkAction')}</Text>
                </Pressable>
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
          !isLoading && !error ? <Text style={styles.empty}>{t('collections.itemsEmpty')}</Text> : undefined
        }
        onScrollBeginDrag={closeOpenRow}
        renderItem={({ item }) => (
          <SwipeableItemRow
            containerStyle={styles.row}
            disabled={itemActionInFlightId !== null || isRefreshing}
            onDelete={() => removeItemAction(item.itemId)}
            onPress={() => {
              navigation.navigate('ItemDetails', { itemId: item.itemId });
            }}
            onShare={() => shareItemAction(item)}
          >
            <CollectionItemContent item={item} />
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
    </SafeAreaView>
  );
}

interface CollectionItemContentProps {
  readonly item: CollectionItemEntry;
}

function CollectionItemContent({ item }: CollectionItemContentProps) {
  return (
    <View style={styles.rowContent}>
      <ItemRepresentativeThumbnail representativeImage={item.representativeImage} />
      <View style={styles.rowTextColumn}>
        <Text numberOfLines={2} style={styles.url}>
          {item.title ?? item.url}
        </Text>
        {item.title ? (
          <Text numberOfLines={1} style={styles.secondaryUrl}>
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
  content: {
    flexGrow: 1,
    padding: 24,
  },
  nameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    flex: 1,
    marginEnd: 12,
  },
  favoriteButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginEnd: 8,
    minHeight: 32,
    minWidth: 32,
  },
  favoriteButtonLabel: {
    color: '#9A9A9A',
    fontSize: 24,
  },
  favoriteButtonLabelActive: {
    color: '#F5A623',
  },
  editButton: {
    borderColor: '#9A9A9A',
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  editButtonLabel: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '600',
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
    marginTop: 8,
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
  shareLinkButton: {
    alignSelf: 'flex-start',
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  shareLinkButtonLabel: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
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
  row: {
    borderTopColor: '#E0E0E0',
    borderTopWidth: 1,
    marginTop: 24,
  },
  rowContent: {
    flexDirection: 'row',
    paddingVertical: 14,
  },
  rowTextColumn: {
    flex: 1,
  },
  url: {
    color: '#111111',
    fontSize: 15,
  },
  secondaryUrl: {
    color: '#666666',
    fontSize: 13,
    marginTop: 3,
  },
  memoPreview: {
    color: '#666666',
    fontSize: 13,
    marginTop: 5,
  },
  addedTime: {
    color: '#666666',
    fontSize: 13,
    marginTop: 5,
  },
  disabledButton: {
    opacity: 0.5,
  },
  footerLoading: {
    paddingVertical: 20,
  },
  deleteButton: {
    borderColor: colors.danger,
    borderRadius: radii.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  deleteButtonLabel: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
});
