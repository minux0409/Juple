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
import { useAppToast } from '../components/AppToast';
import { useToastBottomAnchor } from '../components/useToastBottomAnchor';
import { SavedLinkRow } from '../components/SavedLinkRow';
import { SavedLinkGridCell } from '../components/SavedLinkGridCard';
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
  DateSectionGridRow,
  DateSectionSkeletonRow,
  useDateSectionViewability,
  type DateSectionRow,
} from '../components/DateSectionList';
import { historySectionLabel, historySectionShowsItemDate } from '../items/historyDateGrouping';
import { useHistorySections, type HistorySectionPage } from '../items/useHistorySections';
import { deleteItem, restoreItem, type ItemHistoryEntry, type ItemHistorySection } from '../items/api/itemsApi';
import { shareItem } from '../items/shareItem';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, spacing } from '../theme/tokens';
import { useViewModePreference } from '../settings/viewModePreference';
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

/** What the same list shows while a search is active: a flat result list (or a line of two tiles), or a status line. */
export type SearchRow =
  | { readonly kind: 'searchItem'; readonly key: string; readonly item: ItemHistoryEntry }
  | { readonly kind: 'searchGridRow'; readonly key: string; readonly items: readonly ItemHistoryEntry[] }
  | { readonly kind: 'searchStatus'; readonly key: string; readonly status: 'loading' | 'empty' | 'error' };

type ScreenRow = HistoryRow | SearchRow;

