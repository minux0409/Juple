import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
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
  TRASH_LIST_LIMIT,
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
 * already caps the list to the same TRASH_LIST_LIMIT for every user (see getTrashItems), so
 * this screen never computes or truncates a limit itself. Restore/permanent-delete/empty-trash all
 * update local state directly on success rather than refetching the whole list.
 */
export function TrashScreen() {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();

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
  // 비우기's own rendered width (it varies by locale/font scale) - mirrored by the header's leading
  // slot so the limit notice stays on the true center line (see the header's own remarks).
  const [emptyActionWidth, setEmptyActionWidth] = useState(0);
  const hasEmptyAction = items.length > 0;

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
      // A single call - the server empties the caller's entire trash (every retained item), not
      // just the capped rows this screen happens to be showing.
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
        One compact header bar above the list: the limit notice (always shown, even when the list is
        empty - "0개여도 안내문은 표시") centered on the screen's true horizontal center, with 비우기 as
        a trailing action on the same row only when there is something to empty. A leading mirror
        slot takes 비우기's own measured width, so the notice's column is symmetric (truly centered)
        without any hardcoded offset, and a long translation wraps instead of running under 비우기.
        A sibling of the FlatList (not its ListHeaderComponent) so the list's own padding never opens
        a gap between the two, and the empty-state message stays centered in the remaining space.
      */}
      <View style={[styles.header, hasEmptyAction && styles.headerWithAction]}>
        {hasEmptyAction ? <View style={{ width: emptyActionWidth }} testID="trash-header-mirror-slot" /> : null}
        <Text style={styles.limitNotice} testID="trash-limit-notice">
          {t('trash.limitNotice', { count: TRASH_LIST_LIMIT })}
        </Text>
        {hasEmptyAction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isEmptyingTrash }}
            disabled={isEmptyingTrash}
            onLayout={event => setEmptyActionWidth(event.nativeEvent.layout.width)}
            onPress={() => setIsEmptyTrashConfirmVisible(true)}
            style={styles.emptyTrashButton}
          >
            <Text style={styles.emptyTrashButtonLabel}>{t('trash.emptyAction')}</Text>
          </Pressable>
        ) : null}
      </View>
      <FlatList
        contentContainerStyle={styles.content}
        data={items}
        style={styles.list}
        keyExtractor={item => item.id.toString()}
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
  // Same horizontal inset as the list content below, so the notice and the rows line up.
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  // Only while 비우기 is shown - the row must be tall enough for its 44dp touch target; without it
  // the notice alone needs no extra height.
  headerWithAction: {
    minHeight: minTouchTarget,
  },
  // flex:1 between two equal-width side slots (mirror slot + 비우기) = the true center column; the
  // full width when 비우기 is hidden. Wraps for a long translation.
  limitNotice: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 12,
    textAlign: 'center',
  },
  // flex:1 so the FlatList fills the space StackScreenSafeArea's own bottom padding already leaves
  // above the system nav bar - see that component's own remarks.
  list: {
    flex: 1,
  },
  // No top inset of its own - the header bar directly above already provides the separation
  // (header paddingTop + the vertically centered notice inside the 44dp action row), so the first
  // row sits a small, natural distance below the notice rather than stacking two gaps.
  content: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: 0,
  },
  emptyTrashButton: {
    flexShrink: 0,
    justifyContent: 'center',
    minHeight: minTouchTarget,
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
