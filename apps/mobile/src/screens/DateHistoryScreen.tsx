import { useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type ListViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { CenteredEmptyState } from '../components/CenteredEmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ImportantState } from '../components/ImportantState';
import { RefreshFailureNotice } from '../components/RefreshFailureNotice';
import { useAppToast } from '../components/AppToast';
import { useToastBottomAnchor } from '../components/useToastBottomAnchor';
import { SavedLinkRow } from '../components/SavedLinkRow';
import { SavedLinkImageRow } from '../components/SavedLinkImageTile';
import { SavedLinkGridCell } from '../components/SavedLinkGridCard';
import { LinkSortChips } from '../components/LinkSortChips';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { SearchField } from '../components/SearchField';
import { savedLinkGridLayout } from '../components/SavedLinkGridCard';
import { savedLinkLayout } from '../components/savedLinkLayout';
import { useArchiveSearch } from '../items/useArchiveSearch';
import { SwipeableItemRow } from '../components/SwipeableItemRow';
import { closeOpenRow } from '../components/swipeableRowCoordinator';
import { DateSectionHeader, dateAccordionStyles } from '../components/DateAccordion';
import {
  buildDateSectionRows,
  DateSectionErrorRow,
  DATE_SECTION_IMAGE_LINE_STYLE,
  DateSectionGridRow,
  DateSectionSkeletonRow,
  useDateSectionViewability,
  type DateSectionRow,
} from '../components/DateSectionList';
import { buildFlatItemRows, type FlatItemRow } from '../items/flatItemRows';
import { END_REACHED_THRESHOLD, useContinuousViewportFill } from '../items/useContinuousViewportFill';
import { historySectionLabel, historySectionShowsItemDate } from '../items/historyDateGrouping';
import { useHistorySections, type HistorySectionPage } from '../items/useHistorySections';
import { deleteItem, restoreItem, type ItemHistoryEntry, type ItemHistorySection } from '../items/api/itemsApi';
import { shareItem } from '../items/shareItem';
import { useItemCardOpen } from '../items/useItemCardOpen';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, spacing } from '../theme/tokens';
import { isNameSort, useSortPreference, type LinkSortOption } from '../settings/sortPreference';
import { useViewModePreference, type SavedLinkViewMode } from '../settings/viewModePreference';
import { ScreenTitle } from '../components/ScreenTitle';
import { screenIcons } from '../navigation/screenIcons';

export { FIRST_PAGE_SKELETON_ROWS, NEAR_END_ROWS, NEXT_PAGE_SKELETON_ROWS } from '../components/DateSectionList';

function getHistoryDeleteErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('history.errorDeleteFallback');
}

/** Share.share only ever rejects on a genuine native module failure - a user dismissing/canceling the sheet resolves normally, never here. */
function getHistoryShareErrorMessage(t: TFunction): string {
  return t('item.shareError');
}

/** One row of the single History list (see DateSectionRow). */
export type HistoryRow = DateSectionRow<ItemHistoryEntry>;

/** The Archive's flat rows: the shared ones for its links, plus the search status line. */
export type FlatRow = FlatItemRow<ItemHistoryEntry> | { readonly kind: 'searchStatus'; readonly key: string; readonly status: 'loading' | 'empty' | 'error' | 'moreError' };

const archiveAccessors = { idOf: (item: ItemHistoryEntry) => item.id };

/** The Archive's links as flat rows - see buildFlatItemRows (shared with Collection Details). */
export function buildFlatRows(items: readonly ItemHistoryEntry[], viewMode: SavedLinkViewMode): readonly FlatItemRow<ItemHistoryEntry>[] {
  return buildFlatItemRows(items, viewMode, archiveAccessors);
}

type ScreenRow = HistoryRow | FlatRow;

/** The flat rows for the current sections, expansion and loaded pages (pure - see buildDateSectionRows). */
export function buildHistoryRows(
  sections: readonly ItemHistorySection[],
  pages: ReadonlyMap<string, HistorySectionPage>,
  expandedKeys: ReadonlySet<string>,
  viewMode: SavedLinkViewMode,
): readonly HistoryRow[] {
  return buildDateSectionRows(sections, pages, expandedKeys, viewMode, item => item.id);
}

