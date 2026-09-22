import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useBottomTabBarHeight, type BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ActivityIndicator,
  FlatList,
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
  setCollectionFavorite,
  type Collection,
} from '../collections/api/collectionsApi';
import { CategoryIconTile } from '../collections/CategoryIconTile';
import { CategoryNameAndIconField } from '../collections/CategoryNameAndIconField';
import { useToastBottomAnchor } from '../components/useToastBottomAnchor';
import { DEFAULT_COLLECTION_COLOR, type CollectionColorKey } from '../collections/collectionColors';
import { DEFAULT_COLLECTION_ICON, type CollectionIconKey } from '../collections/collectionIcons';
import { CheckIcon } from '../icons/CheckIcon';
import { CloseIcon } from '../icons/CloseIcon';
import { PlusIcon } from '../icons/PlusIcon';
import { StarIcon } from '../icons/StarIcon';
import type { MainTabParamList } from '../navigation/MainTabs';
import type { RootStackParamList } from '../navigation/RootStack';
import { cardShadow, colors, minTouchTarget, radii, spacing } from '../theme/tokens';

const PAGE_LIMIT = 50;

type ActiveTab = 'favorites' | 'all';

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

function sortByCreatedAtUtcDescending(collections: readonly Collection[]): Collection[] {
  return [...collections].sort((a, b) => {
    if (a.createdAtUtc !== b.createdAtUtc) {
      return a.createdAtUtc < b.createdAtUtc ? 1 : -1;
    }
    return b.id - a.id;
  });
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
 * URLs (see collectionsApi.ts). Distinct from the legacy Category (single-select tag, removed) -
 * an Item can belong to any number of Collections. The Item list inside a Collection lives on
 * CollectionDetailsScreen; this screen only lists/creates Collections, split across two segmented
 * tabs (favorites / all) that are never shown at the same time.
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

  // Favorites is the default-selected tab (see this round's "즐겨찾기 default selected" requirement) -
  // the segmented control itself still renders favorites first/left, all second/right, matching.
  const [activeTab, setActiveTab] = useState<ActiveTab>('favorites');
  // Purely presentational toggle - the create name field + button always existed, this just hides
  // them behind the header's "+" button until needed instead of always taking up space (this
  // round's visual redesign). No change to the create flow/API itself.
  const [isCreateFormVisible, setIsCreateFormVisible] = useState(false);

  const [collections, setCollections] = useState<readonly Collection[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [icon, setIcon] = useState<CollectionIconKey>(DEFAULT_COLLECTION_ICON);
  const [color, setColor] = useState<CollectionColorKey>(DEFAULT_COLLECTION_COLOR);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Favorites are the other segmented tab's data, loaded independently of the main paginated list -
  // fully walked page-by-page (never just the first page) so a favorite count past one page is
  // never silently dropped.
  const [favorites, setFavorites] = useState<readonly Collection[]>([]);
  const [isLoadingFavorites, setIsLoadingFavorites] = useState(true);
  const [favoritesError, setFavoritesError] = useState<string | null>(null);
  const [togglingFavoriteId, setTogglingFavoriteId] = useState<number | null>(null);
  const [favoriteToggleError, setFavoriteToggleError] = useState<string | null>(null);
  const favoritesRequestIdRef = useRef(0);


  const hasLoadedOnceRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  // Guards onEndReached firing multiple times before state updates are visible to new calls.
  const loadingMoreRef = useRef(false);

  const loadFavorites = useCallback(async () => {
    const requestId = ++favoritesRequestIdRef.current;
    setIsLoadingFavorites(true);
    setFavoritesError(null);

    try {
      const collected: Collection[] = [];
      let cursor: string | undefined;
      do {
        const page = await getCollections(authenticatedRequest, { isFavorite: true, limit: PAGE_LIMIT, cursor });
        collected.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      if (favoritesRequestIdRef.current !== requestId) {
        return;
      }
      setFavorites(collected);
    } catch (caughtError) {
      if (favoritesRequestIdRef.current !== requestId) {
        return;
      }
      setFavoritesError(getListErrorMessage(caughtError, t));
    } finally {
      if (favoritesRequestIdRef.current === requestId) {
        setIsLoadingFavorites(false);
      }
    }
  }, [authenticatedRequest, t]);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const requestId = ++loadRequestIdRef.current;
      if (mode === 'refresh') {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const page = await getCollections(authenticatedRequest, { limit: PAGE_LIMIT });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setCollections(page.items);
        setNextCursor(page.nextCursor);
      } catch (caughtError) {
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        // Failure keeps whatever Collections are already shown - only the error text changes.
        setError(getListErrorMessage(caughtError, t));
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

  // Refetches every time the Categories tab regains focus, so a Collection created/renamed/
  // deleted on CollectionDetailsScreen shows up immediately on return, matching the Home/History
  // precedent. Favorites are refetched independently of the main paginated list, same as
  // ItemDetailsScreen's Purchases/RepeatPurchases independence.
  useFocusEffect(
    useCallback(() => {
      load(hasLoadedOnceRef.current ? 'refresh' : 'initial');
      loadFavorites();
      // Best-effort: keeps the native Direct Share/Quick Save composer category snapshot (see
      // categorySnapshotSync.ts) current on every visit, independently of this screen's own
      // paginated state - a failure here never affects what this screen shows.
      syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
    }, [authenticatedRequest, load, loadFavorites]),
  );

  // Refresh signaling is deliberately separate from AppToast state: revisiting this tab must
  // never recreate a toast or reset its timer.
  useEffect(() => {
    if (route.params?.refreshToken === undefined) {
      return;
    }
    tabNavigation.setParams({ refreshToken: undefined });
    void Promise.all([load('refresh'), loadFavorites()]);
  }, [load, loadFavorites, route.params?.refreshToken, tabNavigation]);

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || isLoading || isRefreshing || !nextCursor) {
      return;
    }

    const requestId = loadRequestIdRef.current;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    (async () => {
      try {
        const page = await getCollections(authenticatedRequest, {
          limit: PAGE_LIMIT,
          cursor: nextCursor,
        });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setCollections(previous => {
          const seenIds = new Set(previous.map(collection => collection.id));
          const additional = page.items.filter(collection => !seenIds.has(collection.id));
          return [...previous, ...additional];
        });
        setNextCursor(page.nextCursor);
      } catch (caughtError) {
        if (loadRequestIdRef.current === requestId) {
          setError(getListErrorMessage(caughtError, t));
        }
      } finally {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    })();
  }, [authenticatedRequest, nextCursor, isLoading, isRefreshing, t]);

  const submitCreate = async () => {
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
      const created = await createCollection(authenticatedRequest, trimmedName, icon, color);
      setCollections(previous => [created, ...previous]);
      setName('');
      setIcon(DEFAULT_COLLECTION_ICON);
      setColor(DEFAULT_COLLECTION_COLOR);
      setIsCreateFormVisible(false);
      syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
    } catch (caughtError) {
      setCreateError(getCreateErrorMessage(caughtError, t));
    } finally {
      setIsCreating(false);
    }
  };

  /** Cancels the create form: resets the draft name/icon/color (and any error) and collapses it - the header's own toggle button (now showing "×" while the form is open) calls this instead of just hiding the form, so reopening it never resumes a half-filled draft. */
  const cancelCreate = () => {
    if (isCreating) {
      return;
    }
    setName('');
    setIcon(DEFAULT_COLLECTION_ICON);
    setColor(DEFAULT_COLLECTION_COLOR);
    setCreateError(null);
    setIsCreateFormVisible(false);
  };

  /**
   * Toggles the star on either segmented tab's rows - both render the same Collection rows, so a
   * single handler keeps both `collections` and `favorites` state in lockstep, which is what makes
   * switching tabs instant (no refetch needed). Optimistic (flips immediately), but only one toggle
   * may be in flight at a time; on failure the pre-toggle Collection is restored in both lists
   * rather than trusting the flipped local state.
   */
  const toggleFavoriteAction = async (collection: Collection) => {
    if (togglingFavoriteId !== null) {
      return;
    }
    const desiredIsFavorite = !collection.isFavorite;

    setTogglingFavoriteId(collection.id);
    setFavoriteToggleError(null);
    setCollections(previous =>
      previous.map(existing =>
        existing.id === collection.id ? { ...existing, isFavorite: desiredIsFavorite } : existing,
      ),
    );
    setFavorites(previous =>
      desiredIsFavorite
        ? sortByCreatedAtUtcDescending([...previous, { ...collection, isFavorite: true }])
        : previous.filter(existing => existing.id !== collection.id),
    );

    try {
      const updated = await setCollectionFavorite(authenticatedRequest, collection.id, desiredIsFavorite);
      setCollections(previous => previous.map(existing => (existing.id === updated.id ? updated : existing)));
      setFavorites(previous => {
        const withoutStale = previous.filter(existing => existing.id !== updated.id);
        return updated.isFavorite ? sortByCreatedAtUtcDescending([...withoutStale, updated]) : withoutStale;
      });
      syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
    } catch (caughtError) {
      // Roll back to the pre-toggle Collection in both lists - never trust the optimistic flip.
      setCollections(previous =>
        previous.map(existing => (existing.id === collection.id ? collection : existing)),
      );
      setFavorites(previous => {
        const withoutStale = previous.filter(existing => existing.id !== collection.id);
        return collection.isFavorite ? sortByCreatedAtUtcDescending([...withoutStale, collection]) : withoutStale;
      });
      setFavoriteToggleError(getFavoriteToggleErrorMessage(caughtError, t));
    } finally {
      setTogglingFavoriteId(null);
    }
  };

  const activeTabData = activeTab === 'favorites' ? favorites : collections;
  const isActiveTabInitialLoading =
    activeTab === 'favorites'
      ? isLoadingFavorites && favorites.length === 0 && !favoritesError
      : isLoading && collections.length === 0 && !error;

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <FlatList
        contentContainerStyle={styles.content}
        data={activeTabData}
        keyExtractor={collection => collection.id.toString()}
        onEndReached={activeTab === 'all' ? loadMore : undefined}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => load('refresh')} />}
        ListHeaderComponent={
          <View>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{t('collections.title')}</Text>
              <Pressable
                accessibilityLabel={isCreateFormVisible ? t('common.close') : t('collections.create')}
                accessibilityRole="button"
                onPress={() => (isCreateFormVisible ? cancelCreate() : setIsCreateFormVisible(true))}
                style={styles.addButton}
              >
                {isCreateFormVisible ? (
                  <CloseIcon color={colors.surface} size={20} strokeWidth={2.25} />
                ) : (
                  <PlusIcon color={colors.surface} size={20} strokeWidth={2.25} />
                )}
              </Pressable>
            </View>

            {isCreateFormVisible ? (
              <View style={styles.createRow}>
                <View style={styles.createInputRow}>
                  <View style={styles.createFieldSlot}>
                    <CategoryNameAndIconField
                      autoFocus
                      color={color}
                      disabled={isCreating}
                      icon={icon}
                      name={name}
                      namePlaceholder={t('collections.namePlaceholder')}
                      onChangeColor={setColor}
                      onChangeIcon={setIcon}
                      onChangeName={setName}
                    />
                  </View>
                  <Pressable
                    accessibilityLabel={t('collections.createConfirmA11y')}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isCreating || !name.trim(), busy: isCreating }}
                    disabled={isCreating || !name.trim()}
                    onPress={submitCreate}
                    style={[
                      styles.createConfirmButton,
                      (isCreating || !name.trim()) && styles.createConfirmButtonDisabled,
                    ]}
                  >
                    {isCreating ? (
                      <ActivityIndicator color={colors.surface} size="small" />
                    ) : (
                      <CheckIcon color={colors.surface} size={20} strokeWidth={2.25} />
                    )}
                  </Pressable>
                </View>
                {createError ? <Text style={styles.error}>{createError}</Text> : null}
              </View>
            ) : null}

            <View style={styles.segmentRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: activeTab === 'favorites' }}
                onPress={() => setActiveTab('favorites')}
                style={[styles.segmentTab, activeTab === 'favorites' && styles.segmentTabActive]}
              >
                <Text
                  style={[styles.segmentLabel, activeTab === 'favorites' && styles.segmentLabelActive]}
                >
                  {t('collections.favoritesTitle')}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: activeTab === 'all' }}
                onPress={() => setActiveTab('all')}
                style={[styles.segmentTab, activeTab === 'all' && styles.segmentTabActive]}
              >
                <Text style={[styles.segmentLabel, activeTab === 'all' && styles.segmentLabelActive]}>
                  {t('collections.allCollectionsTitle')}
                </Text>
              </Pressable>
            </View>

            {activeTab === 'favorites' && favoritesError ? (
              <Text style={styles.error}>{favoritesError}</Text>
            ) : null}
            {favoriteToggleError ? <Text style={styles.error}>{favoriteToggleError}</Text> : null}
            {activeTab === 'all' && error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          isActiveTabInitialLoading ? (
            <ActivityIndicator style={styles.tabLoading} />
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.empty}>
                {t(activeTab === 'favorites' ? 'collections.favoritesEmpty' : 'collections.allCollectionsEmpty')}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <CollectionRow
            collection={item}
            isFavoriteToggleDisabled={togglingFavoriteId !== null}
            isTogglingFavorite={togglingFavoriteId === item.id}
            onPress={() => navigation.navigate('CollectionDetails', { collectionId: item.id })}
            onToggleFavorite={() => toggleFavoriteAction(item)}
          />
        )}
        ListFooterComponent={
          isLoadingMore ? (
            <View style={styles.footerLoading}>
              <ActivityIndicator />
            </View>
          ) : undefined
        }
      />
    </SafeAreaView>
  );
}

