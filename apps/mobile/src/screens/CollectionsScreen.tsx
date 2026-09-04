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
import { createCollection, getCollections, type Collection } from '../collections/api/collectionsApi';
import type { RootStackParamList } from '../navigation/RootStack';

const PAGE_LIMIT = 50;

function getListErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('collections.errorListFallback');
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

  const hasLoadedOnceRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  // Guards onEndReached firing multiple times before state updates are visible to new calls.
  const loadingMoreRef = useRef(false);

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
  // deleted on CollectionDetailsScreen shows up immediately on return, matching the
  // Home/History/Wishlist/Archive precedent.
  useFocusEffect(
    useCallback(() => {
      load(hasLoadedOnceRef.current ? 'refresh' : 'initial');
    }, [load]),
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
            <Text style={styles.title}>{t('collections.title')}</Text>

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
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('CollectionDetails', { collectionId: item.id })}
            style={styles.row}
          >
            <Text numberOfLines={1} style={styles.rowName}>
              {item.name}
            </Text>
            <Text style={styles.rowItemCount}>
              {t('collections.itemCount', { count: item.itemCount })}
            </Text>
          </Pressable>
        )}
        ListFooterComponent={
          <View style={styles.legacySection}>
            {isLoadingMore ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator />
              </View>
            ) : null}
            <Text style={styles.sectionTitle}>{t('collections.existingScreens')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('Wishlist')}
              style={styles.linkButton}
            >
              <Text style={styles.linkButtonLabel}>{t('collections.viewWishlist')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('Archive')}
              style={styles.linkButton}
            >
              <Text style={styles.linkButtonLabel}>{t('collections.viewArchive')}</Text>
            </Pressable>
          </View>
        }
      />
    </SafeAreaView>
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
  row: {
    borderTopColor: '#E0E0E0',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 24,
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
  legacySection: {
    marginTop: 40,
  },
  footerLoading: {
    paddingBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 12,
  },
  linkButton: {
    alignItems: 'center',
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 10,
    paddingVertical: 12,
  },
  linkButtonLabel: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '600',
  },
});
