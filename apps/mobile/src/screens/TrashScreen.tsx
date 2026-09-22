import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SavedLinkRow } from '../components/SavedLinkRow';
import { StatusToast } from '../components/StatusToast';
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
 * 휴지통: soft-deleted Items (see backend Item.DeletedAtUtc), newest-deleted-first. The server
 * already caps the list by the current user's Plan (Free 10 / Plus 100 - see getTrashItems), so
 * this screen never computes or truncates a limit itself. Restore/permanent-delete/empty-trash all
 * update local state directly on success rather than refetching the whole list.
 */
export function TrashScreen() {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const { plan } = useAuth();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<readonly ItemTrashEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [actionInFlightId, setActionInFlightId] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

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
    setStatusMessage(null);
    try {
      await restoreItem(authenticatedRequest, itemId);
      setItems(previous => previous.filter(item => item.id !== itemId));
      setStatusMessage({ text: t('trash.restoreSuccess'), tone: 'success' });
    } catch {
      setStatusMessage({ text: t('trash.restoreError'), tone: 'error' });
    } finally {
      setActionInFlightId(null);
    }
  };

  const permanentlyDeleteAction = async (itemId: number) => {
    if (actionInFlightId !== null) {
      return;
    }
    setActionInFlightId(itemId);
    setStatusMessage(null);
    try {
      await permanentlyDeleteItem(authenticatedRequest, itemId);
      setItems(previous => previous.filter(item => item.id !== itemId));
      setStatusMessage({ text: t('trash.permanentDeleteSuccess'), tone: 'success' });
    } catch {
      setStatusMessage({ text: t('trash.permanentDeleteError'), tone: 'error' });
    } finally {
      setActionInFlightId(null);
    }
  };

  const emptyTrashAction = async () => {
    if (isEmptyingTrash) {
      return;
    }
    setIsEmptyingTrash(true);
    setStatusMessage(null);
    try {
      // A single call - the server empties the caller's entire trash (up to 100 retained items),
      // not just the (possibly Free-capped) 10 rows this screen happens to be showing.
      await emptyTrash(authenticatedRequest);
      setItems([]);
      setStatusMessage({ text: t('trash.emptyTrashSuccess'), tone: 'success' });
    } catch {
      setStatusMessage({ text: t('trash.emptyTrashError'), tone: 'error' });
    } finally {
      setIsEmptyingTrash(false);
    }
  };

  const limitNotice =
    plan === 'Free' ? t('trash.freeLimitNotice') : plan === 'Plus' ? t('trash.plusLimitNotice') : null;

  return (
    <View style={styles.screen}>
      <FlatList
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xl + insets.bottom }]}
        data={items}
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
                onPress={() => restoreAction(item.id)}
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
        ListFooterComponent={
          !isLoading && items.length > 0 && limitNotice ? (
            <Text style={styles.limitNotice}>{limitNotice}</Text>
          ) : undefined
        }
      />
      {loadError ? <Text style={styles.loadErrorText}>{loadError}</Text> : null}
      {statusMessage ? <StatusToast message={statusMessage.text} tone={statusMessage.tone} /> : null}

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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
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
  limitNotice: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: spacing.sm,
    textAlign: 'center',
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