interface CollectionRowProps {
  readonly collection: Collection;
  readonly isFavoriteToggleDisabled: boolean;
  readonly isTogglingFavorite: boolean;
  readonly onPress: () => void;
  readonly onToggleFavorite: () => void;
}

function CollectionRow({
  collection,
  isFavoriteToggleDisabled,
  isTogglingFavorite,
  onPress,
  onToggleFavorite,
}: CollectionRowProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.row}>
      <Pressable accessibilityRole="button" onPress={onPress} style={styles.rowPressable}>
        <View style={styles.tileSlot}>
          <CategoryIconTile collectionId={collection.id} color={collection.color} icon={collection.icon} size={48} />
        </View>
        <View style={styles.rowTextColumn}>
          <Text numberOfLines={1} style={styles.rowName}>
            {collection.name}
          </Text>
          <Text style={styles.rowItemCount}>
            {t('collections.itemCount', { count: collection.itemCount })}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={
          collection.isFavorite ? t('collections.removeFavorite') : t('collections.addFavorite')
        }
        accessibilityRole="button"
        accessibilityState={{ disabled: isFavoriteToggleDisabled, busy: isTogglingFavorite }}
        disabled={isFavoriteToggleDisabled}
        onPress={onToggleFavorite}
        style={styles.favoriteButton}
      >
        <StarIcon
          color={collection.isFavorite ? colors.warning : colors.border}
          filled={collection.isFavorite}
          size={20}
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
  createRow: {
    marginBottom: spacing.md,
  },
  createInputRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  createFieldSlot: {
    flex: 1,
  },
  // Compact square confirm button (checkmark, not the removed "새 카테고리" CTA) - matches the icon
  // thumbnail's own height so it sits flush alongside the icon+name row's first line, staying
  // pinned there even while the icon/color picker panel expands below.
  createConfirmButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md + 4,
    height: minTouchTarget,
    justifyContent: 'center',
    width: minTouchTarget,
  },
  createConfirmButtonDisabled: {
    opacity: 0.5,
  },
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
  tabLoading: {
    paddingVertical: spacing.lg,
  },
  // Pill segmented control - a muted track with a solid brand-colored pill under whichever tab is
  // active, replacing the old underline-tab treatment.
  segmentRow: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md + 6,
    flexDirection: 'row',
    marginBottom: spacing.md,
    padding: 4,
  },
  segmentTab: {
    alignItems: 'center',
    borderRadius: radii.md + 2,
    flex: 1,
    paddingVertical: spacing.sm,
  },
  segmentTabActive: {
    backgroundColor: colors.brand,
  },
  segmentLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  segmentLabelActive: {
    color: colors.surface,
  },
  // Not wrapped in a SwipeableItemRow (unlike Home/History), so a real soft shadow can render here
  // without being clipped - see this app's own remarks elsewhere on why swipeable rows can't have one.
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    marginBottom: spacing.sm + 4,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md + 2,
    ...cardShadow,
  },
  rowPressable: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    marginEnd: spacing.md,
  },
  tileSlot: {
    marginEnd: spacing.md,
  },
  rowTextColumn: {
    flex: 1,
    marginEnd: spacing.sm,
  },
  rowName: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  rowItemCount: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
    marginTop: 3,
  },
  favoriteButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
  },
  footerLoading: {
    paddingVertical: spacing.lg,
  },
});
