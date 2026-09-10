import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ActivityIndicator,
  FlatList,
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
import { syncCategorySnapshotToNative } from '../categories/categorySnapshotSync';
import {
  createCollection,
  getCollections,
  setCollectionFavorite,
  type Collection,
} from '../collections/api/collectionsApi';
import { ChevronIcon } from '../icons/ChevronIcon';
import { StarIcon } from '../icons/StarIcon';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

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
  const authenticatedRequest = useAuthenticatedApi();

  const [activeTab, setActiveTab] = useState<ActiveTab>('all');

  const [collections, setCollections] = useState<readonly Collection[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
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
      const created = await createCollection(authenticatedRequest, trimmedName);
      setCollections(previous => [created, ...previous]);
      setName('');
      syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
    } catch (caughtError) {
      setCreateError(getCreateErrorMessage(caughtError, t));
    } finally {
      setIsCreating(false);
    }
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
            </View>

            <TextInput
              editable={!isCreating}
              onChangeText={setName}
              placeholder={t('collections.namePlaceholder')}
              style={styles.input}
              value={name}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isCreating, busy: isCreating }}
              disabled={isCreating}
              onPress={submitCreate}
              style={[styles.createButton, isCreating && styles.disabledButton]}
            >
              <Text style={styles.createButtonLabel}>
                {isCreating ? t('common.saving') : t('collections.create')}
              </Text>
            </Pressable>
            {createError ? <Text style={styles.error}>{createError}</Text> : null}

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
            <Text style={styles.empty}>{t('collections.empty')}</Text>
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
        <View style={styles.rowTextColumn}>
          <Text numberOfLines={1} style={styles.rowName}>
            {collection.name}
          </Text>
          <Text style={styles.rowItemCount}>
            {t('collections.itemCount', { count: collection.itemCount })}
          </Text>
        </View>
        <ChevronIcon color={colors.border} direction="right" size={18} />
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
    flex: 1,
  },
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
    fontSize: 22,
    fontWeight: '700',
    marginBottom: spacing.lg,
  },
  input: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  createButton: {
    alignItems: 'center',
    backgroundColor: colors.textPrimary,
    borderRadius: radii.md,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm + 4,
  },
  disabledButton: {
    opacity: 0.5,
  },
  createButtonLabel: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginTop: spacing.md,
  },
  empty: {
    color: colors.textSecondary,
    fontSize: 14,
    paddingVertical: spacing.lg,
  },
  tabLoading: {
    paddingVertical: spacing.lg,
  },
  segmentRow: {
    flexDirection: 'row',
    marginTop: spacing.lg,
  },
  segmentTab: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: 2,
    flex: 1,
    paddingBottom: spacing.sm,
  },
  segmentTabActive: {
    borderBottomColor: colors.brand,
  },
  segmentLabel: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  segmentLabelActive: {
    color: colors.brand,
  },
  row: {
    alignItems: 'center',
    borderTopColor: colors.divider,
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingVertical: spacing.sm + 4,
  },
  rowPressable: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginEnd: spacing.md,
  },
  rowTextColumn: {
    flex: 1,
    marginEnd: spacing.sm,
  },
  rowName: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  rowItemCount: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
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
