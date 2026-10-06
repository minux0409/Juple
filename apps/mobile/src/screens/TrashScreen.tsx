import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { ActionMenuDialog } from '../components/ActionMenuDialog';
import { BlockingProgressOverlay } from '../components/BlockingProgressOverlay';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LinkSortChips } from '../components/LinkSortChips';
import { isDefinitiveLoadError, LoadFailureState } from '../components/LoadFailureState';
import { SavedLinkGridCard, savedLinkGridLayout } from '../components/SavedLinkGridCard';
import { savedLinkLayout } from '../components/savedLinkLayout';
import { SavedLinkRow } from '../components/SavedLinkRow';
import { SwipeableItemRow } from '../components/SwipeableItemRow';
import { closeOpenRow } from '../components/swipeableRowCoordinator';
import { useActionAfterMenu } from '../components/useActionAfterMenu';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { sortLinksByName } from '../collections/sortCollectionItems';
import { ExternalLinkIcon } from '../icons/ExternalLinkIcon';
import { RestoreIcon } from '../icons/RestoreIcon';
import { EmptyTrashIcon } from '../icons/EmptyTrashIcon';
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
import { isNameSort, nextDateSort, nextNameSort, useSortPreference } from '../settings/sortPreference';
import { useViewModePreference } from '../settings/viewModePreference';
import { colors, minTouchTarget, spacing } from '../theme/tokens';

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

