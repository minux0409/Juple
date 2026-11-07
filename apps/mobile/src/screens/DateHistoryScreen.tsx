import { useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ActivityIndicator,
  Platform,
  Text,
  View,
} from 'react-native';
import { usePullToRefresh } from '../components/PullRefreshControl';
import { TabScreenSafeArea } from '../components/TabScreenSafeArea';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { CenteredEmptyState } from '../components/CenteredEmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LoadFailureState } from '../components/LoadFailureState';
import { RefreshFailureNotice } from '../components/RefreshFailureNotice';
import { useAppToast } from '../components/AppToast';
import { useToastBottomAnchor } from '../components/useToastBottomAnchor';
import { SavedLinkRow } from '../components/SavedLinkRow';
import { SavedLinkImageRow,
  type SavedLinkImageSwipeActions } from '../components/SavedLinkImageTile';
import { SavedLinkGridCell, useSavedLinkGridCellStyle } from '../components/SavedLinkGridCard';
import { useSavedLinkColumns, type SavedLinkColumns } from '../layout/responsiveGrid';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { AnimatedFlatList, CollapsibleHeaderLayout } from '../components/CollapsibleHeaderLayout';
import { SearchField } from '../components/SearchField';
import { savedLinkLayout } from '../components/savedLinkLayout';
import { useArchiveSearch } from '../items/useArchiveSearch';
import { browseFailureMessage } from '../items/browseFailureMessage';
import { SwipeableItemRow } from '../components/SwipeableItemRow';
import { closeOpenRow, subscribeRowOpened, useSwipeAwareScrollEnabled } from '../components/swipeableRowCoordinator';
import { HintBanner } from '../hints/HintBanner';
import { useOneTimeHint } from '../hints/useOneTimeHint';
import { getSavedLinkSwipeActions, hasSavedLinkSwipeActions } from '../items/savedLinkSwipeActions';
import { buildFlatItemRows, type FlatItemRow } from '../items/flatItemRows';
import { END_REACHED_THRESHOLD, useContinuousViewportFill } from '../items/useContinuousViewportFill';
import { onItemListChanged } from '../items/itemListChanges';
import { deleteItem, restoreItem, type ItemHistoryEntry } from '../items/api/itemsApi';
import { shareItem } from '../items/shareItem';
import { useItemCardOpen } from '../items/useItemCardOpen';
import { useSavedLinkActions } from '../items/useSavedLinkActions';
import { useSavedLinkSelection } from '../items/useSavedLinkSelection';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, spacing, themedStyles } from '../theme/tokens';
import { useViewModePreference, type SavedLinkViewMode } from '../settings/viewModePreference';
import { ScreenTitle } from '../components/ScreenTitle';
import { screenIcons } from '../navigation/screenIcons';
import { isHandledSubscriptionRefusal } from '../billing/subscriptionRequired';

function getHistoryDeleteErrorMessage(error: unknown, t: TFunction): string {
  if (isHandledSubscriptionRefusal(error)) {
    return '';
  }
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('history.errorDeleteFallback');
}

/** Share.share only ever rejects on a genuine native module failure - a user dismissing/canceling the sheet resolves normally, never here. */
function getHistoryShareErrorMessage(t: TFunction): string {
  return t('item.shareError');
}

/** The Archive's rows: the shared flat ones for its links, plus the status line (loading, nothing, a failed load). */
export type FlatRow = FlatItemRow<ItemHistoryEntry> | { readonly kind: 'searchStatus'; readonly key: string; readonly status: 'loading' | 'empty' | 'error' | 'moreError' };

const archiveAccessors = { idOf: (item: ItemHistoryEntry) => item.id };

/** The Archive's links as flat rows - see buildFlatItemRows (shared with Collection Details). */
export function buildFlatRows(items: readonly ItemHistoryEntry[], viewMode: SavedLinkViewMode, columns?: SavedLinkColumns): readonly FlatItemRow<ItemHistoryEntry>[] {
  return buildFlatItemRows(items, viewMode, archiveAccessors, columns);
}

