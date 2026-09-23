import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useIsPlusUser } from '../auth/useIsPlusUser';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SavedLinkRow } from '../components/SavedLinkRow';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { RestoreIcon } from '../icons/RestoreIcon';
import { TrashIcon } from '../icons/TrashIcon';
import {
  emptyTrash,
  getTrashItems,
  permanentlyDeleteItem,
  restoreItem,
  type ItemTrashEntry,
} from '../items/api/itemsApi';
import type { ItemHistoryEntry } from '../items/api/itemsApi';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

/** Adapts an ItemTrashEntry to SavedLinkRow's expected shape - deletedAtUtc stands in for savedAtUtc (the row's own time display), matching the same display-shape-adapter pattern CollectionDetailsScreen already uses for its own Item list. */
function toSavedLinkRowItem(entry: ItemTrashEntry): ItemHistoryEntry {
  return {
    id: entry.id,
    url: entry.url,
    title: entry.title,
    memo: null,
    savedAtUtc: entry.deletedAtUtc,
    representativeImage: entry.representativeImage,
    previewImageUrl: entry.previewImageUrl,
    coverImage: entry.coverImage,
  };
}

function getLoadErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('trash.loadError');
}

/**
 * 삭제 이력 (user-facing name; backend/internal naming stays "trash" - see itemsApi.ts): soft-deleted
 * Items (see backend Item.DeletedAtUtc), newest-deleted-first. The server
 * already caps the list by the current user's Plan (Free 10 / Plus 100 - see getTrashItems), so
 * this screen never computes or truncates a limit itself. Restore/permanent-delete/empty-trash all
 * update local state directly on success rather than refetching the whole list.
 */
