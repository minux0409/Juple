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
  Pressable,
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
import { SavedLinkGridCardSkeleton, SavedLinkRowSkeleton } from '../components/SavedLinkSkeleton';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { SwipeableItemRow } from '../components/SwipeableItemRow';
import { closeOpenRow } from '../components/swipeableRowCoordinator';
import { DateSectionHeader, dateAccordionStyles } from '../components/DateAccordion';
import { historySectionLabel, historySectionShowsItemDate } from '../items/historyDateGrouping';
import { useHistorySections, type HistorySectionPage } from '../items/useHistorySections';
import { deleteItem, restoreItem, type ItemHistoryEntry, type ItemHistorySection } from '../items/api/itemsApi';
import { shareItem } from '../items/shareItem';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, minTouchTarget, spacing } from '../theme/tokens';
import { useViewModePreference } from '../settings/viewModePreference';

/** Skeleton rows while a section's first page loads (never more than the section holds). */
export const FIRST_PAGE_SKELETON_ROWS = 6;
/** Skeleton rows under the loaded ones while a section's next page loads. */
export const NEXT_PAGE_SKELETON_ROWS = 2;
/** A section's next page is requested once a row this close to its loaded end is on screen. */
export const NEAR_END_ROWS = 8;
const GRID_COLUMNS = 2;

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

/**
 * One row of the single History list. Only expanded sections contribute anything below their
 * header, and only what they have loaded (plus a few skeletons) - so the list's length follows
 * what the user opened, never how many links exist.
 */
export type HistoryRow =
  | { readonly kind: 'header'; readonly key: string; readonly section: ItemHistorySection }
  | { readonly kind: 'item'; readonly key: string; readonly section: ItemHistorySection; readonly item: ItemHistoryEntry; readonly position: number; readonly isLast: boolean }
  | { readonly kind: 'gridRow'; readonly key: string; readonly section: ItemHistorySection; readonly items: readonly ItemHistoryEntry[]; readonly position: number; readonly isFirst: boolean; readonly isLast: boolean }
  | { readonly kind: 'skeleton'; readonly key: string; readonly section: ItemHistorySection; readonly grid: boolean; readonly isFirst: boolean; readonly isLast: boolean }
  | { readonly kind: 'error'; readonly key: string; readonly section: ItemHistorySection; readonly message: string };