/** The flat rows for the current sections, expansion and loaded pages (pure - see buildDateSectionRows). */
export function buildHistoryRows(
  sections: readonly ItemHistorySection[],
  pages: ReadonlyMap<string, HistorySectionPage>,
  expandedKeys: ReadonlySet<string>,
  viewMode: 'list' | 'grid',
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
  // AppToastHost renders above NavigationContainer (root coordinate space), so unlike a
  // screen-local Toast this needs the actual bottom tab bar height, not 0 - otherwise the Toast
  // sits under the tab bar, over the Android system navigation area.
  const tabBarHeight = useBottomTabBarHeight();
  useToastBottomAnchor(tabBarHeight);

  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string> | null>(null);
  const expandedRef = useRef<ReadonlySet<string>>(new Set());
  expandedRef.current = expandedKeys ?? new Set();
  const isExpanded = useCallback((key: string) => expandedRef.current.has(key), []);

  const { sections, pages, isLoading, isRefreshing, error, refresh, ensureLoaded, loadMore, removeItem } = useHistorySections(isExpanded);

  // 보관함 search: the whole archive on the server (see useArchiveSearch). Empty/short text = the normal accordion.
  const [searchText, setSearchText] = useState('');
  const search = useArchiveSearch(searchText);

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

  // Search mode: newest-first results, flat (no date accordion while searching), List or Grid like the Archive.
  const searchRows = useMemo<readonly SearchRow[]>(() => {
    if (!search.isSearching) {
      return [];
    }
    const rowsOut: SearchRow[] = [];
    if (viewMode === 'grid') {
      for (let index = 0; index < search.items.length; index += 2) {
        const pair = search.items.slice(index, index + 2);
        rowsOut.push({ kind: 'searchGridRow', key: `sg:${pair[0].id}`, items: pair });
      }
    } else {
      search.items.forEach(item => rowsOut.push({ kind: 'searchItem', key: `si:${item.id}`, item }));
    }
    // Under the results (or alone) only a status: loading the first page, nothing found, or a failed search.
    if (search.error) {
      rowsOut.push({ kind: 'searchStatus', key: 'ss:error', status: 'error' });
    } else if (search.isLoading && search.items.length === 0) {
      rowsOut.push({ kind: 'searchStatus', key: 'ss:loading', status: 'loading' });
    } else if (search.items.length === 0 && search.settledTerm !== null) {
      rowsOut.push({ kind: 'searchStatus', key: 'ss:empty', status: 'empty' });
    }
    return rowsOut;
  }, [search.error, search.isLoading, search.isSearching, search.items, search.settledTerm, viewMode]);

  const renderSearchRow = (row: SearchRow) => {
    switch (row.kind) {
      case 'searchItem':
        return (
          <SwipeableItemRow
            containerStyle={savedLinkLayout.card}
            disabled={actionInFlightItemId !== null}
            onDelete={() => confirmDelete(row.item.id)}
            onPress={() => navigation.navigate('ItemDetails', { itemId: row.item.id })}
            onShare={() => runShare(row.item)}
          >
            <SavedLinkRow dateDisplayMode="dateTime" isActionInFlight={actionInFlightItemId === row.item.id} item={row.item} preferEffectiveThumbnail />
          </SwipeableItemRow>
        );
      case 'searchGridRow':
        return (
          <View style={styles.searchGridRow} testID={`history-search-grid-row-${row.key}`}>
            {row.items.map(item => (
              <SavedLinkGridCell
                dateDisplayMode="dateTime"
                disabled={actionInFlightItemId !== null}
                isActionInFlight={actionInFlightItemId === item.id}
                item={item}
                key={item.id}
                onDelete={() => confirmDelete(item.id)}
                onPress={() => navigation.navigate('ItemDetails', { itemId: item.id })}
                onShare={() => runShare(item)}
                preferEffectiveThumbnail
              />
            ))}
            {row.items.length === 1 ? <View style={savedLinkGridLayout.cell} /> : null}
          </View>
        );
      case 'searchStatus':
        return row.status === 'loading' ? (
          <ActivityIndicator style={styles.searchStatus} testID="history-search-loading" />
        ) : (
          <Text style={[styles.searchStatusText, row.status === 'error' && styles.error]} testID={`history-search-${row.status}`}>
            {row.status === 'error' ? t('history.searchError') : t('history.searchEmpty')}
          </Text>
        );
    }
  };

  const renderRow = ({ item: row }: { item: ScreenRow }) => {
    if (row.kind === 'searchItem' || row.kind === 'searchGridRow' || row.kind === 'searchStatus') {
      return renderSearchRow(row);
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
            onPress={() => {
              navigation.navigate('ItemDetails', { itemId: item.id });
            }}
            onShare={() => runShare(item)}
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
                onPress={() => navigation.navigate('ItemDetails', { itemId: item.id })}
                onShare={() => runShare(item)}
                preferEffectiveThumbnail
              />
            ))}
          </DateSectionGridRow>
        );
      case 'skeleton':
        return <DateSectionSkeletonRow grid={row.grid} isFirst={row.isFirst} isLast={row.isLast} testID="history-skeleton" />;
      case 'error':
        return (
          <DateSectionErrorRow
            message={row.message}
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

  if (isLoading && sections.length === 0 && !error && !search.isSearching) {
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
        data={search.isSearching ? searchRows : rows}
        initialNumToRender={12}
        keyboardShouldPersistTaps="handled"
        keyExtractor={row => row.key}
        ListEmptyComponent={!error && !search.isSearching ? <CenteredEmptyState message={t('history.empty')} /> : undefined}
        ListHeaderComponent={
          <View>
            <View style={styles.titleRow}>
              <ScreenTitle icon={screenIcons.archive} textStyle={styles.title} title={t('history.title')} />
              <ViewModeToggle onChange={changeViewMode} value={viewMode} />
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
            {error && !search.isSearching ? <Text style={styles.error}>{error}</Text> : null}
            {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
          </View>
        }
        maxToRenderPerBatch={10}
        onScrollBeginDrag={closeOpenRow}
        onEndReached={() => search.loadMore()}
        onEndReachedThreshold={0.5}
        onViewableItemsChanged={onViewableItemsChanged}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => (search.isSearching ? search.refresh() : refresh())} />}
        // Android: rows scrolled far away drop their native views (and images) entirely.
        removeClippedSubviews={Platform.OS === 'android'}
        renderItem={renderRow}
        viewabilityConfig={viewabilityConfig}
        windowSize={7}
      />
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
  // [보관함 ........ List/Grid] on one row, vertically centered; the gap to the list is this row's own
  // bottom margin (a margin on the title alone made the toggle sit lower than the title).
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
  searchGridRow: { flexDirection: 'row' },
  searchStatus: { marginTop: spacing.xl },
  searchStatusText: { color: colors.textSecondary, fontSize: 15, marginTop: spacing.xl, textAlign: 'center' },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginTop: spacing.md,
  },
});
