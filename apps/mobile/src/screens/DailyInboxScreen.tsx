import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  AppState,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
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
import { LINK_CONTROLS_BOTTOM_GAP, LINK_CONTROLS_TOP_GAP, savedLinkLayout, TITLE_COUNT_GAP } from '../components/savedLinkLayout';
import { SavedLinkGridCell, savedLinkGridLayout } from '../components/SavedLinkGridCard';
import { SavedLinkGridCardSkeleton, SavedLinkRowSkeleton } from '../components/SavedLinkSkeleton';
import { LinkSortChips } from '../components/LinkSortChips';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { NotificationBellButton } from '../notifications/NotificationBellButton';
import { SwipeableItemRow } from '../components/SwipeableItemRow';
import { closeOpenRow } from '../components/swipeableRowCoordinator';
import { CheckIcon } from '../icons/CheckIcon';
import { LinkIcon } from '../icons/LinkIcon';
import {
  deleteItem,
  getItemHistory,
  getItemHistoryCount,
  restoreItem,
  type ItemHistoryEntry,
} from '../items/api/itemsApi';
import { formatDateOnly } from '../items/dateOnly';
import { shareItem } from '../items/shareItem';
import type { RootStackParamList } from '../navigation/RootStack';
import { isHttpUrl } from '../share/resolveIncomingShare';
import { extractFirstHttpUrl } from '../share/sharedTextParser';
import { cardShadow, colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';
import { useViewModePreference } from '../settings/viewModePreference';
import { useSortPreference } from '../settings/sortPreference';
import { sortLinksByName } from '../collections/sortCollectionItems';
import { NAME_ORDER_MAX_LINKS } from '../collections/useCollectionItems';

/** Links per request - a screenful or two; the rest of the day comes a page at a time. */
export const HOME_PAGE_SIZE = 25;
/** The server's page limit - a refresh never asks for more rows than this in one request. */
const MAX_PAGE_LIMIT = 100;
/** Skeleton rows while the first page loads, and under the loaded rows while a next one does. */
export const HOME_FIRST_PAGE_SKELETON_ROWS = 6;
export const HOME_NEXT_PAGE_SKELETON_ROWS = 2;

/**
 * Today's window as the device sees it right now: from its own local midnight (as a UTC instant),
 * open-ended - the same "today" History's own 오늘 used to be decided by on the device, never a
 * server-stored timezone that can go stale (see GET items/history's fromUtc/toUtc).
 */
function todayWindowStartUtc(now: Date): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

function getInboxErrorMessage(error: unknown, isSave: boolean, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'badRequest') {
      return t('inbox.errorBadRequest');
    }

    if (error.kind === 'forbidden') {
      return t('inbox.errorForbidden');
    }

    if (error.kind === 'conflict') {
      return t('errors.accountNotReady');
    }

    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }

  return isSave ? t('inbox.errorSaveFallback') : t('inbox.errorLoadFallback');
}

function getDeleteErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('inbox.errorDeleteFallback');
}

/** Share.share only ever rejects on a genuine native module failure - a user dismissing/canceling the sheet resolves normally, never here. */
function getShareErrorMessage(t: TFunction): string {
  return t('item.shareError');
}

/**
 * Home ("오늘 저장한 링크"): every URL the user saved today (SavedAtUtc, local calendar date),
 * regardless of current Inbox/Wishlist/Archived state - not a state-based triage view. A save that
 * is later moved to Wishlist or Archived stays visible here for the rest of the day, matching
 * History's own "오늘" section exactly (both derive from the same SavedAtUtc-local-date concept -
 * see GET /api/v1/items/history/date). Wishlist/Archive-moving actions are therefore not offered
 * from this screen; only viewing (tap -> ItemDetails), sharing, and deleting remain (share/delete
 * live behind a row swipe - see SwipeableItemRow - not as always-visible buttons).
 *
 * A day's worth of saves is unbounded: the server returns only today's window (from the device's
 * own local midnight - see todayWindowStartUtc), HOME_PAGE_SIZE links at a time, and the rest is
 * fetched via onEndReached/loadMore as the list scrolls, never all at once. The header count is the
 * whole day's exact total (GET items/history/count over the same window), not how many are loaded.
 * Returning to Home (e.g. from ItemDetails) reloads what was already shown in place - the same
 * number of rows - so edits appear without the list collapsing back to its first page.
 */
