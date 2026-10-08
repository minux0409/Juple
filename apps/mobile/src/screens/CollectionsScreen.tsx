import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useBottomTabBarHeight, type BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { syncCategorySnapshotToNative } from '../categories/categorySnapshotSync';
import {
  createCollection,
  getCollections,
  getMyPendingSubmissionTotal,
  setCollectionFavorite,
  type Collection,
  type CollectionListScope,
} from '../collections/api/collectionsApi';
import { getReceivedCollectionInvitations, type ReceivedCollectionInvitation } from '../collections/api/collaborationApi';
import { isCollaborative, isCollectionLocked } from '../collections/collectionAccess';
import { ApprovalSubmissionSheet } from '../collections/ApprovalSubmissionSheet';
import { ReceivedInvitationsSheet } from '../collections/ReceivedInvitationsSheet';
import { useLiveRefresh } from '../push/useLiveRefresh';
import { formatBadgeCount } from '../components/badgeCount';
import { CountBadge } from '../components/CountBadge';
import { LoadFailureState } from '../components/LoadFailureState';
import { subscribeCollectionNewLinksRead } from '../notifications/notificationState';
import { CollectionStatusBadges } from '../collections/CollectionStatusBadges';
import { CategoryEditorDialog } from '../collections/CategoryEditorDialog';
import { CategoryIconTile } from '../collections/CategoryIconTile';
import { CollectionCardSkeleton } from '../collections/CollectionCardSkeleton';
import { applyCollectionIconImageChange, getIconImageSaveErrorMessage, type CollectionIconImageChange } from '../collections/collectionIconImage';
import { useToastBottomAnchor } from '../components/useToastBottomAnchor';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { useViewModePreference } from '../settings/viewModePreference';
import { DEFAULT_COLLECTION_COLOR, type CollectionColorValue } from '../collections/collectionColors';
import { DEFAULT_COLLECTION_ICON, type CollectionIconKey } from '../collections/collectionIcons';
import { CollectionNameLabel } from '../collections/CollectionNameLabel';
import { PendingActionRow } from '../components/PendingActionRow';
import { ChevronIcon } from '../icons/ChevronIcon';
import { PeopleIcon } from '../icons/PeopleIcon';
import { PlusIcon } from '../icons/PlusIcon';
import { StarIcon } from '../icons/StarIcon';
import type { MainTabParamList } from '../navigation/MainTabs';
import type { RootStackParamList } from '../navigation/RootStack';
import { useLayoutDirection } from '../i18n/layoutDirection';
import { cardShadow, collectionFilterColors, colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import { ScreenTitle } from '../components/ScreenTitle';
import { screenIcons } from '../navigation/screenIcons';

const GRID_COLUMNS = 4;

/** Collections per request - a few screenfuls of cards (the grid shows GRID_COLUMNS per row). */
export const COLLECTIONS_PAGE_SIZE = 24;
const PAGE_LIMIT = COLLECTIONS_PAGE_SIZE;
/** The server's page limit - a refresh never asks for more cards than this in one request. */
const MAX_PAGE_LIMIT = 100;
/** Skeleton cards while a filter's first page loads, and under the cards while a next one does. */
const FIRST_PAGE_SKELETON_GRID_ROWS = 3;
const FIRST_PAGE_SKELETON_LIST_ROWS = 6;
const NEXT_PAGE_SKELETON_LIST_ROWS = 2;

/**
 * The four top-level Categories filters, all at the same level. Each is one server-side list scope
 * (see getCollections' scope) - owned vs shared is decided by the server's accessRole, never by
 * comparing ids here, and "all"/"favorites" are paged by the server as one list, never merged here.
 * 공유 컬렉션 ("shared") also lists the caller's own Collections while they are shared (members or
 * an active 모든 사용자 link) - the same row as under 내 컬렉션, never a copy: each filter keeps its
 * own list, so a Collection appears at most once per filter.
 */
type CategoryFilter = CollectionListScope;

const FILTERS: readonly CategoryFilter[] = ['all', 'favorites', 'owned', 'shared'];

/**
 * The four filters as a 2x2 grid - all at the same level, never nested. 내 승인 대기 is not a filter: a
 * full-width row under them that only shows while something waits and opens a popup of those links.
 */
const FILTER_ROWS: readonly (readonly CategoryFilter[])[] = [
  ['favorites', 'all'],
  ['owned', 'shared'],
];

/** Opening the screen lands on 즐겨찾기; a filter the user picks then stays for this screen's life. */
const DEFAULT_FILTER: CategoryFilter = 'favorites';

const FILTER_LABEL_KEYS: Record<CategoryFilter, string> = {
  all: 'collections.filterAll',
  favorites: 'collections.favoritesTitle',
  owned: 'collections.myCategoriesTab',
  shared: 'collections.sharedCategoriesTab',
};

const FILTER_EMPTY_KEYS: Record<CategoryFilter, string> = {
  all: 'collections.allCollectionsEmpty',
  favorites: 'collections.favoritesEmpty',
  owned: 'collections.allCollectionsEmpty',
  shared: 'collections.sharedEmpty',
};

interface FilterListState {
  readonly items: readonly Collection[];
  readonly nextCursor: string | null;
  /** False until this filter has loaded at least once since it was last invalidated. */
  readonly isLoaded: boolean;
}

const EMPTY_LIST: FilterListState = { items: [], nextCursor: null, isLoaded: false };

function getListErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('collections.errorListFallback');
}

function getFavoriteToggleErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('collections.errorFavoriteToggleFallback');
}

function getCreateErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'conflict') {
      return t('collections.errorNameConflict');
    }
    if (error.kind === 'badRequest') {
      return t('collections.errorNameInvalid');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('collections.errorCreateFallback');
}

/** Mirrors the backend's CollectionNameNormalizer: trim, required, 100-character limit. */
function getNameValidationError(name: string, t: TFunction): string | null {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return t('collections.errorNameRequired');
  }
  if (trimmedName.length > 100) {
    return t('collections.errorNameTooLong');
  }
  return null;
}

/**
 * 카테고리 (user-facing label; backend/API still uses "Collection"): user-named buckets of saved
 * URLs (see collectionsApi.ts). The Item list inside a Collection lives on CollectionDetailsScreen;
 * this screen lists/creates Collections under four same-level filters - 즐겨찾기 (default), 전체,
 * 내 컬렉션, 공유 컬렉션 - each its own server-scoped, cursor-paginated list. 공유 카테고리 also
 * carries the 공유 요청 entry: collaboration invitations other Owners sent to this user.
 */
export function CollectionsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const tabNavigation = useNavigation<BottomTabNavigationProp<MainTabParamList, 'Collections'>>();
  const route = useRoute<RouteProp<MainTabParamList, 'Collections'>>();
  const authenticatedRequest = useAuthenticatedApi();
  // This screen never shows a Toast itself, but the Collection Delete Undo toast (shown from
  // CollectionDetailsScreen just before it navigates back here) stays alive across that
  // navigation - it must reposition to this tab's own anchor (the actual tab bar height, same as
  // Home/History) rather than keep CollectionDetails' safe-area-only offset. AppToastHost renders
  // above NavigationContainer (root coordinate space), so 0 would put it under the tab bar, over
  // the Android system navigation area.
  const tabBarHeight = useBottomTabBarHeight();
  useToastBottomAnchor(tabBarHeight);
  const { viewMode, changeViewMode } = useViewModePreference('categoryViewMode', 'grid');
  const layoutDirection = useLayoutDirection();

  const [filter, setFilter] = useState<CategoryFilter>(DEFAULT_FILTER);
  const filterRef = useRef<CategoryFilter>(DEFAULT_FILTER);
  const [lists, setLists] = useState<Record<CategoryFilter, FilterListState>>({
    all: EMPTY_LIST,
    favorites: EMPTY_LIST,
    owned: EMPTY_LIST,
    shared: EMPTY_LIST,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Category creation is a centered CategoryEditorDialog (see CategoryEditorDialog) - this screen
  // only knows whether it is open and the create request's own in-flight/error state.
  const [isCreateDialogVisible, setIsCreateDialogVisible] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [togglingFavoriteId, setTogglingFavoriteId] = useState<number | null>(null);
  const [favoriteToggleError, setFavoriteToggleError] = useState<string | null>(null);
  // Collaboration invitations addressed to this user (never ones they sent, never friend requests).
  const [receivedInvitations, setReceivedInvitations] = useState<readonly ReceivedCollectionInvitation[]>([]);
  const [isShareRequestsVisible, setIsShareRequestsVisible] = useState(false);
  // My own proposals waiting for approval across my whole shared list (one number from the server - the
  // list is paged and only the active filter is loaded, so a sum of loaded cards would be wrong).
  const [myPendingTotal, setMyPendingTotal] = useState(0);
  // 내 링크 승인 대기: a popup of those links (not a filter and not a screen).
  const [isMyPendingSheetVisible, setIsMyPendingSheetVisible] = useState(false);

  const loadRequestIdRef = useRef(0);
  // Guards onEndReached firing multiple times before state updates are visible to new calls.
  const loadingMoreRef = useRef(false);
  const listsRef = useRef(lists);
  listsRef.current = lists;

  /**
   * Loads the first page of one filter; a newer load (or filter switch) makes an older one a no-op.
   * A refresh reloads as many cards as the filter already shows (capped at the server's page
   * limit), so returning from a Collection keeps the list where it was instead of shrinking it back
   * to its first page.
   */
  const load = useCallback(
    async (target: CategoryFilter, mode: 'initial' | 'refresh') => {
      const requestId = ++loadRequestIdRef.current;
      if (mode === 'refresh') {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);
      const shown = mode === 'refresh' ? listsRef.current[target].items.length : 0;
      const limit = Math.min(Math.max(shown, PAGE_LIMIT), MAX_PAGE_LIMIT);

      try {
        const page = await getCollections(authenticatedRequest, { scope: target, limit });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        // Card metadata only - each card's photo loads when that card mounts (nothing is prefetched).
        setLists(previous => ({ ...previous, [target]: { items: page.items, nextCursor: page.nextCursor, isLoaded: true } }));
      } catch (caughtError) {
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        // Failure keeps whatever Collections are already shown - only the error text changes.
        setError(getListErrorMessage(caughtError, t));
      } finally {
        if (loadRequestIdRef.current === requestId) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [authenticatedRequest, t],
  );

  const loadReceivedInvitations = useCallback(() => {
    getReceivedCollectionInvitations(authenticatedRequest)
      .then(setReceivedInvitations)
      // Best-effort: without the list, the 공유 요청 entry simply stays hidden.
      .catch(() => undefined);
  }, [authenticatedRequest]);

  // Reloaded wherever the list itself is (focus, pull-to-refresh, a Push about a proposal or its result):
  // one request, best-effort - without it the tab simply shows no number.
  const loadMyPendingTotal = useCallback(() => {
    getMyPendingSubmissionTotal(authenticatedRequest)
      .then(setMyPendingTotal)
      .catch(() => undefined);
  }, [authenticatedRequest]);

  /** Every other filter's cached page may now be stale - they reload when next selected. */
  const invalidateOtherFilters = useCallback((keep: CategoryFilter) => {
    setLists(previous => {
      const next = { ...previous };
      for (const key of FILTERS) {
        if (key !== keep) {
          next[key] = { ...next[key], isLoaded: false };
        }
      }
      return next;
    });
  }, []);

  // Refetches the visible filter every time the Categories tab regains focus, so a Collection
  // created/renamed/deleted/favorited elsewhere shows up immediately on return (Home/History
  // precedent); the other filters reload lazily when selected.
  useFocusEffect(
    useCallback(() => {
      const current = filterRef.current;
      invalidateOtherFilters(current);
      load(current, 'refresh');
      loadReceivedInvitations();
      loadMyPendingTotal();
      // Best-effort: keeps the native Direct Share/Quick Save composer category snapshot (see
      // categorySnapshotSync.ts) current on every visit, independently of this screen's own
      // paginated state - a failure here never affects what this screen shows.
      syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
    }, [authenticatedRequest, invalidateOtherFilters, load, loadMyPendingTotal, loadReceivedInvitations]),
  );

  // Refresh signaling is deliberately separate from AppToast state: revisiting this tab must
  // never recreate a toast or reset its timer. A tapped Collection invitation Push also asks for
  // 공유 컬렉션 with its 공유 요청 open (see usePushMessageHandling).
  useEffect(() => {
    if (route.params?.refreshToken === undefined) {
      return;
    }
    const target = route.params.filter;
    const openShareRequests = route.params.openShareRequests === true;
    tabNavigation.setParams({ refreshToken: undefined, filter: undefined, openShareRequests: undefined });
    if (target && target !== filterRef.current) {
      filterRef.current = target;
      setFilter(target);
    }
    invalidateOtherFilters(filterRef.current);
    load(filterRef.current, 'refresh');
    if (openShareRequests) {
      getReceivedCollectionInvitations(authenticatedRequest)
        .then(invitations => {
          setReceivedInvitations(invitations);
          setIsShareRequestsVisible(invitations.length > 0);
        })
        .catch(() => undefined);
    }
  }, [authenticatedRequest, invalidateOtherFilters, load, route.params?.filter, route.params?.openShareRequests, route.params?.refreshToken, tabNavigation]);

  // Without polling: link counts (another member or a public-link writer added/removed links) and
  // the 공유 요청 badge follow Push while the app is open, and refresh on returning to the app.
  useLiveRefresh(
    () => {
      invalidateOtherFilters(filterRef.current);
      load(filterRef.current, 'refresh');
      loadReceivedInvitations();
      loadMyPendingTotal();
    },
    // 새 링크 and 승인 요청 also change a card's attention badge, and a proposal's result (approved /
    // declined) changes the 내 승인 대기 chip (reactions/comments never do).
    ['collectionContentChanged', 'collectionInvitation', 'collectionInvitationAnswered', 'collectionItemsAdded', 'collectionLinkSubmission', 'collectionLinkSubmissionApproved', 'collectionLinkSubmissionRejected'],
  );

  // Opening a Collection read its 새 링크: its card drops that part of the badge at once (its
  // pending approvals stay - they are tasks, not notifications). The next load confirms it.
  useEffect(
    () =>
      subscribeCollectionNewLinksRead(collectionId => {
        setLists(previous => {
          const next = { ...previous };
          for (const key of FILTERS) {
            next[key] = {
              ...next[key],
              items: next[key].items.map(card =>
                card.id === collectionId && (card.unreadNewLinkCount ?? 0) > 0
                  ? { ...card, unreadNewLinkCount: 0, attentionCount: Math.max(0, (card.attentionCount ?? 0) - (card.unreadNewLinkCount ?? 0)) }
                  : card,
              ),
            };
          }
          return next;
        });
      }),
    [],
  );

  const selectFilter = (next: CategoryFilter) => {
    if (next === filter) {
      return;
    }
    filterRef.current = next;
    setFilter(next);
    setError(null);
    if (!lists[next].isLoaded) {
      load(next, 'initial');
    } else {
      // A cached page from this focus is shown immediately; cancel any in-flight load for the
      // previous filter so it cannot flip the loading state of this one.
      loadRequestIdRef.current++;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const loadMore = useCallback(() => {
    const current = lists[filter];
    if (loadingMoreRef.current || isLoading || isRefreshing || !current.nextCursor) {
      return;
    }

    const requestId = loadRequestIdRef.current;
    const target = filter;
    const cursor = current.nextCursor;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    (async () => {
      try {
        const page = await getCollections(authenticatedRequest, { scope: target, limit: PAGE_LIMIT, cursor });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setLists(previous => {
          const existing = previous[target];
          const seenIds = new Set(existing.items.map(collection => collection.id));
          return {
            ...previous,
            [target]: {
              items: [...existing.items, ...page.items.filter(collection => !seenIds.has(collection.id))],
              nextCursor: page.nextCursor,
              isLoaded: true,
            },
          };
        });
      } catch (caughtError) {
        if (loadRequestIdRef.current === requestId) {
          setError(getListErrorMessage(caughtError, t));
        }
      } finally {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    })();
  }, [authenticatedRequest, filter, isLoading, isRefreshing, lists, t]);

  const handleCreateSubmit = async (name: string, icon: CollectionIconKey, color: CollectionColorValue, imageChange: CollectionIconImageChange) => {
    if (isCreating) {
      return;
    }

    const validationError = getNameValidationError(name, t);
    if (validationError) {
      setCreateError(validationError);
      return;
    }
    const trimmedName = name.trim();

    setIsCreating(true);
    setCreateError(null);
    try {
      let created = await createCollection(authenticatedRequest, trimmedName, icon, color);
      // The photo goes up only once the Collection exists. If that part fails, the Collection is
      // still created (with its built-in icon) - the photo can be added again from its edit screen.
      try {
        created = await applyCollectionIconImageChange(authenticatedRequest, created, imageChange);
      } catch (caughtError) {
        setError(getIconImageSaveErrorMessage(caughtError, t));
      }
      // A new Collection is owned and not a favorite: it belongs at the top of 전체/내 카테고리.
      setLists(previous => ({
        ...previous,
        all: previous.all.isLoaded ? { ...previous.all, items: [created, ...previous.all.items] } : previous.all,
        owned: previous.owned.isLoaded ? { ...previous.owned, items: [created, ...previous.owned.items] } : previous.owned,
      }));
      setIsCreateDialogVisible(false);
      syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
    } catch (caughtError) {
      setCreateError(getCreateErrorMessage(caughtError, t));
    } finally {
      setIsCreating(false);
    }
  };

  const openCreateDialog = () => {
    setCreateError(null);
    setIsCreateDialogVisible(true);
  };

  const cancelCreate = () => {
    if (isCreating) {
      return;
    }
    setIsCreateDialogVisible(false);
  };

  /**
   * The caller's own favorite mark - available on owned and shared Categories alike, and never
   * visible to anyone else. Optimistic across every cached filter (only one toggle in flight); on
   * failure the pre-toggle Collection is restored. The 즐겨찾기 filter drops an unfavorited row at
   * once and reloads to pick up a newly favorited one.
   */
  const toggleFavoriteAction = async (collection: Collection) => {
    if (togglingFavoriteId !== null) {
      return;
    }
    const desiredIsFavorite = !collection.isFavorite;
    const applyToLists = (replacement: Collection) =>
      setLists(previous => {
        const next = { ...previous };
        for (const key of FILTERS) {
          const items = next[key].items.map(existing => (existing.id === replacement.id ? replacement : existing));
          next[key] = {
            ...next[key],
            items: key === 'favorites' && !replacement.isFavorite ? items.filter(existing => existing.id !== replacement.id) : items,
            isLoaded: key === 'favorites' && replacement.isFavorite && filterRef.current !== 'favorites' ? false : next[key].isLoaded,
          };
        }
        return next;
      });

    setTogglingFavoriteId(collection.id);
    setFavoriteToggleError(null);
    applyToLists({ ...collection, isFavorite: desiredIsFavorite });

    try {
      const updated = await setCollectionFavorite(authenticatedRequest, collection.id, desiredIsFavorite);
      applyToLists(updated);
      syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
    } catch (caughtError) {
      // Roll back to the pre-toggle Collection - never trust the optimistic flip.
      applyToLists(collection);
      if (collection.isFavorite) {
        setLists(previous => ({ ...previous, favorites: { ...previous.favorites, isLoaded: false } }));
      }
      setFavoriteToggleError(getFavoriteToggleErrorMessage(caughtError, t));
    } finally {
      setTogglingFavoriteId(null);
    }
  };

  /**
   * An answered invitation leaves the list at once; accepting also reloads 공유 카테고리 (the
   * Category now belongs there) and marks the other filters stale, so it shows without leaving.
   */
  const handleInvitationResponded = (invitationId: number, accepted: boolean) => {
    const remaining = receivedInvitations.filter(invitation => invitation.invitationId !== invitationId);
    setReceivedInvitations(remaining);
    if (remaining.length === 0) {
      setIsShareRequestsVisible(false);
    }
    if (accepted) {
      invalidateOtherFilters(filterRef.current);
      load(filterRef.current, 'refresh');
      syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
    }
  };

  const activeList = lists[filter];
  const isActiveInitialLoading = !activeList.isLoaded && isLoading && !error;
  // Where cards are about to appear - only while that request is actually on its way.
  const renderSkeletons = (rows: number, testID: string) =>
    viewMode === 'grid' ? (
      <View style={styles.skeletonGrid} testID={testID}>
        {Array.from({ length: rows * GRID_COLUMNS }, (_, index) => (
          <CollectionCardSkeleton gridBasis={`${100 / GRID_COLUMNS}%`} key={index} testID="collections-skeleton" variant="grid" />
        ))}
      </View>
    ) : (
      <View testID={testID}>
        {Array.from({ length: rows }, (_, index) => (
          <CollectionCardSkeleton key={index} testID="collections-skeleton" variant="list" />
        ))}
      </View>
    );
  const openCollection = (collection: Collection) =>
    navigation.navigate('CollectionDetails', { collectionId: collection.id });

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <FlatList
        key={viewMode}
        contentContainerStyle={styles.content}
        data={activeList.items}
        keyExtractor={collection => collection.id.toString()}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              load(filter, 'refresh');
              loadReceivedInvitations();
      loadMyPendingTotal();
            }}
          />
        }
        numColumns={viewMode === 'grid' ? GRID_COLUMNS : 1}
        // With columns these count rows (GRID_COLUMNS cards each), not cards.
        initialNumToRender={viewMode === 'grid' ? 5 : 10}
        maxToRenderPerBatch={viewMode === 'grid' ? 3 : 10}
        windowSize={7}
        // Android: cards scrolled far away drop their native views (and photos) entirely.
        removeClippedSubviews={Platform.OS === 'android'}
        ListHeaderComponent={
          <View>
            <View style={styles.titleRow}>
              <ScreenTitle icon={screenIcons.collections} textStyle={styles.title} title={t('collections.title')} />
              <View style={styles.headerButtons}>
                <ViewModeToggle onChange={changeViewMode} value={viewMode} />
                <Pressable accessibilityLabel={t('collections.create')} accessibilityRole="button" onPress={openCreateDialog} style={styles.addButton}>
                  <PlusIcon color={colors.surface} size={20} strokeWidth={2.25} />
                </Pressable>
              </View>
            </View>

            {/* Four same-level filters as a 2x2 grid: every option is always visible, each cell takes
                half the width and a long translation wraps to a second line (the grid simply grows
                taller) - never clipped, never shrunk. Rows follow the layout direction, so RTL
                mirrors the columns automatically. */}
            <View accessibilityRole="tablist" style={styles.filterGrid}>
              {FILTER_ROWS.map(row => (
                <View key={row.join('-')} style={styles.filterRow}>
                  {row.map(option => (
                    <Pressable
                      accessibilityRole="tab"
                      accessibilityState={{ selected: filter === option }}
                      key={option}
                      onPress={() => selectFilter(option)}
                      style={[
                        styles.filterCell,
                        filter === option && styles.filterCellActive,
                        option === 'shared' && receivedInvitations.length > 0 && styles.filterCellWithBadge,
                      ]}
                      testID={`collections-filter-${option}`}
                    >
                      <Text numberOfLines={2} style={[styles.filterLabel, filter === option && styles.filterLabelActive]}>
                        {t(FILTER_LABEL_KEYS[option])}
                      </Text>
                      {/* 공유 요청 waiting - the same list as the 공유 요청 row. Inside the cell's
                          top-end corner (mirrored under RTL), so it is never clipped and never sits
                          on the selected border. */}
                      {option === 'shared' && receivedInvitations.length > 0 ? (
                        <View
                          accessibilityLabel={t('collections.shareRequestCount', { count: receivedInvitations.length })}
                          style={styles.filterBadge}
                          testID="collections-filter-shared-badge"
                        >
                          <Text style={styles.filterBadgeText}>{formatBadgeCount(receivedInvitations.length)}</Text>
                        </View>
                      ) : null}
                    </Pressable>
                  ))}
                </View>
              ))}
            </View>

            {/* 내 승인 대기 N: a full-width row right under the four filters. N is how many LINKS of mine
                wait in all (one number from the server); tapping it opens a popup listing exactly those
                links - what, in which Collection, since when - without selecting a filter or entering
                a Collection first. Neutral, never the red attention color. Hidden at 0. */}
            {myPendingTotal > 0 ? (
              <PendingActionRow
                accessibilityLabel={t('collections.myPendingA11y', { count: myPendingTotal })}
                label={t('collections.myPendingSubmissions', { count: formatBadgeCount(myPendingTotal) })}
                onPress={() => setIsMyPendingSheetVisible(true)}
                style={styles.myPendingRow}
                testID="collections-filter-my-pending"
              />
            ) : null}

            {/* 공유 요청: only on 공유 카테고리 and only while there is something to answer - it
                never takes space otherwise. */}
            {filter === 'shared' && receivedInvitations.length > 0 ? (
              <Pressable
                accessibilityLabel={t('collections.shareRequestCount', { count: receivedInvitations.length })}
                accessibilityRole="button"
                onPress={() => setIsShareRequestsVisible(true)}
                style={styles.shareRequestsRow}
                testID="collections-share-requests"
              >
                <PeopleIcon color={colors.brand} size={20} />
                <Text numberOfLines={2} style={styles.shareRequestsLabel}>{t('collections.shareRequests')}</Text>
                <View style={styles.shareRequestsBadge}>
                  <Text style={styles.shareRequestsBadgeText} testID="collections-share-requests-count">
                    {receivedInvitations.length}
                  </Text>
                </View>
                {/* Points toward the reading direction's end (mirrored under RTL). */}
                <ChevronIcon
                  color={colors.textSecondary}
                  direction={layoutDirection === 'rtl' ? 'left' : 'right'}
                  size={16}
                />
              </Pressable>
            ) : null}

            {favoriteToggleError ? <Text style={styles.error}>{favoriteToggleError}</Text> : null}
            {/* With cards already on screen a failed refresh keeps them, with the shared load-failure state above them (as 보관함
                does); with none it is the centered state below. */}
            {error && activeList.items.length > 0 ? <LoadFailureState compact onRetry={() => load(filter, 'refresh')} testID="collections-refresh-failure" /> : null}
          </View>
        }
        ListEmptyComponent={
          isActiveInitialLoading ? (
            renderSkeletons(viewMode === 'grid' ? FIRST_PAGE_SKELETON_GRID_ROWS : FIRST_PAGE_SKELETON_LIST_ROWS, 'collections-first-page-loading')
          ) : error ? (
            <LoadFailureState onRetry={() => load(filter, 'initial')} testID="collections-list-error" />
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.empty}>{t(FILTER_EMPTY_KEYS[filter])}</Text>
            </View>
          )
        }
        renderItem={({ item }) => viewMode === 'grid' ? (
          <CollectionTile
            collection={item}
            isFavoriteToggleDisabled={togglingFavoriteId !== null}
            isTogglingFavorite={togglingFavoriteId === item.id}
            onPress={() => openCollection(item)}
            onToggleFavorite={() => toggleFavoriteAction(item)}
          />
        ) : <CollectionListRow collection={item} isFavoriteToggleDisabled={togglingFavoriteId !== null} isTogglingFavorite={togglingFavoriteId === item.id} onPress={() => openCollection(item)} onToggleFavorite={() => toggleFavoriteAction(item)} />}
        ListFooterComponent={isLoadingMore ? renderSkeletons(viewMode === 'grid' ? 1 : NEXT_PAGE_SKELETON_LIST_ROWS, 'collections-next-page-loading') : undefined}
      />

      <ReceivedInvitationsSheet
        authenticatedRequest={authenticatedRequest}
        invitations={receivedInvitations}
        onClose={() => setIsShareRequestsVisible(false)}
        onResponded={handleInvitationResponded}
        onStale={loadReceivedInvitations}
        visible={isShareRequestsVisible}
      />

      <ApprovalSubmissionSheet
        authenticatedRequest={authenticatedRequest}
        collectionId={null}
        expectedCount={myPendingTotal}
        onChanged={() => {
          // One of my proposals was cancelled: the number and the cards' own pending counts follow.
          loadMyPendingTotal();
          load(filterRef.current, 'refresh');
        }}
        onClose={() => setIsMyPendingSheetVisible(false)}
        onTotalLoaded={setMyPendingTotal}
        variant="mine"
        visible={isMyPendingSheetVisible}
      />

      <CategoryEditorDialog
        error={createError}
        initialColor={DEFAULT_COLLECTION_COLOR}
        initialIcon={DEFAULT_COLLECTION_ICON}
        initialName=""
        isSubmitting={isCreating}
        mode="create"
        onCancel={cancelCreate}
        onSubmit={handleCreateSubmit}
        visible={isCreateDialogVisible}
      />
    </SafeAreaView>
  );
}

interface CollectionTileProps {
  readonly collection: Collection;
  readonly isFavoriteToggleDisabled: boolean;
  readonly isTogglingFavorite: boolean;
  readonly onPress: () => void;
  readonly onToggleFavorite: () => void;
}

/**
 * A single grid cell: icon tile + name, with a small favorite-star badge overlaid at the icon's
 * corner (this round's Category UX rework - replaces the old full-width row with its own separate
 * trailing star button). The star is a Pressable NESTED inside the tile's own navigate-Pressable
 * (not a sibling) so it can be positioned precisely against the icon regardless of the grid cell's
 * actual on-screen width - React Native's touch responder system already gives a nested Pressable
 * first refusal over its ancestor, so tapping the star reliably fires only onToggleFavorite, never
 * the tile's own onPress (see this component's own test coverage for this exact case, since
 * "event bubbling 때문에 category open이 같이 발생하지 않도록" was this round's explicit requirement).
 */
function CollectionTile({
  collection,
  isFavoriteToggleDisabled,
  isTogglingFavorite,
  onPress,
  onToggleFavorite,
}: CollectionTileProps) {
  const { t } = useTranslation();

  // Only what tells Collections apart at a glance: icon (or photo), name, and the lock / shared /
  // favorite markers - link counts and participant names live on the Collection's own screen.
  return (
    <View style={styles.gridCell}>
      <Pressable accessibilityLabel={attentionLabel(collection, t)} accessibilityRole="button" onPress={onPress} style={styles.tilePressable}>
        <View style={styles.tileIconSlot}>
          <CategoryIconTile collectionId={collection.id} color={collection.color} icon={collection.icon} imageUrl={collection.iconImageUrl} imageVersion={collection.iconImageVersion} size={56} />
          <CollectionStatusBadges isLocked={isCollectionLocked(collection)} isShared={isCollaborative(collection)} />
          {/* Approvals waiting + unread 새 링크 - the free bottom-end corner (the star holds the top end). */}
          <CountBadge count={collection.attentionCount ?? 0} style={styles.tileAttention} testID={`collection-attention-${collection.id}`} />
          {/* The caller's own favorite mark - Owner and Contributor alike, never someone else's. */}
          <Pressable
            accessibilityLabel={
              collection.isFavorite ? t('collections.removeFavorite') : t('collections.addFavorite')
            }
            accessibilityRole="button"
            accessibilityState={{ disabled: isFavoriteToggleDisabled, busy: isTogglingFavorite }}
            disabled={isFavoriteToggleDisabled}
            hitSlop={8}
            onPress={onToggleFavorite}
            style={styles.starBadge}
          >
            <StarIcon
              color={collection.isFavorite ? colors.warning : colors.border}
              filled={collection.isFavorite}
              size={13}
            />
          </Pressable>
        </View>
        <CollectionNameLabel
          crownSize={14}
          isOwner={isOwnedByMe(collection)}
          name={collection.name}
          style={styles.tileNameRow}
          testID={`collection-owner-crown-${collection.id}`}
          textStyle={styles.tileLabel}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
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
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
  },
  addButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md + 4,
    height: minTouchTarget,
    justifyContent: 'center',
    width: minTouchTarget,
  },
  headerButtons: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginTop: spacing.md,
  },
  // Centers within the remaining content area below the header/tabs (not the full screen) - flex:1
  // lets it claim whatever vertical space is left in the FlatList's flexed content column, rather
  // than absolute-positioning over the header.
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
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  // The four same-level filters as a 2x2 grid on one muted track (the previous pill language):
  // equal halves; the selected cell the Collection blue with the blue folder-glyph outline, the
  // others light gray (collectionFilterColors). Same border width everywhere - no layout shift.
  filterGrid: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md + 6,
    gap: 4,
    marginBottom: spacing.md,
    padding: 4,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 4,
  },
  filterCell: {
    alignItems: 'center',
    backgroundColor: collectionFilterColors.unselectedBackground,
    // Every cell has the same border width, so selecting one never shifts the layout.
    borderColor: collectionFilterColors.unselectedBorder,
    borderRadius: radii.md + 2,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget - 4,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  filterCellWithBadge: { paddingEnd: spacing.sm + 26 },
  // The shared 승인 대기 row, connected to the group above (the filter grid's own 12dp bottom margin) and 12dp above the content.
  myPendingRow: { marginBottom: spacing.md },
  filterBadge: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderRadius: 10,
    end: 4,
    height: 20,
    justifyContent: 'center',
    minWidth: 20,
    paddingHorizontal: 5,
    position: 'absolute',
    top: 4,
  },
  filterBadgeText: { color: colors.surface, fontSize: 11, fontWeight: '800' },
  filterCellActive: {
    backgroundColor: collectionFilterColors.selectedBackground,
    borderColor: collectionFilterColors.selectedBorder,
  },
  filterLabel: {
    color: collectionFilterColors.unselectedText,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  filterLabelActive: {
    color: collectionFilterColors.selectedText,
    fontWeight: '700',
  },
  shareRequestsRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...cardShadow,
  },
  shareRequestsLabel: { color: colors.textPrimary, flex: 1, fontSize: 15, fontWeight: '700', minWidth: 0 },
  shareRequestsBadge: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: 10,
    justifyContent: 'center',
    minWidth: 20,
    paddingHorizontal: 6,
  },
  shareRequestsBadgeText: { color: colors.surface, fontSize: 12, fontWeight: '700', lineHeight: 20 },
  // Each cell claims exactly 1/GRID_COLUMNS of the row's width - a plain percentage flexBasis
  // (not FlatList's columnWrapperStyle) so a short final row never stretches to fill the line.
  gridCell: {
    alignItems: 'center',
    flexBasis: `${100 / GRID_COLUMNS}%`,
    paddingVertical: spacing.md,
  },
  tilePressable: {
    alignItems: 'center',
    minWidth: minTouchTarget,
  },
  tileIconSlot: {
    position: 'relative',
  },
  // A small floating badge at the icon tile's corner - nested inside the tile's own Pressable (see
  // CollectionTile's own remarks on why that's still safe for touch handling), positioned against
  // tileIconSlot (sized exactly to the icon itself) rather than the full grid cell, so it lands on
  // the icon's actual corner regardless of the cell's on-screen width.
  // Overlaps the icon's bottom-end corner like the other markers - never over the name.
  tileAttention: { bottom: -6, end: -8, position: 'absolute' },
  starBadge: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 11,
    height: 22,
    justifyContent: 'center',
    position: 'absolute',
    right: -4,
    top: -4,
    width: 22,
    ...cardShadow,
  },
  tileLabel: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  // [crown] name, centered under the tile icon; the name ellipsizes before the crown does.
  tileNameRow: { justifyContent: 'center', marginTop: spacing.xs + 2, maxWidth: 84 },
  listRow: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.md, flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm, padding: spacing.sm },
  listName: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  listText: { flex: 1, minWidth: 0 },
  listIconSlot: { position: 'relative' },
  listFavorite: { padding: spacing.sm },
});