function resolveTrashTitle(entry: ItemTrashEntry): string {
  return entry.title?.trim() ? entry.title : entry.url;
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
  const [loadError, setLoadError] = useState<{ readonly cause: unknown; readonly message: string } | null>(null);

  const { viewMode, changeViewMode } = useViewModePreference('trashViewMode');
  const { sortOption, setSortOption } = useSortPreference('trashLinkSort');
  // The deleted link whose action popup (링크 열기 / 복구 / 영구 삭제) is open. A deleted link has no
  // ItemDetails, so tapping or long-pressing it opens this instead.
  const [actionItem, setActionItem] = useState<ItemTrashEntry | null>(null);
  const { afterMenuCloses, onMenuDismiss } = useActionAfterMenu();
  const [actionInFlightId, setActionInFlightId] = useState<number | null>(null);
  // Only ever an error notice (no success dialog - see restoreAction/permanentlyDeleteAction/
  // emptyTrashAction's own remarks: each is already gated behind its own ConfirmDialog, and the
  // list change on success is sufficient feedback on its own).
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [pendingRestoreId, setPendingRestoreId] = useState<number | null>(null);
  const [pendingPermanentDeleteId, setPendingPermanentDeleteId] = useState<number | null>(null);
  const [isEmptyTrashConfirmVisible, setIsEmptyTrashConfirmVisible] = useState(false);
  const [isEmptyingTrash, setIsEmptyingTrash] = useState(false);
  // Synchronous guard: two confirmations in the same frame must not both start a request.
  const isEmptyingRef = useRef(false);
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
      setLoadError({ cause: caughtError, message: getLoadErrorMessage(caughtError, t) });
    } finally {
      setIsLoading(false);
    }
  }, [authenticatedRequest, t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // The server caps the list, so the whole list is here: any order is a local sort.
  const displayedItems = useMemo(() => {
    if (isNameSort(sortOption)) {
      return sortLinksByName(
        items,
        { title: item => item.title, url: item => item.url, addedAtUtc: item => item.deletedAtUtc, id: item => item.id },
        undefined,
        sortOption === 'titleDesc' ? 'desc' : 'asc',
      );
    }
    // 시간순 is the deletion time: newest deleted first, or the reverse (never relying on the server's order alone).
    const direction = sortOption === 'oldest' ? 1 : -1;
    return [...items].sort((a, b) => direction * (a.deletedAtUtc.localeCompare(b.deletedAtUtc) || a.id - b.id));
  }, [items, sortOption]);

  const closeMenuThen = (action: () => void) => afterMenuCloses(() => setActionItem(null), action);

  /**
   * Opens the raw saved URL in the system browser (the same openURL as ItemDetails). Deliberately no
   * canOpenURL pre-check (Android package visibility) - a real failure surfaces via the catch. Opening a
   * link never restores or changes the deleted item.
   */
  const openLink = async (entry: ItemTrashEntry) => {
    try {
      await Linking.openURL(entry.url);
    } catch {
      setErrorMessage(t('item.urlOpenFailed'));
    }
  };

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
    if (isEmptyingRef.current) {
      return;
    }
    isEmptyingRef.current = true;
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
      isEmptyingRef.current = false;
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
            accessibilityLabel={t('trash.emptyA11y')}
            accessibilityRole="button"
            accessibilityState={{ disabled: isEmptyingTrash }}
            disabled={isEmptyingTrash}
            onLayout={event => setEmptyActionWidth(event.nativeEvent.layout.width)}
            onPress={() => setIsEmptyTrashConfirmVisible(true)}
            style={styles.emptyTrashButton}
            testID="trash-empty-button"
          >
            <EmptyTrashIcon color={colors.danger} size={22} />
          </Pressable>
        ) : null}
      </View>
      {items.length > 0 ? (
        <View style={styles.controlsRow}>
          <LinkSortChips
            dateLabel={t('collections.sortDate')}
            dateNewestA11yLabel={t('collections.sortDateNewestA11y')}
            dateOldestA11yLabel={t('collections.sortDateOldestA11y')}
            nameAscA11yLabel={t('collections.sortNameAscA11y')}
            nameDescA11yLabel={t('collections.sortNameDescA11y')}
            nameLabel={t('collections.sortName')}
            onPressDate={() => setSortOption(nextDateSort(sortOption))}
            onPressName={() => setSortOption(nextNameSort(sortOption))}
            sort={sortOption}
            testIDPrefix="trash-sort"
          />
          <View style={styles.controlsSpacer} />
          <ViewModeToggle onChange={changeViewMode} value={viewMode} />
        </View>
      ) : null}
      <FlatList
        key={viewMode}
        contentContainerStyle={styles.content}
        data={displayedItems}
        numColumns={viewMode === 'grid' ? 2 : 1}
        onScrollBeginDrag={closeOpenRow}
        style={styles.list}
        keyExtractor={item => item.id.toString()}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator style={styles.loading} />
          ) : loadError ? (
            <LoadFailureState error={loadError.cause} notice={isDefinitiveLoadError(loadError.cause) ? loadError.message : null} onRetry={() => { load(); }} testID="trash-load-error" />
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.empty}>{t('trash.empty')}</Text>
            </View>
          )
        }
        renderItem={({ item }) => viewMode === 'grid' ? (
          // The same SavedLinkGridCard as Home/History/Collections, in the same swipe row as the List (compact: slim,
          // icon-only actions): right reveals 복구, left reveals 영구 삭제 - both still ask first. Tap and long-press open
          // the titleless action popup.
          <View style={savedLinkGridLayout.cell}>
            <SwipeableItemRow
              accessibilityLabel={resolveTrashTitle(item)}
              compact
              containerStyle={[savedLinkGridLayout.swipeContainer, styles.gridCard]}
              deleteLabel={t('trash.permanentDeleteA11y')}
              deleteTestID={`trash-delete-${item.id}`}
              disabled={actionInFlightId !== null}
              onDelete={() => setPendingPermanentDeleteId(item.id)}
              onLongPress={() => setActionItem(item)}
              onPress={() => setActionItem(item)}
              startAction={{
                backgroundColor: colors.brand,
                icon: RestoreIcon,
                label: t('trash.restoreA11y'),
                shortLabel: t('trash.restoreConfirmAction'),
                onPress: () => setPendingRestoreId(item.id),
                testID: `trash-restore-${item.id}`,
              }}
              testID={`trash-item-${item.id}`}
            >
              <SavedLinkGridCard
                dateDisplayMode="dateTime"
                isActionInFlight={actionInFlightId === item.id}
                item={toSavedLinkRowItem(item)}
                preferEffectiveThumbnail
              />
            </SwipeableItemRow>
          </View>
        ) : (
          // The shared swipe row: right reveals 복구, left reveals 영구 삭제 (both still ask first); a tap or long press
          // opens the titleless action popup. No permanent ⋯ button - the card itself is the target.
          <SwipeableItemRow
            accessibilityLabel={resolveTrashTitle(item)}
            containerStyle={savedLinkLayout.card}
            deleteLabel={t('trash.permanentDeleteA11y')}
            deleteTestID={`trash-delete-${item.id}`}
            disabled={actionInFlightId !== null}
            onDelete={() => setPendingPermanentDeleteId(item.id)}
            onLongPress={() => setActionItem(item)}
            onPress={() => setActionItem(item)}
            startAction={{
              backgroundColor: colors.brand,
              icon: RestoreIcon,
              label: t('trash.restoreA11y'),
              onPress: () => setPendingRestoreId(item.id),
              testID: `trash-restore-${item.id}`,
            }}
            testID={`trash-item-${item.id}`}
          >
            <SavedLinkRow
              dateDisplayMode="dateTime"
              isActionInFlight={actionInFlightId === item.id}
              item={toSavedLinkRowItem(item)}
              preferEffectiveThumbnail
            />
          </SwipeableItemRow>
        )}
      />
      <ActionMenuDialog
        actions={actionItem ? [
          { label: t('trash.openLink'), icon: ExternalLinkIcon, onPress: () => { const entry = actionItem; closeMenuThen(() => { openLink(entry).catch(() => undefined); }); } },
          { label: t('trash.restoreConfirmAction'), icon: RestoreIcon, onPress: () => { const entry = actionItem; closeMenuThen(() => setPendingRestoreId(entry.id)); } },
          { label: t('trash.permanentDeleteA11y'), icon: TrashIcon, destructive: true, onPress: () => { const entry = actionItem; closeMenuThen(() => setPendingPermanentDeleteId(entry.id)); } },
        ] : []}
        cancelLabel={t('common.cancel')}
        onCancel={() => setActionItem(null)}
        onDismiss={onMenuDismiss}
        visible={actionItem !== null}
      />

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
      {/* Emptying a large trash can take a while: the screen is blocked (no repeat, no other action) until it settles. */}
      <BlockingProgressOverlay message={t('trash.deleting')} testID="trash-empty-progress" visible={isEmptyingTrash} />
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
    minWidth: minTouchTarget,
    alignItems: 'center',
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
  controlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  controlsSpacer: { flex: 1 },
  gridCard: { flexGrow: 1 },
});