export function DailyInboxScreen() {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showUndoToast } = useAppToast();
  const { viewMode, changeViewMode } = useViewModePreference('homeViewMode');
  // Independent of the view mode (switching List/Grid never resets the sort) - the same two
  // separately-persisted preferences a Collection keeps (see CollectionDetailsScreen).
  const { sortOption, setSortOption } = useSortPreference('homeLinkSort');
  // AppToastHost renders above NavigationContainer (root coordinate space), so unlike a
  // screen-local Toast this needs the actual bottom tab bar height, not 0 - otherwise the Toast
  // sits under the tab bar, over the Android system navigation area.
  const tabBarHeight = useBottomTabBarHeight();
  useToastBottomAnchor(tabBarHeight);
  const [date, setDate] = useState<string | null>(null);
  // The window the shown rows (and their cursor) belong to - a next page never leaves it.
  const [windowStartUtc, setWindowStartUtc] = useState<string | null>(null);
  const [items, setItems] = useState<readonly ItemHistoryEntry[]>([]);
  // The whole day's exact total (null until known, or if only the count request failed).
  const [todayCount, setTodayCount] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionInFlightItemId, setActionInFlightItemId] = useState<number | null>(null);
  // Delete confirmation is a declarative ConfirmDialog keyed off this - null means closed, an id
  // means the dialog is open for that item. Mirrors the old isDeleteConfirmationOpenRef guard: a
  // second delete tap while one is already open is a no-op instead of opening a second dialog.
  const [pendingDeleteItemId, setPendingDeleteItemId] = useState<number | null>(null);

  // Mirrors of the latest state/refs for use inside the Delete confirmation callbacks, which are
  // constructed once when the dialog opens and must not read stale values captured at that moment
  // - a delete can be re-attempted while the dialog is still on screen.
  const itemsRef = useRef(items);
  const actionInFlightItemIdRef = useRef(actionInFlightItemId);
  const isRefreshingRef = useRef(isRefreshing);
  // Guards onEndReached firing multiple times before state updates are visible to new calls.
  const loadingMoreRef = useRef(false);
  // Discards a stale in-flight initial/refresh load's result if a newer one has since started
  // (e.g. rapid focus changes), and lets the first focus use the full-screen spinner while later
  // focuses (such as returning from ItemDetails after an edit) use the lighter refresh indicator.
  const loadRequestIdRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);
  // Guards a rapid double-tap of the Check button from pushing NewLinkReview twice - navigate()
  // alone isn't enough since two synchronous presses can both fire before React Navigation's own
  // state update makes the first one visible. Reset on every focus (below), so returning to Home
  // without saving (or after saving) never leaves the button stuck disabled.
  const isNavigatingToReviewRef = useRef(false);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const dateRef = useRef(date);
  dateRef.current = date;

  useEffect(() => {
    actionInFlightItemIdRef.current = actionInFlightItemId;
  }, [actionInFlightItemId]);

  useEffect(() => {
    isRefreshingRef.current = isRefreshing;
  }, [isRefreshing]);

  const loadToday = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const requestId = ++loadRequestIdRef.current;
      if (mode === 'refresh') {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        // Recomputed on every load (not cached in state) so the app staying open across local
        // midnight picks up the new day on its next focus/refresh instead of continuing to show
        // yesterday's date. Always the device's own live local date, never the server's stored
        // TimeZoneId (which can go stale and silently exclude items that are unambiguously "today"
        // on the device right now).
        const now = new Date();
        const today = formatDateOnly(now);
        const fromUtc = todayWindowStartUtc(now);
        // A refresh of the same day reloads as many rows as are shown (in place); a new day starts over.
        const shown = today === dateRef.current ? itemsRef.current.length : 0;
        const limit = Math.min(Math.max(shown, HOME_PAGE_SIZE), MAX_PAGE_LIMIT);
        const [page, count] = await Promise.all([
          getItemHistory(authenticatedRequest, { limit, fromUtc }),
          // Best-effort: without it the header shows how many are loaded.
          getItemHistoryCount(authenticatedRequest, { fromUtc }).catch(() => null),
        ]);
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setDate(today);
        setWindowStartUtc(fromUtc);
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setTodayCount(count);
      } catch (caughtError) {
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        // Failure keeps whatever Home already shows - only the error text changes.
        setError(getInboxErrorMessage(caughtError, false, t));
      } finally {
        if (loadRequestIdRef.current === requestId) {
          hasLoadedOnceRef.current = true;
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [authenticatedRequest, t],
  );

  const loadMore = useCallback((limit: number = HOME_PAGE_SIZE) => {
    if (loadingMoreRef.current || isLoading || isRefreshing || !nextCursor || !windowStartUtc) {
      return;
    }

    const requestId = loadRequestIdRef.current;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    (async () => {
      try {
        const page = await getItemHistory(authenticatedRequest, { limit, cursor: nextCursor, fromUtc: windowStartUtc });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setItems(previousItems => {
          const seenIds = new Set(previousItems.map(item => item.id));
          const additionalItems = page.items.filter(item => !seenIds.has(item.id));
          return [...previousItems, ...additionalItems];
        });
        setNextCursor(page.nextCursor);
      } catch (caughtError) {
        if (loadRequestIdRef.current === requestId) {
          setError(getInboxErrorMessage(caughtError, false, t));
        }
      } finally {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    })();
  }, [authenticatedRequest, windowStartUtc, nextCursor, isLoading, isRefreshing, t]);

  // Refetches every time the Home tab regains focus (including returning from ItemDetails after
  // an edit), matching the same focus-driven refresh already used for Wishlist/Archive.
  useFocusEffect(
    useCallback(() => {
      isNavigatingToReviewRef.current = false;
      loadToday(hasLoadedOnceRef.current ? 'refresh' : 'initial');
    }, [loadToday]),
  );

  // Refetches when the app itself comes back from the background/inactive (e.g. the user shared a
  // URL to Juple from another app, then switched back) - useFocusEffect alone only catches
  // in-app navigation, not the app being backgrounded while the Home tab stays focused. Only
  // fires on an actual background/inactive -> active transition (mirrors the same AppState
  // precedent in useIncomingShare.ts), never on initial mount, so it never duplicates the
  // useFocusEffect load above. loadToday's own request-generation guard (loadRequestIdRef)
  // already discards whichever of the two concurrent calls resolves second.
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appStateRef.current?.match(/inactive|background/) && nextAppState === 'active') {
        loadToday('refresh');
      }
      appStateRef.current = nextAppState;
    });

    return () => subscription.remove();
  }, [loadToday]);

  /**
   * Home's Check button no longer saves anything itself - it only validates and hands the URL off
   * to NewLinkReviewScreen (the same review screen Incoming Share/Quick Save OFF already uses),
   * where the user actually reviews/edits the resolved metadata and taps Save. This used to call
   * saveInboxEntry immediately (title-less) and best-effort enrich it afterward, which meant a
   * slow/failed metadata resolve could leave a bare, title-less, image-less Item in History with
   * no chance to fix it before it was already saved - see this round's "Check 버튼을 눌러도 즉시
   * 저장하지 않는다" requirement. No Item is created here at all; NewLinkReview's own Save button
   * is now the only place a URL pasted into Home actually becomes an Item.
   */
  const openReview = () => {
    if (isNavigatingToReviewRef.current) {
      return;
    }

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      return;
    }

    // A user pasting a share-copied clipboard value (e.g. "당근에서 이 글을 확인해보세요!
    // https://...") gets the exact same "description text discarded, URL alone kept" treatment
    // Incoming Share already applies (see sharedTextParser.ts's own remarks) - the same helper, so
    // Home/Incoming-Share/Quick-Save never disagree about what the "real" URL is. isHttpUrl(trimmedUrl)
    // already covers the common "already a bare URL" case for free (extractFirstHttpUrl only ever
    // needs to additionally handle text that ISN'T already a bare URL).
    const normalizedUrl = isHttpUrl(trimmedUrl) ? trimmedUrl : extractFirstHttpUrl(trimmedUrl);
    if (!normalizedUrl) {
      // Same message the server's own badRequest validation used to produce for this case -
      // checked client-side now since Check no longer calls the server at all.
      setSaveError(t('inbox.errorBadRequest'));
      return;
    }

    isNavigatingToReviewRef.current = true;
    setSaveError(null);
    setUrl('');
    // NewLinkReview's own url field is prefilled with the cleaned URL, not the raw pasted text -
    // this is where the user actually sees/confirms what will be saved (this round's explicit
    // "사용자가 실제 저장되는 값을 볼 수 있게 한다" requirement); Home's own input is cleared
    // immediately after, same as before, since the screen navigates away regardless.
    navigation.navigate('NewLinkReview', {
      url: normalizedUrl,
      initialTitle: null,
      preselectedCollectionId: null,
    });
  };

  const runDelete = async (itemId: number) => {
    if (
      actionInFlightItemIdRef.current !== null ||
      isRefreshingRef.current ||
      !itemsRef.current.some(entry => entry.id === itemId)
    ) {
      return;
    }

    setActionInFlightItemId(itemId);
    setError(null);
    try {
      await deleteItem(authenticatedRequest, itemId);
      const deletedItem = itemsRef.current.find(item => item.id === itemId);
      setItems(previousItems => previousItems.filter(item => item.id !== itemId));
      if (deletedItem) {
        setTodayCount(previous => (previous === null ? previous : Math.max(0, previous - 1)));
        showUndoToast({ actionLabel: t('toast.undoAction'), message: t('toast.deleteSuccess'), noticeTitle: t('common.notice'), confirmLabel: t('common.confirm'), undoErrorMessage: t('toast.undoDeleteError'), onUndo: async () => {
          await restoreItem(authenticatedRequest, deletedItem.id);
          // A refresh that already brought it back (and counted it) needs nothing more.
          if (!itemsRef.current.some(item => item.id === deletedItem.id)) {
            setItems(previous => previous.some(item => item.id === deletedItem.id) ? previous : [deletedItem, ...previous]);
            setTodayCount(count => (count === null ? count : count + 1));
          }
        } });
      }
    } catch (caughtError) {
      setError(getDeleteErrorMessage(caughtError, t));
    } finally {
      setActionInFlightItemId(null);
    }
  };

  const runShare = async (item: ItemHistoryEntry) => {
    if (actionInFlightItemIdRef.current !== null || isRefreshingRef.current) {
      return;
    }

    setActionInFlightItemId(item.id);
    setError(null);
    try {
      await shareItem(item.url, item.title);
    } catch {
      setError(getShareErrorMessage(t));
    } finally {
      setActionInFlightItemId(null);
    }
  };

  const confirmDelete = (itemId: number) => {
    setPendingDeleteItemId(previous => previous ?? itemId);
  };

  // 시간순 ↓ (the server's own newest-first order) pages in as the list scrolls. 시간순 ↑ and 이름순 need
  // the whole day: it is loaded here (largest pages) before anything is shown in that order, never
  // presenting a partial order as the day's - exactly the Collection rule. A day larger than
  // NAME_ORDER_MAX_LINKS stays on newest-first.
  const isSortTooLarge = (todayCount ?? 0) > NAME_ORDER_MAX_LINKS;
  const effectiveSort = sortOption !== 'newest' && isSortTooLarge ? 'newest' : sortOption;
  const needsWholeDay = effectiveSort !== 'newest';
  useEffect(() => {
    if (needsWholeDay && nextCursor && !error && !isLoading && !isRefreshing && !isLoadingMore) {
      loadMore(MAX_PAGE_LIMIT);
    }
  }, [error, isLoading, isLoadingMore, isRefreshing, loadMore, needsWholeDay, nextCursor]);
  const isAssemblingOrder = needsWholeDay && !error && (nextCursor !== null || isLoadingMore);
  const displayedItems = useMemo(() => {
    if (isAssemblingOrder) {
      return [];
    }
    if (effectiveSort === 'title') {
      return sortLinksByName(items, { title: item => item.title, url: item => item.url, addedAtUtc: item => item.savedAtUtc, id: item => item.id });
    }
    return effectiveSort === 'oldest' ? [...items].reverse() : items;
  }, [effectiveSort, isAssemblingOrder, items]);
  const pressDateSort = () => setSortOption(effectiveSort === 'newest' ? 'oldest' : 'newest');
  const pressNameSort = () => {
    if (!isSortTooLarge) {
      setSortOption('title');
    }
  };

  // Where links are about to appear - only while that request is actually on its way.
  const renderSkeletons = (count: number, testID: string) =>
    viewMode === 'grid' ? (
      <View style={styles.gridSkeletons} testID={testID}>
        {Array.from({ length: count }, (_, index) => (
          <View key={index} style={savedLinkGridLayout.cell}>
            <SavedLinkGridCardSkeleton testID="home-skeleton" />
          </View>
        ))}
      </View>
    ) : (
      <View testID={testID}>
        {Array.from({ length: count }, (_, index) => (
          <View key={index} style={[savedLinkLayout.card, styles.skeletonCard]}>
            <SavedLinkRowSkeleton testID="home-skeleton" />
          </View>
        ))}
      </View>
    );

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <FlatList
        key={viewMode}
        contentContainerStyle={styles.content}
        data={displayedItems}
        keyExtractor={entry => entry.id.toString()}
        numColumns={viewMode === 'grid' ? 2 : 1}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        // Android: rows scrolled far away drop their native views (and images) entirely.
        removeClippedSubviews={Platform.OS === 'android'}
        onEndReached={() => loadMore()}
        onEndReachedThreshold={0.5}
        onScrollBeginDrag={closeOpenRow}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              if (actionInFlightItemId !== null) {
                return;
              }
              loadToday('refresh');
            }}
          />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.brandRow}>
              <Text style={[styles.brand, ltrTextStyle]}>Juple</Text>
              {/* 알림 - Home's top end, the one place it lives (not on every screen). */}
              <NotificationBellButton onPress={() => navigation.navigate('Notifications')} />
            </View>
            <View style={styles.inputWrapper}>
              <View pointerEvents="none" style={styles.inputIconContainer}>
                <LinkIcon color={colors.textSecondary} size={18} />
              </View>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                onChangeText={setUrl}
                placeholder={t('inbox.urlPlaceholder')}
                style={[styles.input, url && ltrTextStyle]}
                value={url}
              />
              <Pressable
                accessibilityLabel={t('common.save')}
                accessibilityRole="button"
                disabled={!url.trim()}
                onPress={openReview}
                style={[styles.saveIconButton, !url.trim() ? styles.disabledButton : null]}
              >
                <CheckIcon color={colors.brand} size={20} />
              </Pressable>
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.recentHeaderRow}>
              {/* Title and count only - the controls are on the sort row below, as in a Collection. */}
              <View style={styles.recentHeaderLabel}>
                <Text style={styles.recentTitle}>{t('inbox.recentSaved')}</Text>
                <Text style={styles.recentCount}>{t('inbox.recentSavedCount', { count: todayCount ?? items.length })}</Text>
              </View>
            </View>
            {/* [시간순 이름순] on the start side, the List/Grid switch pinned to the end edge. */}
            <View style={styles.sortRow}>
              <LinkSortChips
                dateLabel={t('collections.sortDate')}
                dateNewestA11yLabel={t('collections.sortDateNewestA11y')}
                dateOldestA11yLabel={t('collections.sortDateOldestA11y')}
                nameLabel={t('collections.sortName')}
                onPressDate={pressDateSort}
                onPressName={pressNameSort}
                sort={effectiveSort}
                testIDPrefix="home-sort"
              />
              <View style={styles.sortRowSpacer} />
              <ViewModeToggle onChange={changeViewMode} value={viewMode} />
            </View>
          </View>
        }
        ListEmptyComponent={
          (isLoading || isAssemblingOrder) && !error ? renderSkeletons(HOME_FIRST_PAGE_SKELETON_ROWS, 'home-first-page-loading') : <CenteredEmptyState message={t('inbox.empty')} />
        }
        renderItem={({ item }) => viewMode === 'grid' ? (
          <SavedLinkGridCell
            disabled={actionInFlightItemId !== null || isRefreshing}
            isActionInFlight={actionInFlightItemId === item.id}
            item={item}
            onDelete={() => confirmDelete(item.id)}
            onPress={() => navigation.navigate('ItemDetails', { itemId: item.id })}
            onShare={() => runShare(item)}
            preferEffectiveThumbnail
          />
        ) : (
          <SwipeableItemRow
            containerStyle={savedLinkLayout.card}
            disabled={actionInFlightItemId !== null || isRefreshing}
            onDelete={() => confirmDelete(item.id)}
            onPress={() => {
              navigation.navigate('ItemDetails', { itemId: item.id });
            }}
            onShare={() => runShare(item)}
          >
            <SavedLinkRow
              isActionInFlight={actionInFlightItemId === item.id}
              item={item}
              preferEffectiveThumbnail
            />
          </SwipeableItemRow>
        )}
        ListFooterComponent={isLoadingMore ? renderSkeletons(HOME_NEXT_PAGE_SKELETON_ROWS, 'home-next-page-loading') : undefined}
      />
      {saveError !== null && (
        <ConfirmDialog
          visible
          title={t('common.notice')}
          message={saveError}
          confirmLabel={t('common.confirm')}
          onConfirm={() => setSaveError(null)}
          destructive={false}
        />
      )}
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
        message={t('inbox.deleteConfirmMessage')}
        onCancel={() => setPendingDeleteItemId(null)}
        onConfirm={() => {
          const itemId = pendingDeleteItemId;
          setPendingDeleteItemId(null);
          if (itemId !== null) {
            runDelete(itemId);
          }
        }}
        title={t('inbox.deleteConfirmTitle')}
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
  // This screen sits inside a bottom-tab navigator, whose scene container is already sized to
  // exclude the real, non-overlay Juple tab bar (which itself already pads for the system nav/
  // gesture-area inset - see @react-navigation/bottom-tabs' BottomTabView/BottomTabBar). So this
  // FlatList's own viewport already ends exactly above the tab bar - no tabBarHeight or
  // insets.bottom belongs here too, or the last card gets an extra, empty tab-bar-sized gap below
  // it. `padding.xl` (24) bottom is just ordinary breathing room, the same as every other side.
  content: {
    flexGrow: 1,
    padding: spacing.xl,
  },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  brand: {
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: '800',
  },
  inputWrapper: {
    marginTop: spacing.md,
  },
  inputIconContainer: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    position: 'absolute',
    start: spacing.md,
    top: 0,
    zIndex: 1,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.lg,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 15,
    paddingEnd: minTouchTarget + spacing.xs,
    paddingStart: spacing.xl + spacing.xs,
    paddingVertical: spacing.md,
    ...cardShadow,
  },
  // Overlays the input's own trailing edge (mirrors inputIconContainer's leading-edge overlay
  // above) - a real Pressable, unlike that purely decorative icon, so it also needs its own
  // z-index to stay tappable above the TextInput and a minTouchTarget hit area.
  saveIconButton: {
    alignItems: 'center',
    bottom: 0,
    end: 0,
    height: minTouchTarget,
    justifyContent: 'center',
    position: 'absolute',
    top: 0,
    width: minTouchTarget,
    zIndex: 1,
  },
  disabledButton: {
    opacity: 0.5,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginTop: spacing.md,
  },
  recentHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  // Title and count on ONE row, count right after the title: the title shrinks (and wraps within itself)
  // on a long translation, the count never drops to a line of its own.
  recentHeaderLabel: { alignItems: 'baseline', columnGap: TITLE_COUNT_GAP, flexDirection: 'row', flexShrink: 1, minWidth: 0 },
  sortRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, marginBottom: LINK_CONTROLS_BOTTOM_GAP, marginTop: LINK_CONTROLS_TOP_GAP },
  sortRowSpacer: { flex: 1 },
  recentTitle: {
    flexShrink: 1,
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  recentCount: {
    flexShrink: 0,
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  skeletonCard: { overflow: 'hidden' },
  gridSkeletons: { flexDirection: 'row', flexWrap: 'wrap' },
});
