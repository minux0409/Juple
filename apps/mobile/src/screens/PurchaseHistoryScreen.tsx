import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { RootStackParamList } from '../navigation/RootStack';
import type { Purchase } from '../purchases/api/purchasesApi';
import { formatDateOnlyForDisplay } from '../purchases/dateOnly';
import { usePurchaseList } from '../purchases/usePurchaseList';

export function PurchaseHistoryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { purchases, isLoading, isRefreshing, isLoadingMore, error, refresh, loadMore } =
    usePurchaseList();

  const renderItem = useCallback(({ item }: { item: Purchase }) => {
    const secondaryParts = [item.store, item.variant].filter(
      (part): part is string => Boolean(part && part.length > 0),
    );

    return (
      <View style={styles.row}>
        <Text numberOfLines={2} style={styles.productName}>
          {item.productName}
        </Text>
        <Text style={styles.purchaseDate}>{formatDateOnlyForDisplay(item.purchaseDate)}</Text>
        {item.amount !== null && item.currencyCode ? (
          // The raw decimal string from the API, shown verbatim - no Number()/Intl.NumberFormat
          // conversion, since a value like "999999999999999.9999" is not exactly representable as
          // a JS Number. Locale-aware money formatting is a later, precision-preserving iteration.
          <Text style={styles.amount}>
            {item.amount} {item.currencyCode}
          </Text>
        ) : null}
        {secondaryParts.length > 0 ? (
          <Text numberOfLines={1} style={styles.secondary}>
            {secondaryParts.join(' · ')}
          </Text>
        ) : null}
      </View>
    );
  }, []);

  if (isLoading && purchases.length === 0 && !error) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.content}
      data={purchases}
      keyExtractor={item => item.id.toString()}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      refreshControl={<RefreshControl onRefresh={refresh} refreshing={isRefreshing} />}
      renderItem={renderItem}
      ListHeaderComponent={
        <View>
          <View style={styles.headerRow}>
            <Text style={styles.title}>구매내역</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('PurchaseEditor', {})}
              style={styles.addButton}
            >
              <Text style={styles.addButtonLabel}>구매 기록 추가</Text>
            </Pressable>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={
        !error ? <Text style={styles.empty}>아직 등록된 구매 기록이 없습니다.</Text> : undefined
      }
      ListFooterComponent={
        isLoadingMore ? (
          <View style={styles.footerLoading}>
            <ActivityIndicator />
          </View>
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexGrow: 1,
    padding: 24,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  addButton: {
    backgroundColor: '#111111',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addButtonLabel: {
    color: '#FFFFFF',
    fontSize: 13,
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
    paddingVertical: 14,
  },
  productName: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '600',
  },
  purchaseDate: {
    color: '#666666',
    fontSize: 13,
    marginTop: 4,
  },
  amount: {
    color: '#111111',
    fontSize: 14,
    marginTop: 4,
  },
  secondary: {
    color: '#666666',
    fontSize: 13,
    marginTop: 4,
  },
  footerLoading: {
    paddingVertical: 20,
  },
});