export function TrashScreen() {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const isPlusUser = useIsPlusUser();

  const [items, setItems] = useState<readonly ItemTrashEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [actionInFlightId, setActionInFlightId] = useState<number | null>(null);
  // Only ever an error notice (no success dialog - see restoreAction/permanentlyDeleteAction/
  // emptyTrashAction's own remarks: each is already gated behind its own ConfirmDialog, and the
  // list change on success is sufficient feedback on its own).
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [pendingRestoreId, setPendingRestoreId] = useState<number | null>(null);
  const [pendingPermanentDeleteId, setPendingPermanentDeleteId] = useState<number | null>(null);
  const [isEmptyTrashConfirmVisible, setIsEmptyTrashConfirmVisible] = useState(false);
  const [isEmptyingTrash, setIsEmptyingTrash] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const fetched = await getTrashItems(authenticatedRequest);
      setItems(fetched);
    } catch (caughtError) {
      setLoadError(getLoadErrorMessage(caughtError, t));
    } finally {
      setIsLoading(false);
    }
  }, [authenticatedRequest, t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const restoreAction = async (itemId: number) => {
    if (actionInFlightId !== null) {
      return;
    }
    setActionInFlightId(itemId);
    setErrorMessage(null);
    try {
      await restoreItem(authenticatedRequest, itemId);
      // No success notice - the row disappearing is already sufficient feedback, and the user just
      // gave explicit confirmation via ConfirmDialog immediately before this (see restoreAction's
      // caller).
      setItems(previous => previous.filter(item => item.id !== itemId));
    } catch {
      setErrorMessage(t('trash.restoreError'));
    } finally {
      setActionInFlightId(null);
    }
  };

  const permanentlyDeleteAction = async (itemId: number) => {
    if (actionInFlightId !== null) {
      return;
    }
    setActionInFlightId(itemId);
    setErrorMessage(null);
    try {
      await permanentlyDeleteItem(authenticatedRequest, itemId);
      // No success notice - same rationale as restoreAction above.
      setItems(previous => previous.filter(item => item.id !== itemId));
    } catch {
      setErrorMessage(t('trash.permanentDeleteError'));
    } finally {
      setActionInFlightId(null);
    }
  };

  const emptyTrashAction = async () => {
    if (isEmptyingTrash) {
      return;
    }
    setIsEmptyingTrash(true);
    setErrorMessage(null);
    try {
      // A single call - the server empties the caller's entire trash (up to 100 retained items),
      // not just the (possibly Free-capped) 10 rows this screen happens to be showing.
      await emptyTrash(authenticatedRequest);
      // No success notice - same rationale as restoreAction above.
      setItems([]);
    } catch {
      setErrorMessage(t('trash.emptyTrashError'));
    } finally {
      setIsEmptyingTrash(false);
    }
  };

  return (
    <StackScreenSafeArea style={styles.screen}>
      {/*
        Always shown, even when the list is empty (this round's explicit "0개여도 안내문은 표시"
        requirement) - a sibling of the FlatList, not inside its own ListHeaderComponent, so the
        empty-state message's existing center-of-remaining-space layout (see emptyContainer below)
        is computed purely from the FlatList's own remaining flex space and is never thrown off by
        this notice's height.
      */}
      <Text style={styles.limitNotice}>
        {t(isPlusUser ? 'trash.plusLimitNotice' : 'trash.freeLimitNotice')}
      </Text>
      <FlatList
        contentContainerStyle={styles.content}
        data={items}
        style={styles.list}
        keyExtractor={item => item.id.toString()}
        ListHeaderComponent={
          items.length > 0 ? (
            <View style={styles.headerRow}>
              <View style={styles.headerRowSpacer} />
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: isEmptyingTrash }}
                disabled={isEmptyingTrash}
                onPress={() => setIsEmptyTrashConfirmVisible(true)}
                style={styles.emptyTrashButton}
              >
                <Text style={styles.emptyTrashButtonLabel}>{t('trash.emptyAction')}</Text>
              </Pressable>
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator style={styles.loading} />
          ) : loadError ? undefined : (
            <View style={styles.emptyContainer}>
              <Text style={styles.empty}>{t('trash.empty')}</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowContent}>
              <SavedLinkRow
                dateDisplayMode="dateTime"
                isActionInFlight={actionInFlightId === item.id}
                item={toSavedLinkRowItem(item)}
                preferEffectiveThumbnail
              />
            </View>
            <View style={styles.rowActions}>
              <Pressable
                accessibilityLabel={t('trash.restoreA11y')}
                accessibilityRole="button"
                accessibilityState={{ disabled: actionInFlightId !== null }}
                disabled={actionInFlightId !== null}
                onPress={() => setPendingRestoreId(item.id)}
                style={styles.actionButton}
              >
                <RestoreIcon color={colors.brand} size={18} />
              </Pressable>
              <Pressable
                accessibilityLabel={t('trash.permanentDeleteA11y')}
                accessibilityRole="button"
                accessibilityState={{ disabled: actionInFlightId !== null }}
                disabled={actionInFlightId !== null}
                onPress={() => setPendingPermanentDeleteId(item.id)}
                style={styles.actionButton}
              >
                <TrashIcon color={colors.danger} size={18} />
              </Pressable>
            </View>
          </View>
        )}
      />
      {loadError ? <Text style={styles.loadErrorText}>{loadError}</Text> : null}

      {errorMessage !== null ? (
        <ConfirmDialog
          confirmLabel={t('common.confirm')}
          message={errorMessage}
          onConfirm={() => setErrorMessage(null)}
          title={t('common.notice')}
          visible
        />
      ) : null}
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('trash.restoreConfirmAction')}
        destructive={false}
        message={t('trash.restoreConfirmMessage')}
        onCancel={() => setPendingRestoreId(null)}
        onConfirm={() => {
          const itemId = pendingRestoreId;
          setPendingRestoreId(null);
          if (itemId !== null) {
            restoreAction(itemId);
          }
        }}
        title={t('trash.restoreConfirmTitle')}
        visible={pendingRestoreId !== null}
      />
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
        message={t('trash.permanentDeleteConfirmMessage')}
        onCancel={() => setPendingPermanentDeleteId(null)}
        onConfirm={() => {
          const itemId = pendingPermanentDeleteId;
          setPendingPermanentDeleteId(null);
          if (itemId !== null) {
            permanentlyDeleteAction(itemId);
          }
        }}
        title={t('trash.permanentDeleteConfirmTitle')}
        visible={pendingPermanentDeleteId !== null}
      />
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
        message={t('trash.emptyTrashConfirmMessage')}
        onCancel={() => setIsEmptyTrashConfirmVisible(false)}
        onConfirm={() => {
          setIsEmptyTrashConfirmVisible(false);
          emptyTrashAction();
        }}
        title={t('trash.emptyTrashConfirmTitle')}
        visible={isEmptyTrashConfirmVisible}
      />
    </StackScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  limitNotice: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  // flex:1 so the FlatList fills the space StackScreenSafeArea's own bottom padding already leaves
  // above the system nav bar - see that component's own remarks.
  list: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: spacing.xl,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  headerRowSpacer: {
    flex: 1,
  },
  emptyTrashButton: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  emptyTrashButtonLabel: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '700',
  },
  loading: {
    paddingVertical: spacing.lg,
  },
  emptyContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  empty: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    marginBottom: spacing.sm + 2,
  },
  rowContent: {
    flex: 1,
  },
  rowActions: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingEnd: spacing.sm,
  },
  actionButton: {
    alignItems: 'center',
    height: minTouchTarget,
    justifyContent: 'center',
    width: minTouchTarget,
  },
  loadErrorText: {
    color: colors.danger,
    fontSize: 14,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
});