/**
 * 보관함: every link the user has saved, as ONE list - always newest first (the server's order: saved time, then id), a
 * page at a time as it scrolls. There are no date sections to open and no other order to pick; a search narrows the same
 * list on the server. One virtualized FlatList holds the rows (in Image view one list row per line of tiles); only rows the
 * list actually mounts (near the viewport) render their images - nothing is prefetched.
 */
export function DateHistoryScreen() {
  const swipeScrollEnabled = useSwipeAwareScrollEnabled();
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const authenticatedRequest = useAuthenticatedApi();
  const { showUndoToast } = useAppToast();
  const { viewMode, changeViewMode } = useViewModePreference('historyViewMode');
  // Responsive Grid: the rows are built for the window's column count (phone: 2 cards / 3 image tiles, as always).
  const columns = useSavedLinkColumns();
  const gridCellStyle = useSavedLinkGridCellStyle();

  // AppToastHost renders above NavigationContainer (root coordinate space), so unlike a
  // screen-local Toast this needs the actual bottom tab bar height, not 0 - otherwise the Toast
  // sits under the tab bar, over the Android system navigation area.
  const tabBarHeight = useBottomTabBarHeight();
  useToastBottomAnchor(tabBarHeight);

  // Every link, or a search over the whole archive - one flat paged list from the server, newest first (see useArchiveSearch).
  const [searchText, setSearchText] = useState('');
  const search = useArchiveSearch(searchText);
  const refresh = search.refresh;

  const [actionInFlightItemId, setActionInFlightItemId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Delete confirmation is a declarative ConfirmDialog keyed off this - null means closed, an id
  // means the dialog is open for that item (mirrors DailyInboxScreen's same pattern).
  const [pendingDeleteItemId, setPendingDeleteItemId] = useState<number | null>(null);

  const runDelete = async (itemId: number) => {
    if (actionInFlightItemId !== null) {
      return;
    }

    setActionInFlightItemId(itemId);
    setActionError(null);
    try {
      await deleteItem(authenticatedRequest, itemId);
      search.removeItem(itemId);
      showUndoToast({ actionLabel: t('toast.undoAction'), message: t('toast.deleteSuccess'), noticeTitle: t('common.notice'), confirmLabel: t('common.confirm'), undoErrorMessage: t('toast.undoDeleteError'), onUndo: async () => { await restoreItem(authenticatedRequest, itemId); refresh(); } });
    } catch (caughtError) {
      setActionError(getHistoryDeleteErrorMessage(caughtError, t));
    } finally {
      setActionInFlightItemId(null);
    }
  };

  const runShare = async (item: ItemHistoryEntry) => {
    if (item.isCollectionLocked) { return; }
    if (actionInFlightItemId !== null) {
      return;
    }

    setActionInFlightItemId(item.id);
    setActionError(null);
    try {
      await shareItem(item.url, item.title);
    } catch {
      setActionError(getHistoryShareErrorMessage(t));
    } finally {
      setActionInFlightItemId(null);
    }
  };

  const confirmDelete = (itemId: number) => {
    setPendingDeleteItemId(previous => previous ?? itemId);
  };
  // A link deleted / restored (Undo) from its Item Details sheet after this tab is already focused again.
  const refreshAllRef = useRef(() => {});
  refreshAllRef.current = () => { refresh(); };
  useEffect(() => onItemListChanged(() => refreshAllRef.current()), []);
  const itemCardOpen = useItemCardOpen(
    (itemId, openContext) => navigation.navigate('ItemDetails', { itemId, openContext }),
    () => { refresh(); },
  );

  // Long-press on a link card starts multi-selection (shared with Home - see useSavedLinkSelection). Wired through a ref because the
  // selection needs the card wiring's openLink and the card wiring needs the selection's start.
  const startSelectionRef = useRef<(item: ItemHistoryEntry) => void>(() => undefined);
  const linkActions = useSavedLinkActions({ onLongPress: item => startSelectionRef.current(item as ItemHistoryEntry) });
  const linkSelection = useSavedLinkSelection({
    items: search.items,
    onEdit: item => { itemCardOpen.open(item).catch(() => undefined); },
    onOpenOriginal: item => { linkActions.openLink(item).catch(() => undefined); },
    onDeleted: ids => { ids.forEach(id => search.removeItem(id)); },
    onChanged: () => { refresh(); },
    isLoading: search.isLoading,
  });
  startSelectionRef.current = linkSelection.startSelection;
  const onImageLongPress = useCallback((item: ItemHistoryEntry) => startSelectionRef.current(item), []);

  // One stable open callback for every image tile (the tiles are memoized) - the same open path as a card.
  const itemCardOpenRef = useRef(itemCardOpen);
  itemCardOpenRef.current = itemCardOpen;
  const openItem = useCallback((item: ItemHistoryEntry) => { itemCardOpenRef.current.open(item).catch(() => undefined); }, []);
  // The image tiles' swipe (memoized tiles: one stable object, the handlers of the latest render behind it).
  const imageSwipeHandlersRef = useRef({ confirmDelete, runShare });
  imageSwipeHandlersRef.current = { confirmDelete, runShare };
  const imageSwipeActions = useMemo<SavedLinkImageSwipeActions>(() => ({
    onDelete: item => imageSwipeHandlersRef.current.confirmDelete(item.id),
    onShare: item => { imageSwipeHandlersRef.current.runShare(item).catch(() => undefined); },
  }), []);

  // The server's pages in the server's order (newest first), packed for the chosen view. Re-packing for another view never
  // asks the server again.
  const flatRows = useMemo<readonly FlatRow[]>(() => {
    const rowsOut: FlatRow[] = [...buildFlatRows(search.items, viewMode, columns)];
    // Under the results (or alone) only a status: loading the first page, nothing found, or a failed load.
    if (search.error) {
      rowsOut.push({ kind: 'searchStatus', key: 'ss:error', status: 'error' });
    } else if (search.moreError) {
      rowsOut.push({ kind: 'searchStatus', key: 'ss:moreError', status: 'moreError' });
    } else if (search.isLoading && search.items.length === 0) {
      rowsOut.push({ kind: 'searchStatus', key: 'ss:loading', status: 'loading' });
    } else if (search.items.length === 0 && search.settledTerm !== null) {
      rowsOut.push({ kind: 'searchStatus', key: 'ss:empty', status: 'empty' });
    }
    return rowsOut;
  }, [search.error, search.isLoading, search.items, search.moreError, search.settledTerm, viewMode, columns]);

  // The flat list fills itself while the loaded links do not fill the viewport (see useContinuousViewportFill) - dense
  // Image lines would otherwise never trigger another page.
  const advanceFlat = () => {
    if (search.hasMore && !search.isLoading && !search.isLoadingMore && !search.error && !search.moreError) {
      search.loadMore();
    }
  };
  const flatFillKey = useMemo(
    () => [search.items, search.isLoading, search.isLoadingMore, search.error, search.moreError, search.hasMore],
    [search.error, search.hasMore, search.isLoading, search.isLoadingMore, search.items, search.moreError],
  );
  const viewportFill = useContinuousViewportFill({ advance: advanceFlat, dataKey: flatFillKey, enabled: true });

  // The swipe hint (one completion key shared with Home): only while a swipeable row - List or Grid, never an Image tile -
  // is among the rows on screen and its swipe really reveals an action.
  const hasSwipeableRow = flatRows.some(row => {
    if (row.kind === 'flatItem') {
      return hasSavedLinkSwipeActions(row.item);
    }
    if (row.kind === 'flatGridRow') {
      return row.items.some(hasSavedLinkSwipeActions);
    }
    return false;
  });
  const swipeHint = useOneTimeHint('savedLinkSwipe', hasSwipeableRow);
  const { markPerformed: markSwipePerformed } = swipeHint;
  useEffect(() => subscribeRowOpened(markSwipePerformed), [markSwipePerformed]);

  const renderFlatRow = (row: FlatRow) => {
    switch (row.kind) {
      case 'flatItem':
        return (
          <SwipeableItemRow
            containerStyle={savedLinkLayout.card}
            disabled={actionInFlightItemId !== null}
            {...linkActions.menuProps(row.item)}
            onOpenOriginal={linkActions.originalLinkProps(row.item).onOpenOriginal}
            onDelete={() => confirmDelete(row.item.id)}
            onPress={() => { itemCardOpen.open(row.item).catch(() => undefined); }}
            onShare={getSavedLinkSwipeActions(row.item).share ? () => runShare(row.item) : undefined}
            selection={linkSelection.rowSelection(row.item)}
          >
            <SavedLinkRow dateDisplayMode={row.dateDisplayMode} isActionInFlight={actionInFlightItemId === row.item.id} item={row.item} {...linkActions.originalLinkProps(row.item)} preferEffectiveThumbnail />
          </SwipeableItemRow>
        );
      case 'flatGridRow':
        return (
          <View style={styles.flatGridRow} testID={`history-flat-grid-row-${row.key}`}>
            {row.items.map((item, column) => (
              <SavedLinkGridCell
                column={column}
                dateDisplayMode={row.dateDisplayMode}
                disabled={actionInFlightItemId !== null}
                isActionInFlight={actionInFlightItemId === item.id}
                item={item}
                key={item.id}
                {...linkActions.menuProps(item)}
                {...linkActions.originalLinkProps(item)}
                onDelete={() => confirmDelete(item.id)}
                onPress={() => { itemCardOpen.open(item).catch(() => undefined); }}
                onShare={getSavedLinkSwipeActions(item).share ? () => runShare(item) : undefined}
                selection={linkSelection.rowSelection(item)}
                preferEffectiveThumbnail
              />
            ))}
            {Array.from({ length: columns.grid - row.items.length }, (_, index) => <View key={`filler-${index}`} style={gridCellStyle} />)}
          </View>
        );
      case 'flatImageRow':
        return <SavedLinkImageRow items={row.items} onLongPress={onImageLongPress} onPress={openItem} selection={linkSelection.imageSelection} swipeActions={imageSwipeActions} swipeDisabled={actionInFlightItemId !== null} testID={`history-flat-image-row-${row.key}`} />;
      case 'searchStatus':
        return row.status === 'loading' ? (
          <ActivityIndicator style={styles.searchStatus} testID="history-search-loading" />
        ) : row.status === 'moreError' ? (
          <RefreshFailureNotice message={browseFailureMessage(search.errorCause, t)} onRetry={() => search.loadMore()} testID="history-more-error" />
        ) : row.status === 'error' ? (
          search.items.length > 0
            ? <RefreshFailureNotice message={browseFailureMessage(search.errorCause, t)} onRetry={() => search.refresh()} testID="history-search-error" />
            : <LoadFailureState error={search.errorCause} notice={browseFailureMessage(search.errorCause, t)} onRetry={() => search.refresh()} testID="history-search-error" />
        ) : search.isSearching ? (
          <Text style={styles.searchStatusText} testID="history-search-empty">{t('history.searchEmpty')}</Text>
        ) : (
          <CenteredEmptyState message={t('history.empty')} />
        );
    }
  };

  const pullToRefresh = usePullToRefresh(search.isLoading, refresh);

  return (
    <TabScreenSafeArea style={styles.safeArea}>
      {linkSelection.topBar}
      {/* Header: the title + view switch scroll away with the links; the search (with the view switch beside it once the title is gone) stays at the top. */}
      <CollapsibleHeaderLayout
        collapsible={
          <View style={styles.collapsibleTop}>
            {/* One line: [archive icon] 보관함 (one line, ellipsized) at the start, the fixed-width List / Grid / Image switch at the end; the search is below. */}
            <View style={styles.titleRow} testID="history-view-controls">
              <ScreenTitle icon={screenIcons.archive} textStyle={styles.title} title={t('history.title')} numberOfLines={1} />
              <View style={styles.viewModeToggle}>
                <ViewModeToggle onChange={changeViewMode} showImage value={viewMode} />
              </View>
            </View>
          </View>
        }
        pinned={({ isCollapsed }) => (
          <View style={styles.pinnedSearch}>
            <View style={styles.searchLine}>
            <View style={styles.searchBox}>
              <SearchField
                clearLabel={t('history.searchClear')}
                onChangeText={setSearchText}
                accessibilityHint={t('history.searchMinHint')}
                placeholder={t('history.searchPlaceholder')}
                testID="history-search"
                value={searchText}
              />
            </View>
            {isCollapsed ? <ViewModeToggle onChange={changeViewMode} showImage value={viewMode} /> : null}
            </View>
            {/* One character: a small hint right under the field (nothing is searched yet). 0 characters: nothing; 2+: the search runs. */}
            {searchText.trim().length === 1 ? (
              <Text accessibilityLiveRegion="polite" style={styles.searchHint} testID="history-search-hint">{t('history.searchMinHint')}</Text>
            ) : null}
          </View>
        )}
        testID="history-fixed-header"
      >
        {list => (
            <AnimatedFlatList
              ref={list.listRef}
              onScroll={list.onScroll}
              scrollEventThrottle={list.scrollEventThrottle}
              contentContainerStyle={[styles.content, list.contentInset(flatRows.length > 0)]}
              extraData={linkSelection.selection}
              data={flatRows}
              initialNumToRender={12}
              keyboardShouldPersistTaps="handled"
              keyExtractor={row => row.key}
              ListHeaderComponent={
                <View>
                  {swipeHint.isVisible ? <HintBanner message={t('hints.savedLinkSwipe')} onDismiss={swipeHint.dismiss} testID="history-swipe-hint" /> : null}
                  {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
                </View>
              }
              maxToRenderPerBatch={10}
              onScrollBeginDrag={closeOpenRow}
              scrollEnabled={swipeScrollEnabled}
              onEndReached={() => (!search.error && !search.moreError ? search.loadMore() : undefined)}
              onContentSizeChange={viewportFill.onContentSizeChange}
              onEndReachedThreshold={END_REACHED_THRESHOLD}
              onLayout={viewportFill.onLayout}
              refreshControl={list.withRefreshOffset(pullToRefresh.refreshControl)}
              // Android: rows scrolled far away drop their native views (and images) entirely.
              removeClippedSubviews={Platform.OS === 'android'}
              renderItem={({ item: row }) => renderFlatRow(row)}
              windowSize={7}
            />
        )}
      </CollapsibleHeaderLayout>
      {itemCardOpen.dialog}
      {linkActions.element}
      {linkSelection.element}
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
        message={t('history.deleteConfirmMessage')}
        onCancel={() => setPendingDeleteItemId(null)}
        onConfirm={() => {
          const itemId = pendingDeleteItemId;
          setPendingDeleteItemId(null);
          if (itemId !== null) {
            runDelete(itemId);
          }
        }}
        title={t('history.deleteConfirmTitle')}
        visible={pendingDeleteItemId !== null}
      />
    </TabScreenSafeArea>
  );
}

const styles = themedStyles(() => ({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  // See DailyInboxScreen's identical remark - this tab screen's viewport already excludes the
  // real (non-overlay) Juple tab bar, so no tabBarHeight/insets.bottom belongs in this padding.
  collapsibleTop: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
  pinnedSearch: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
  // Vertically centered, never stretched: the view switch keeps its own 40dp height (the same as in the title row) beside the search field.
  // The gap below the whole line belongs to the line (not to the field), so it takes no part in the centering.
  searchLine: { alignItems: 'center', columnGap: spacing.sm, flexDirection: 'row', marginBottom: spacing.md },
  content: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.xl,
  },
  // The title row's gap to the search field is the row's own bottom margin (see ScreenTitle's remark on a margin on the title alone).
  titleRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    // 4dp + the pinned search's 8dp top padding = the 12dp gap the screen always had.
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 24,
    fontWeight: '800',
  },
  // The hint sits close under the field (the box's own bottom gap is taken back), so showing it moves the list down by one compact line only.
  searchBox: { flex: 1, minWidth: 0 },
  searchHint: { color: colors.textSecondary, fontSize: 12, marginBottom: spacing.sm, marginTop: -spacing.sm },
  // The switch keeps its natural (fixed) width on the title row's end edge; the title gives way first.
  viewModeToggle: { flexShrink: 0 },
  // The flat list's tiles: the same cells as everywhere, with nothing between lines but their own gap.
  flatGridRow: { flexDirection: 'row' },
  searchStatus: { marginTop: spacing.xl },
  searchStatusText: { color: colors.textSecondary, fontSize: 15, marginTop: spacing.xl, textAlign: 'center' },
  error: {
    color: colors.dangerText,
    fontSize: 14,
    marginTop: spacing.md,
  },
}));
