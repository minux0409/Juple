import { useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
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
import { SwipeableItemRow } from '../components/SwipeableItemRow';
import { closeOpenRow } from '../components/swipeableRowCoordinator';
import { DateSectionHeader, dateAccordionStyles } from '../components/DateAccordion';
import { useNearEndLoadMore } from '../components/useNearEndLoadMore';
import { groupHistoryByLocalDate, todayDateKey } from '../items/historyDateGrouping';
import { useItemHistory } from '../items/useItemHistory';
import { deleteItem, restoreItem, type ItemHistoryEntry } from '../items/api/itemsApi';
import { shareItem } from '../items/shareItem';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, spacing } from '../theme/tokens';
import { useViewModePreference } from '../settings/viewModePreference';

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
 * 기록: every URL the user has ever saved, grouped by the date it was originally saved
 * (SavedAtUtc, converted to the device's local calendar date - see historyDateGrouping.ts) -
 * never the Item's current Inbox/Wishlist/Archived state. A page boundary landing mid-day merges
 * into the same on-screen section since grouping runs over the whole accumulated flat list from
 * useItemHistory, not per-page.
 *
 * Each date section is an independent accordion: today starts expanded, older dates start
 * collapsed (rendered with zero rows via SectionList's own `data`, not a separate component), and
 * the user's expand/collapse choices are only initialized once (not reset on every refetch).
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
  const { items, isLoading, isRefreshing, isLoadingMore, error, hasMore, refresh, loadMore, removeItem } =
    useItemHistory();

  // Older dates start collapsed, so a page can land without the list growing at all - the near-end
  // re-check (see useNearEndLoadMore) keeps paging while the end is within about one screen.
  const nearEndLoadMore = useNearEndLoadMore({ hasMore, isLoadingMore, loadedCount: items.length, loadMore });

  const sections = useMemo(() => groupHistoryByLocalDate(items, t), [items, t]);

  const [expandedDateKeys, setExpandedDateKeys] = useState<ReadonlySet<string> | null>(null);
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
      removeItem(itemId);
      showUndoToast({ actionLabel: t('toast.undoAction'), message: t('toast.deleteSuccess'), noticeTitle: t('common.notice'), confirmLabel: t('common.confirm'), undoErrorMessage: t('toast.undoDeleteError'), onUndo: async () => { await restoreItem(authenticatedRequest, itemId); await refresh(); } });
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

  useEffect(() => {
    if (expandedDateKeys !== null || sections.length === 0) {
      return;
    }
    const initialKey = sections.find(section => section.dateKey === todayDateKey())?.dateKey
      ?? sections[0]?.dateKey;
    if (initialKey) {
      setExpandedDateKeys(new Set([initialKey]));
    }
  }, [sections, expandedDateKeys]);

  const toggleSection = (dateKey: string) => {
    setExpandedDateKeys(previous => {
      const next = new Set(previous ?? []);
      if (next.has(dateKey)) {
        next.delete(dateKey);
      } else {
        next.add(dateKey);
      }
      return next;
    });
  };

  if (isLoading && items.length === 0 && !error) {
    return (
      <SafeAreaView edges={['top']} style={styles.loadingContainer}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <SectionList
        contentContainerStyle={styles.content}
        sections={sections.map(section => ({
          ...section,
          data: viewMode === 'list' && expandedDateKeys?.has(section.dateKey) ? section.items : [],
        }))}
        keyExtractor={item => item.id.toString()}
        {...nearEndLoadMore}
        onEndReached={loadMore}
        // About one screen ahead, so the next page is usually in place before the user reaches it.
        onEndReachedThreshold={1}
        onScrollBeginDrag={closeOpenRow}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
        stickySectionHeadersEnabled={false}
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
        ListEmptyComponent={!error ? <CenteredEmptyState message={t('history.empty')} /> : undefined}
        renderSectionHeader={({ section }) => (
          <DateSectionHeader
            count={section.items.length}
            isExpanded={expandedDateKeys?.has(section.dateKey) ?? false}
            label={section.label}
            onPress={() => toggleSection(section.dateKey)}
          />
        )}
        renderItem={({ item, index, section }) => {
          const isLast = index === section.data.length - 1;
          return (
            <SwipeableItemRow
              containerStyle={[dateAccordionStyles.row, isLast && dateAccordionStyles.rowLast]}
              disabled={actionInFlightItemId !== null}
              onDelete={() => confirmDelete(item.id)}
              onPress={() => {
                navigation.navigate('ItemDetails', { itemId: item.id });
              }}
              onShare={() => runShare(item)}
            >
              {/* Same effective-thumbnail rule as Home (see DailyInboxScreen) - now that reordering
                  a cover in ItemDetails is a real, everyday action (see effectiveImages.ts), a
                  saved link's thumbnail here must match what Home/ItemDetails show for the exact
                  same Item, or a reorder would silently look "undone" the moment the user opens
                  History. No layout change - purely which single image this same row picks. */}
              <SavedLinkRow
                dateDisplayMode={section.showItemDate ? 'dateTime' : 'time'}
                isActionInFlight={actionInFlightItemId === item.id}
                item={item}
                preferEffectiveThumbnail
              />
            </SwipeableItemRow>
          );
        }}
        renderSectionFooter={({ section }) => {
          if (viewMode !== 'grid' || !expandedDateKeys?.has(section.dateKey)) {
            return null;
          }
          // Image view: the tiles are the body of the same accordion card as the header above -
          // side and bottom borders, rounded bottom corners and inner padding close the card, just
          // like the list view's last row does (see dateAccordionStyles.rowLast).
          return (
            <View style={dateAccordionStyles.gridBody} testID={`history-grid-body-${section.dateKey}`}>
              <View style={dateAccordionStyles.gridWrap}>
                {section.items.map(item => <SavedLinkGridCell key={item.id} dateDisplayMode={section.showItemDate ? 'dateTime' : 'time'} disabled={actionInFlightItemId !== null} isActionInFlight={actionInFlightItemId === item.id} item={item} onDelete={() => confirmDelete(item.id)} onPress={() => navigation.navigate('ItemDetails', { itemId: item.id })} onShare={() => runShare(item)} preferEffectiveThumbnail />)}
              </View>
            </View>
          );
        }}
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
  footerLoading: {
    paddingVertical: spacing.lg,
  },
});