/** The flat rows for the current sections, expansion and loaded pages (pure - see HistoryRow). */
export function buildHistoryRows(
  sections: readonly ItemHistorySection[],
  pages: ReadonlyMap<string, HistorySectionPage>,
  expandedKeys: ReadonlySet<string>,
  viewMode: 'list' | 'grid',
): readonly HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const section of sections) {
    rows.push({ kind: 'header', key: `h:${section.key}`, section });
    if (!expandedKeys.has(section.key)) {
      continue;
    }
    const page = pages.get(section.key);
    const items = page?.items ?? [];
    const firstLoad = !page || (page.isLoading && items.length === 0);
    const body: HistoryRow[] = [];
    const grid = viewMode === 'grid';

    if (grid) {
      for (let index = 0; index < items.length; index += GRID_COLUMNS) {
        body.push({ kind: 'gridRow', key: `g:${section.key}:${items[index].id}`, section, items: items.slice(index, index + GRID_COLUMNS), position: index, isFirst: false, isLast: false });
      }
    } else {
      items.forEach((item, position) => body.push({ kind: 'item', key: `i:${item.id}`, section, item, position, isLast: false }));
    }

    // Only while a request is actually on its way: a screenful for a first page, a couple under
    // the loaded rows for a next one - never just because more exist (see NEAR_END_ROWS).
    const skeletons = firstLoad
      ? Math.min(section.count, FIRST_PAGE_SKELETON_ROWS)
      : page.isLoadingMore
        ? NEXT_PAGE_SKELETON_ROWS
        : 0;
    const skeletonRows = grid ? Math.ceil(skeletons / GRID_COLUMNS) : skeletons;
    for (let index = 0; index < skeletonRows; index++) {
      body.push({ kind: 'skeleton', key: `s:${section.key}:${index}`, section, grid, isFirst: false, isLast: false });
    }
    if (page?.error) {
      body.push({ kind: 'error', key: `e:${section.key}`, section, message: page.error });
    }

    body.forEach((row, index) => {
      const isFirst = index === 0;
      const isLast = index === body.length - 1;
      if (row.kind === 'gridRow' || row.kind === 'skeleton') {
        rows.push({ ...row, isFirst, isLast });
      } else if (row.kind === 'item') {
        rows.push({ ...row, isLast });
      } else {
        rows.push(row);
      }
    });
  }
  return rows;
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
      showUndoToast({ actionLabel: t('toast.undoAction'), message: t('toast.deleteSuccess'), noticeTitle: t('common.notice'), confirmLabel: t('common.confirm'), undoErrorMessage: t('toast.undoDeleteError'), onUndo: async () => { await restoreItem(authenticatedRequest, itemId); refresh(); } });
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

  // A section's next page is asked for once one of its last NEAR_END_ROWS loaded links (or its
  // skeleton rows) comes on screen - only for that section, and only while it has more.
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: readonly ListViewToken[] }) => {
    const wanted = new Set<string>();
    for (const token of viewableItems) {
      const row = token.item as HistoryRow | undefined;
      if (!row || row.kind === 'header' || row.kind === 'error') {
        continue;
      }
      const page = pagesRef.current.get(row.section.key);
      if (!page?.nextCursor) {
        continue;
      }
      const reached = row.kind === 'skeleton' ? page.items.length : row.position + (row.kind === 'gridRow' ? row.items.length : 1);
      if (page.items.length - reached < NEAR_END_ROWS) {
        wanted.add(row.section.key);
      }
    }
    wanted.forEach(key => loadMoreRef.current(key));
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 10, minimumViewTime: 0 }).current;

  const renderRow = ({ item: row }: { item: HistoryRow }) => {
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
          <View
            style={[dateAccordionStyles.gridRow, row.isFirst && dateAccordionStyles.gridRowFirst, row.isLast && dateAccordionStyles.gridRowLast]}
            testID={`history-grid-row-${row.section.key}-${row.position}`}
          >
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
          </View>
        );
      case 'skeleton':
        return row.grid ? (
          <View style={[dateAccordionStyles.gridRow, row.isFirst && dateAccordionStyles.gridRowFirst, row.isLast && dateAccordionStyles.gridRowLast]}>
            {Array.from({ length: GRID_COLUMNS }, (_, index) => (
              <View key={index} style={styles.gridSkeletonCell}>
                <SavedLinkGridCardSkeleton testID="history-skeleton" />
              </View>
            ))}
          </View>
        ) : (
          <View style={[dateAccordionStyles.row, styles.skeletonRow, row.isLast && dateAccordionStyles.rowLast]}>
            <SavedLinkRowSkeleton testID="history-skeleton" />
          </View>
        );
      case 'error':
        return (
          <View style={[dateAccordionStyles.row, dateAccordionStyles.rowLast, styles.errorRow]} testID={`history-section-error-${row.section.key}`}>
            <Text style={styles.errorRowText}>{row.message}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                const page = pages.get(row.section.key);
                if (page && page.items.length > 0) {
                  loadMore(row.section.key);
                } else {
                  ensureLoaded(row.section.key);
                }
              }}
              style={styles.retryButton}
              testID={`history-section-retry-${row.section.key}`}
            >
              <Text style={styles.retryLabel}>{t('history.retry')}</Text>
            </Pressable>
          </View>
        );
    }
  };

  if (isLoading && sections.length === 0 && !error) {
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
        data={rows}
        initialNumToRender={12}
        keyExtractor={row => row.key}
        ListEmptyComponent={!error ? <CenteredEmptyState message={t('history.empty')} /> : undefined}
        ListHeaderComponent={
          <View>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{t('history.title')}</Text>
              <ViewModeToggle onChange={changeViewMode} value={viewMode} />
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
          </View>
        }
        maxToRenderPerBatch={10}
        onScrollBeginDrag={closeOpenRow}
        onViewableItemsChanged={onViewableItemsChanged}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
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
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
    marginBottom: spacing.md,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginTop: spacing.md,
  },
  skeletonRow: { backgroundColor: colors.surface, overflow: 'hidden' },
  gridSkeletonCell: { flexBasis: '50%', maxWidth: '50%', paddingHorizontal: 2 },
  errorRow: { alignItems: 'center', backgroundColor: colors.surface, flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  errorRowText: { color: colors.danger, flex: 1, fontSize: 14 },
  retryButton: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  retryLabel: { color: colors.brand, fontSize: 14, fontWeight: '700' },
});
