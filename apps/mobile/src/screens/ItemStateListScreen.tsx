import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import i18n from '../i18n';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getCategories, type Category } from '../categories/api/categoriesApi';
import { ItemRepresentativeThumbnail } from '../images/ItemRepresentativeThumbnail';
import type { ItemListEntry, ItemListState } from '../items/api/itemsApi';
import { useItemStateList } from '../items/useItemStateList';
import type { RootStackParamList } from '../navigation/RootStack';

function getCategoryListErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('category.errorListFallback');
}

function formatStateChangedTime(stateChangedAtUtc: string): string {
  return new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(stateChangedAtUtc));
}

interface ItemStateListScreenProps {
  readonly state: ItemListState;
  readonly title: string;
  readonly emptyMessage: string;
}

export function ItemStateListScreen({
  state,
  title,
  emptyMessage,
}: ItemStateListScreenProps) {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const authenticatedRequest = useAuthenticatedApi();
  const insets = useSafeAreaInsets();
  const {
    items,
    isLoading,
    isRefreshing,
    isLoadingMore,
    error,
    refresh,
    loadMore,
    filterCategoryId,
    setFilterCategoryId,
  } = useItemStateList(state);

  const [isFilterModalVisible, setIsFilterModalVisible] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState<readonly Category[]>([]);
  const [isLoadingCategoryOptions, setIsLoadingCategoryOptions] = useState(false);
  const [filterModalError, setFilterModalError] = useState<string | null>(null);

  const filterCategoryName =
    filterCategoryId === null
      ? t('common.all')
      : categoryOptions.find(option => option.id === filterCategoryId)?.name ?? t('common.all');

  const openFilterModal = async () => {
    setIsFilterModalVisible(true);
    setFilterModalError(null);
    setIsLoadingCategoryOptions(true);
    try {
      const categories = await getCategories(authenticatedRequest);
      setCategoryOptions(categories);
    } catch (caughtError) {
      setFilterModalError(getCategoryListErrorMessage(caughtError, t));
    } finally {
      setIsLoadingCategoryOptions(false);
    }
  };

  const selectFilterCategory = (categoryId: number | null) => {
    setFilterCategoryId(categoryId);
    setIsFilterModalVisible(false);
  };

  const renderItem = useCallback(
    ({ item }: { item: ItemListEntry }) => (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          navigation.navigate('ItemDetails', { itemId: item.id });
        }}
        style={styles.row}
      >
        <ItemRepresentativeThumbnail representativeImage={item.representativeImage} />
        <View style={styles.rowTextColumn}>
          <Text numberOfLines={2} style={styles.url}>
            {item.title ?? item.url}
          </Text>
          {item.title ? (
            <Text numberOfLines={1} style={styles.secondaryUrl}>
              {item.url}
            </Text>
          ) : null}
          {item.memo ? (
            <Text numberOfLines={2} style={styles.memoPreview}>
              {item.memo}
            </Text>
          ) : null}
          {item.category ? (
            <Text numberOfLines={1} style={styles.categoryLabel}>
              {item.category.name}
            </Text>
          ) : null}
          <Text style={styles.stateChangedTime}>
            {formatStateChangedTime(item.stateChangedAtUtc)}
          </Text>
        </View>
      </Pressable>
    ),
    [navigation],
  );

  if (isLoading && items.length === 0 && !error) {
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
        data={items}
        keyExtractor={item => item.id.toString()}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={refresh} />
        }
        renderItem={renderItem}
        ListHeaderComponent={
          <View>
            <Text style={styles.title}>{title}</Text>
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>
                {t('category.filterLabel', { name: filterCategoryName })}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={openFilterModal}
                style={styles.filterChangeButton}
              >
                <Text style={styles.filterChangeLabel}>{t('common.change')}</Text>
              </Pressable>
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          !error ? <Text style={styles.empty}>{emptyMessage}</Text> : undefined
        }
        ListFooterComponent={
          isLoadingMore ? (
            <View style={styles.footerLoading}>
              <ActivityIndicator />
            </View>
          ) : undefined
        }
      />

      <Modal
        animationType="slide"
        onRequestClose={() => setIsFilterModalVisible(false)}
        transparent
        visible={isFilterModalVisible}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: 24 + insets.bottom }]}>
            <Text style={styles.modalTitle}>{t('category.filterTitle')}</Text>

            {isLoadingCategoryOptions ? (
              <ActivityIndicator style={styles.modalLoading} />
            ) : (
              <FlatList
                ListHeaderComponent={
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => selectFilterCategory(null)}
                    style={styles.categoryOptionRow}
                  >
                    <Text style={styles.categoryOptionLabel}>{t('common.all')}</Text>
                  </Pressable>
                }
                data={categoryOptions}
                keyExtractor={option => option.id.toString()}
                renderItem={({ item: option }) => (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => selectFilterCategory(option.id)}
                    style={styles.categoryOptionRow}
                  >
                    <Text style={styles.categoryOptionLabel}>{option.name}</Text>
                  </Pressable>
                )}
                style={styles.categoryOptionList}
              />
            )}

            {filterModalError ? (
              <Text style={styles.error}>{filterModalError}</Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              onPress={() => setIsFilterModalVisible(false)}
              style={styles.modalCloseButton}
            >
              <Text style={styles.modalCloseLabel}>{t('common.close')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
    marginBottom: 16,
  },
  filterRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  filterLabel: {
    color: '#111111',
    fontSize: 14,
  },
  filterChangeButton: {
    borderColor: '#9A9A9A',
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  filterChangeLabel: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '600',
  },
  modalOverlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
    padding: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  modalLoading: {
    marginVertical: 20,
  },
  categoryOptionList: {
    maxHeight: 320,
  },
  categoryOptionRow: {
    borderTopColor: '#E0E0E0',
    borderTopWidth: 1,
    paddingVertical: 14,
  },
  categoryOptionLabel: {
    color: '#111111',
    fontSize: 15,
  },
  modalCloseButton: {
    alignItems: 'center',
    borderColor: '#111111',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 20,
    paddingVertical: 12,
  },
  modalCloseLabel: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '600',
  },
  error: {
    color: '#B42318',
    fontSize: 14,
    marginBottom: 12,
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
    paddingVertical: 14,
  },
  rowTextColumn: {
    flex: 1,
  },
  url: {
    color: '#111111',
    fontSize: 15,
  },
  secondaryUrl: {
    color: '#666666',
    fontSize: 13,
    marginTop: 3,
  },
  memoPreview: {
    color: '#666666',
    fontSize: 13,
    marginTop: 5,
  },
  categoryLabel: {
    color: '#666666',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 5,
  },
  stateChangedTime: {
    color: '#666666',
    fontSize: 13,
    marginTop: 5,
  },
  footerLoading: {
    paddingVertical: 20,
  },
});