/**
 * The List form keeps the same marker hierarchy as the Grid tile: lock at the icon's top-start,
 * shared at its bottom-start, and every row (owned or shared) has the caller's own favorite star.
 * Like the tile: no link count or participant names - just what identifies the Collection.
 */
function CollectionListRow({ collection, isFavoriteToggleDisabled, isTogglingFavorite, onPress, onToggleFavorite }: CollectionTileProps) {
  const { t } = useTranslation();
  return <Pressable accessibilityLabel={attentionLabel(collection, t)} accessibilityRole="button" onPress={onPress} style={styles.listRow}>
    <View style={styles.listIconSlot}>
      <CategoryIconTile collectionId={collection.id} color={collection.color} icon={collection.icon} imageUrl={collection.iconImageUrl} imageVersion={collection.iconImageVersion} size={48} />
      <CollectionStatusBadges isLocked={isCollectionLocked(collection)} isShared={isCollaborative(collection)} size={18} />
    </View>
    <View style={styles.listText}>
      <CollectionNameLabel crownSize={16} isOwner={isOwnedByMe(collection)} name={collection.name} testID={`collection-owner-crown-${collection.id}`} textStyle={styles.listName} />
    </View>
    <CountBadge count={collection.attentionCount ?? 0} testID={`collection-attention-${collection.id}`} />
    <Pressable accessibilityLabel={collection.isFavorite ? t('collections.removeFavorite') : t('collections.addFavorite')} accessibilityRole="button" accessibilityState={{ disabled: isFavoriteToggleDisabled, busy: isTogglingFavorite }} disabled={isFavoriteToggleDisabled} hitSlop={8} onPress={onToggleFavorite} style={styles.listFavorite}>
      <StarIcon color={collection.isFavorite ? colors.warning : colors.border} filled={collection.isFavorite} size={20} />
    </Pressable>
  </Pressable>;
}

/**
 * A card's spoken name: with attention, its name plus the full count (the badge itself is hidden from
 * assistive technology and caps at 99+); otherwise undefined, so the card's own text is read as before.
 */
function attentionLabel(collection: Collection, t: TFunction): string | undefined {
  const count = collection.attentionCount ?? 0;
  const base = count > 0 ? t('collections.attentionA11y', { name: collection.name, count }) : undefined;
  // The crown is decorative: a Collection of mine says so in its spoken label ("내 컬렉션, 이름").
  return isOwnedByMe(collection) ? `${t('collections.myCategoriesTab')}, ${base ?? collection.name}` : base;
}

/** The server's own answer (accessRole) - never inferred from sharing, favorites, roles or who added what. */
function isOwnedByMe(collection: Pick<Collection, 'accessRole'>): boolean {
  return collection.accessRole === 'owner';
}