/**
 * 기록: every link the user has saved, in 오늘 / 어제 / 이번 주 / month sections (the user's local
 * calendar, computed by the server - see useHistorySections). Opening it loads only the sections and
 * their exact counts; a section's links load when it is expanded, a page at a time as it scrolls,
 * with skeleton rows where they are about to appear.
 *
 * One virtualized FlatList holds everything: headers, the loaded rows of expanded sections (in
 * image view, one list row per pair of tiles), skeletons and a retry row. Collapsing a section
 * removes its rows from the list (they unmount); what was loaded stays in memory for this visit,
 * so reopening it is instant. Only rows the list actually mounts (near the viewport) render their
 * images - nothing is prefetched.
 */
export function DateHistoryScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const authenticatedRequest = useAuthenticatedApi();
  const { showUndoToast } = useAppToast();
  const { viewMode, changeViewMode } = useViewModePreference('historyViewMode');
  // 시간순 / 이름순: this screen's own preference, independent of List / Grid / Image. The Archive offers the two plain
  // orders (newest first, A-Z) - a stored direction flip from another screen's chips reads as its order.
  const { sortOption, setSortOption, isReady: isSortReady } = useSortPreference('historyLinkSort');
  const archiveSort: 'time' | 'name' = isNameSort(sortOption) ? 'name' : 'time';
  const effectiveSort: LinkSortOption = archiveSort === 'name' ? 'title' : 'newest';
  const listRef = useRef<FlatList<ScreenRow>>(null);
  // AppToastHost renders above NavigationContainer (root coordinate space), so unlike a
  // screen-local Toast this needs the actual bottom tab bar height, not 0 - otherwise the Toast
  // sits under the tab bar, over the Android system navigation area.
  const tabBarHeight = useBottomTabBarHeight();
  useToastBottomAnchor(tabBarHeight);

  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string> | null>(null);
  const expandedRef = useRef<ReadonlySet<string>>(new Set());
  expandedRef.current = expandedKeys ?? new Set();
  const isExpanded = useCallback((key: string) => expandedRef.current.has(key), []);

  const { sections, pages, isLoading, isRefreshing, error, refresh, ensureLoaded, loadMore, removeItem } = useHistorySections(isExpanded, { enabled: isSortReady && archiveSort === 'time' });

  // 보관함 search and 이름순: the whole archive on the server, as ONE flat paged list (see useArchiveSearch). 시간순 with
  // empty/short text = the date sections.
  const [searchText, setSearchText] = useState('');
  const search = useArchiveSearch(searchText, archiveSort, isSortReady);

  const [actionInFlightItemId, setActionInFlightItemId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Delete confirmation is a declarative ConfirmDialog keyed off this - null means closed, an id
  // means the dialog is open for that item (mirrors DailyInboxScreen's same pattern).
  const [pendingDeleteItemId, setPendingDeleteItemId] = useState<number | null>(null);

  // Opening History expands 오늘 (or, without links today, the newest section) - once; after that
  // the user's own choices stand, across refreshes.
  useEffect(() => {
    if (expandedKeys !== null || sections.length === 0) {
      return;
    }
    const initial = sections.find(section => section.kind === 'today') ?? sections[0];
    setExpandedKeys(new Set([initial.key]));
  }, [sections, expandedKeys]);

  // An expanded section that has never loaded fetches its first page (collapsed ones never do).
  useEffect(() => {
    expandedKeys?.forEach(key => ensureLoaded(key));
  }, [expandedKeys, sections, ensureLoaded]);

  const toggleSection = (key: string) => {
    setExpandedKeys(previous => {
      const next = new Set(previous ?? []);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const runDelete = async (itemId: number) => {
    if (actionInFlightItemId !== null) {
      return;
    }

    setActionInFlightItemId(itemId);
    setActionError(null);
    try {
      await deleteItem(authenticatedRequest, itemId);
      removeItem(itemId);
      search.removeItem(itemId);
      showUndoToast({ actionLabel: t('toast.undoAction'), message: t('toast.deleteSuccess'), noticeTitle: t('common.notice'), confirmLabel: t('common.confirm'), undoErrorMessage: t('toast.undoDeleteError'), onUndo: async () => { await restoreItem(authenticatedRequest, itemId); refresh(); search.refresh(); } });
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
  const itemCardOpen = useItemCardOpen(
    (itemId, openContext) => navigation.navigate('ItemDetails', { itemId, openContext }),
    () => { refresh(); search.refresh(); },
  );

  // One stable open callback for every image tile (the tiles are memoized) - the same open path as a card.
  const itemCardOpenRef = useRef(itemCardOpen);
  itemCardOpenRef.current = itemCardOpen;
  const openItem = useCallback((item: ItemHistoryEntry) => { itemCardOpenRef.current.open(item).catch(() => undefined); }, []);

  const rows = useMemo(
    () => buildHistoryRows(sections, pages, expandedKeys ?? new Set(), viewMode),
    [sections, pages, expandedKeys, viewMode],
  );

  // A section's next page is asked for once its loaded end comes on screen (see useDateSectionViewability).
  // The list also holds search rows (no section) - those are never reported to it.
  const { onViewableItemsChanged: reportSectionRows, viewabilityConfig } = useDateSectionViewability(pages, loadMore);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: readonly ListViewToken[] }) => {
    reportSectionRows({ viewableItems: viewableItems.filter(token => !!token.item && 'section' in (token.item as object)) });
  }).current;

  // The flat list (a search, and/or 이름순): the server's pages in the server's order - newest first under 시간순, A-Z
  // under 이름순 - packed for the chosen view. Re-packing for another view never asks the server again.
  const flatRows = useMemo<readonly FlatRow[]>(() => {
    if (!search.isFlat) {
      return [];
    }
    const rowsOut: FlatRow[] = [...buildFlatRows(search.items, viewMode)];
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
  }, [search.error, search.isFlat, search.isLoading, search.items, search.moreError, search.settledTerm, viewMode]);

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
  const viewportFill = useContinuousViewportFill({ advance: advanceFlat, dataKey: flatFillKey, enabled: search.isFlat });

  const changeSort = (next: LinkSortOption) => {
    if (next === effectiveSort) {
      return;
    }
    setSortOption(next);
    // The two orders share no row positions, so the old offset means nothing in the new one: start at the top.
    listRef.current?.scrollToOffset({ animated: false, offset: 0 });
  };

  const renderFlatRow = (row: FlatRow) => {
    switch (row.kind) {
      case 'flatItem':
        return (
          <SwipeableItemRow
            containerStyle={savedLinkLayout.card}
            disabled={actionInFlightItemId !== null}
            onDelete={() => confirmDelete(row.item.id)}
            onPress={() => { itemCardOpen.open(row.item).catch(() => undefined); }}
            onShare={row.item.isCollectionLocked ? undefined : () => runShare(row.item)}
          >
            <SavedLinkRow dateDisplayMode={row.dateDisplayMode} isActionInFlight={actionInFlightItemId === row.item.id} item={row.item} preferEffectiveThumbnail />
          </SwipeableItemRow>
        );
      case 'flatGridRow':
        return (
          <View style={styles.flatGridRow} testID={`history-flat-grid-row-${row.key}`}>
            {row.items.map(item => (
              <SavedLinkGridCell
                dateDisplayMode={row.dateDisplayMode}
                disabled={actionInFlightItemId !== null}
                isActionInFlight={actionInFlightItemId === item.id}
                item={item}
                key={item.id}
                onDelete={() => confirmDelete(item.id)}
                onPress={() => { itemCardOpen.open(item).catch(() => undefined); }}
                onShare={item.isCollectionLocked ? undefined : () => runShare(item)}
                preferEffectiveThumbnail
              />
            ))}
            {row.items.length === 1 ? <View style={savedLinkGridLayout.cell} /> : null}
          </View>
        );
      case 'flatImageRow':
        return <SavedLinkImageRow items={row.items} onPress={openItem} testID={`history-flat-image-row-${row.key}`} />;
      case 'searchStatus':
        return row.status === 'loading' ? (
          <ActivityIndicator style={styles.searchStatus} testID="history-search-loading" />
        ) : row.status === 'moreError' ? (
          <RefreshFailureNotice onRetry={() => search.loadMore()} testID="history-more-error" />
        ) : row.status === 'error' ? (
          <ImportantState onRetry={() => search.refresh()} testID="history-search-error" />
        ) : (
          <Text style={styles.searchStatusText} testID={`history-search-${row.status}`}>{t('history.searchEmpty')}</Text>
        );
    }
  };

  const renderRow = ({ item: row }: { item: ScreenRow }) => {
    if (row.kind.startsWith('flat') || row.kind === 'searchStatus') {
      return renderFlatRow(row as FlatRow);
    }
    switch (row.kind) {
      case 'header':
        return (
          <DateSectionHeader
            count={row.section.count}
            isExpanded={expandedKeys?.has(row.section.key) ?? false}
            label={historySectionLabel(row.section, t)}
            onPress={() => toggleSection(row.section.key)}
          />
        );
      case 'item': {
        const item = row.item;
        return (
          <SwipeableItemRow
            containerStyle={[dateAccordionStyles.row, row.isLast && dateAccordionStyles.rowLast]}
            disabled={actionInFlightItemId !== null}
            onDelete={() => confirmDelete(item.id)}
            onPress={() => { itemCardOpen.open(item).catch(() => undefined); }}
            onShare={item.isCollectionLocked ? undefined : () => runShare(item)}
          >
            {/* Same effective-thumbnail rule as Home (see DailyInboxScreen). */}
            <SavedLinkRow
              dateDisplayMode={historySectionShowsItemDate(row.section.kind) ? 'dateTime' : 'time'}
              isActionInFlight={actionInFlightItemId === item.id}
              item={item}
              preferEffectiveThumbnail
            />
          </SwipeableItemRow>
        );
      }
      case 'gridRow':
        // Image view: each pair of tiles is one list row, and together they are the body of the
        // header's card (see dateAccordionStyles.gridRow*).
        return (
          <DateSectionGridRow isFirst={row.isFirst} isLast={row.isLast} testID={`history-grid-row-${row.section.key}-${row.position}`}>
            {row.items.map(item => (
              <SavedLinkGridCell
                dateDisplayMode={historySectionShowsItemDate(row.section.kind) ? 'dateTime' : 'time'}
                disabled={actionInFlightItemId !== null}
                isActionInFlight={actionInFlightItemId === item.id}
                item={item}
                key={item.id}
                onDelete={() => confirmDelete(item.id)}
                onPress={() => { itemCardOpen.open(item).catch(() => undefined); }}
                onShare={item.isCollectionLocked ? undefined : () => runShare(item)}
                preferEffectiveThumbnail
              />
            ))}
          </DateSectionGridRow>
        );
      case 'imageRow':
        // Image view inside a date card: lines of tiles as the card's body (one virtualized list row per line).
        return (
          <DateSectionGridRow isFirst={row.isFirst} isLast={row.isLast} style={[DATE_SECTION_IMAGE_LINE_STYLE, row.isLast && styles.imageSectionLast]} testID={`history-image-row-${row.section.key}-${row.position}`}>
            <SavedLinkImageRow items={row.items} onPress={openItem} testID={`history-image-line-${row.section.key}-${row.position}`} />
          </DateSectionGridRow>
        );
      case 'skeleton':
        return <DateSectionSkeletonRow grid={row.grid} image={row.image} isFirst={row.isFirst} isLast={row.isLast} testID="history-skeleton" />;
      case 'error':
        return (
          <DateSectionErrorRow
            onRetry={() => {
              const page = pages.get(row.section.key);
              if (page && page.items.length > 0) {
                loadMore(row.section.key);
              } else {
                ensureLoaded(row.section.key);
              }
            }}
            retryTestID={`history-section-retry-${row.section.key}`}
            testID={`history-section-error-${row.section.key}`}
          />
        );
    }
  };

  // Until the stored sort is known nothing is requested (see useSortPreference), so there is nothing to show but the spinner.
  if (!isSortReady || (isLoading && sections.length === 0 && !error && !search.isFlat)) {
    return (
      <SafeAreaView edges={['top']} style={styles.loadingContainer}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <FlatList
        contentContainerStyle={styles.content}
        data={search.isFlat ? flatRows : rows}
        ref={listRef}
        initialNumToRender={12}
        keyboardShouldPersistTaps="handled"
        keyExtractor={row => row.key}
        ListEmptyComponent={!error && !search.isFlat ? <CenteredEmptyState message={t('history.empty')} /> : undefined}
        ListHeaderComponent={
          <View>
            <View style={styles.titleRow}>
              <ScreenTitle icon={screenIcons.archive} textStyle={styles.title} title={t('history.title')} />
            </View>
            {/* [시간순 | 이름순] how links are ordered (start), [List | Grid | Image] how each is shown (end), then the search. */}
            <View style={styles.sortRow}>
              <LinkSortChips
                dateLabel={t('collections.sortDate')}
                dateNewestA11yLabel={t('collections.sortDateNewestA11y')}
                dateOldestA11yLabel={t('collections.sortDateOldestA11y')}
                nameAscA11yLabel={t('collections.sortNameAscA11y')}
                nameDescA11yLabel={t('collections.sortNameDescA11y')}
                nameLabel={t('collections.sortName')}
                onPressDate={() => changeSort('newest')}
                onPressName={() => changeSort('title')}
                sort={effectiveSort}
                testIDPrefix="history-sort"
              />
              <ViewModeToggle onChange={changeViewMode} showImage style={styles.viewModeToggle} value={viewMode} />
            </View>
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
            {/* One character: a small hint right under the field (nothing is searched yet). 0 characters: nothing; 2+: the search runs. */}
            {searchText.trim().length === 1 ? (
              <Text accessibilityLiveRegion="polite" style={styles.searchHint} testID="history-search-hint">{t('history.searchMinHint')}</Text>
            ) : null}
            {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
            {/* A failed load belongs to the result area: under the query controls (search, then date), above the content. */}
            {error && !search.isFlat ? <ImportantState compact onRetry={() => refresh()} testID="history-sections-error" /> : null}
          </View>
        }
        maxToRenderPerBatch={10}
        onScrollBeginDrag={closeOpenRow}
        onEndReached={() => (search.isFlat ? search.loadMore() : undefined)}
        onContentSizeChange={viewportFill.onContentSizeChange}
        onEndReachedThreshold={END_REACHED_THRESHOLD}
        onLayout={viewportFill.onLayout}
        onViewableItemsChanged={onViewableItemsChanged}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => (search.isFlat ? search.refresh() : refresh())} />}
        // Android: rows scrolled far away drop their native views (and images) entirely.
        removeClippedSubviews={Platform.OS === 'android'}
        renderItem={renderRow}
        viewabilityConfig={viewabilityConfig}
        windowSize={7}
      />
      {itemCardOpen.dialog}
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
    </SafeAreaView>
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
  },
  // See DailyInboxScreen's identical remark - this tab screen's viewport already excludes the
  // real (non-overlay) Juple tab bar, so no tabBarHeight/insets.bottom belongs in this padding.
  content: {
    flexGrow: 1,
    padding: spacing.xl,
  },
  // The title row's gap to the search field is the row's own bottom margin (see ScreenTitle's remark on a margin on the title alone).
  titleRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 24,
    fontWeight: '800',
  },
  // The hint sits close under the field (the box's own bottom gap is taken back), so showing it moves the list down by one compact line only.
  searchBox: { marginBottom: spacing.md },
  searchHint: { color: colors.textSecondary, fontSize: 12, marginBottom: spacing.sm, marginTop: -spacing.sm },
  // Wraps only when the sort chips and the three-option view switch genuinely do not fit side by side (the switch then keeps the end edge).
  sortRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  viewModeToggle: { marginStart: 'auto' },
  // The last line of a date card's picture body sits a little off the card's bottom edge.
  imageSectionLast: { paddingBottom: spacing.xs },
  // The flat list's tiles: the same cells as everywhere, with nothing between lines but their own gap.
  flatGridRow: { flexDirection: 'row' },
  searchStatus: { marginTop: spacing.xl },
  searchStatusText: { color: colors.textSecondary, fontSize: 15, marginTop: spacing.xl, textAlign: 'center' },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginTop: spacing.md,
  },
});
