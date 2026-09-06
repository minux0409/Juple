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
import {
  createCollection,
  getCollections,
  setCollectionFavorite,
  type Collection,
} from '../collections/api/collectionsApi';
import type { RootStackParamList } from '../navigation/RootStack';
import { NotificationBellButton } from '../notifications/NotificationBellButton';

const PAGE_LIMIT = 50;

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
 * 보관함: user-named buckets of saved URLs (see collectionsApi.ts). Distinct from the legacy
 * Category (single-select tag) - an Item can belong to any number of Collections. The Item list
 * inside a Collection lives on CollectionDetailsScreen; this screen only lists/creates Collections.
 */
export function CollectionsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const authenticatedRequest = useAuthenticatedApi();

  const [collections, setCollections] = useState<readonly Collection[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Favorites are a small quick-access section, loaded independently of the main paginated list -
  // fully walked page-by-page (never just the first page) so a favorite count past one page is
  // never silently dropped from the section.
  const [favorites, setFavorites] = useState<readonly Collection[]>([]);
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

  // Refetches every time the Collections tab regains focus, so a Collection created/renamed/
  // deleted on CollectionDetailsScreen shows up immediately on return, matching the Home/History
  // precedent. Favorites are refetched independently of the main paginated list, same as
  // ItemDetailsScreen's Purchases/RepeatPurchases independence.
  useFocusEffect(
    useCallback(() => {
      load(hasLoadedOnceRef.current ? 'refresh' : 'initial');
      loadFavorites();
    }, [load, loadFavorites]),
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
    } catch (caughtError) {
      setCreateError(getCreateErrorMessage(caughtError, t));
    } finally {
      setIsCreating(false);
    }
  };

  /**
   * Toggles the star on either the favorites section or the main list - both render the same
   * Collection rows, so a single handler keeps both in sync. Optimistic (flips immediately, no
   * disabling of the whole screen), but only one toggle may be in flight at a time; on failure the
   * pre-toggle Collection is restored in both lists rather than trusting the flipped local state.
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

  if (isLoading && collections.length === 0 && !error) {
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
        data={collections}
        keyExtractor={collection => collection.id.toString()}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => load('refresh')} />}
        ListHeaderComponent={
          <View>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{t('collections.title')}</Text>
              <NotificationBellButton />
            </View>

            {favorites.length > 0 || favoritesError ? (
              <View style={styles.favoritesSection}>
                <Text style={styles.sectionTitle}>{t('collections.favoritesTitle')}</Text>
                {favorites.map(favorite => (
                  <CollectionRow
                    key={favorite.id}
                    collection={favorite}
                    isFavoriteToggleDisabled={togglingFavoriteId !== null}
                    isTogglingFavorite={togglingFavoriteId === favorite.id}
                    onPress={() => navigation.navigate('CollectionDetails', { collectionId: favorite.id })}
                    onToggleFavorite={() => toggleFavoriteAction(favorite)}
                  />
                ))}
                {favoritesError ? <Text style={styles.error}>{favoritesError}</Text> : null}
                {favoriteToggleError ? <Text style={styles.error}>{favoriteToggleError}</Text> : null}
              </View>
            ) : null}

            <Text style={styles.sectionTitle}>{t('collections.allCollectionsTitle')}</Text>

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
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={!error ? <Text style={styles.empty}>{t('collections.empty')}</Text> : undefined}
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
        <Text numberOfLines={1} style={styles.rowName}>
          {collection.name}
        </Text>
        <Text style={styles.rowItemCount}>
          {t('collections.itemCount', { count: collection.itemCount })}
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel={
          collection.isFavorite ? t('collections.removeFavorite') : t('collections.addFavorite')
        }
        accessibilityRole="button"
        accessibilityState={{ disabled: isFavoriteToggleDisabled, busy: isTogglingFavorite }}
        disabled={isFavoriteToggleDisabled}
        hitSlop={8}
        onPress={onToggleFavorite}
        style={styles.favoriteButton}
      >
        <Text style={[styles.favoriteButtonLabel, collection.isFavorite && styles.favoriteButtonLabelActive]}>
          {collection.isFavorite ? '★' : '☆'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexGrow: 1,
    padding: 24,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 20,
  },
  input: {
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  createButton: {
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 8,
    marginTop: 10,
    paddingVertical: 12,
  },
  disabledButton: {
    opacity: 0.5,
  },
  createButtonLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: '#B42318',
    fontSize: 14,
    marginTop: 12,
  },
  empty: {
    color: '#666666',
    fontSize: 14,
    paddingVertical: 16,
  },
  favoritesSection: {
    marginBottom: 12,
  },
  row: {
    borderTopColor: '#E0E0E0',
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 24,
  },
  rowPressable: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginEnd: 12,
  },
  rowName: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    marginEnd: 12,
  },
  rowItemCount: {
    color: '#666666',
    fontSize: 13,
  },
  favoriteButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
    minWidth: 32,
  },
  favoriteButtonLabel: {
    color: '#9A9A9A',
    fontSize: 22,
  },
  favoriteButtonLabelActive: {
    color: '#F5A623',
  },
  footerLoading: {
    paddingVertical: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 12,
  },
});
