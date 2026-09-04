import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../navigation/RootStack';
import type { Purchase } from '../purchases/api/purchasesApi';
import type { RepeatPurchase } from '../purchases/api/repeatPurchasesApi';
import { formatDateOnlyForDisplay } from '../purchases/dateOnly';
import { formatIntervalDescription } from '../purchases/repeatPurchaseFormat';
import { usePurchaseList } from '../purchases/usePurchaseList';
import { useRepeatPurchaseList } from '../purchases/useRepeatPurchaseList';

type Segment = 'purchases' | 'repeatPurchases';

export function PurchaseHistoryScreen() {
  const { t } = useTranslation();
  const [segment, setSegment] = useState<Segment>('purchases');

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <View style={styles.segmentRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: segment === 'purchases' }}
          onPress={() => setSegment('purchases')}
          style={[styles.segmentButton, segment === 'purchases' && styles.segmentButtonActive]}
        >
          <Text
            style={[styles.segmentLabel, segment === 'purchases' && styles.segmentLabelActive]}
          >
            {t('purchaseHistory.purchasesTab')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: segment === 'repeatPurchases' }}
          onPress={() => setSegment('repeatPurchases')}
          style={[
            styles.segmentButton,
            segment === 'repeatPurchases' && styles.segmentButtonActive,
          ]}
        >
          <Text
            style={[
              styles.segmentLabel,
              segment === 'repeatPurchases' && styles.segmentLabelActive,
            ]}
          >
            {t('purchaseHistory.repeatPurchasesTab')}
          </Text>
        </Pressable>
      </View>

      {segment === 'purchases' ? <PurchaseListSection /> : <RepeatPurchaseListSection />}
    </SafeAreaView>
  );
}

function PurchaseListSection() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { purchases, isLoading, isRefreshing, isLoadingMore, error, refresh, loadMore } =
    usePurchaseList();

  const renderItem = useCallback(
    ({ item }: { item: Purchase }) => {
      const secondaryParts = [item.store, item.variant].filter(
        (part): part is string => Boolean(part && part.length > 0),
      );

      return (
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('PurchaseDetails', { purchaseId: item.id })}
          style={styles.row}
        >
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
        </Pressable>
      );
    },
    [navigation],
  );

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
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('PurchaseEditor', {})}
            style={styles.addButton}
          >
            <Text style={styles.addButtonLabel}>{t('item.addPurchase')}</Text>
          </Pressable>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={
        !error ? <Text style={styles.empty}>{t('purchaseHistory.empty')}</Text> : undefined
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

function RepeatPurchaseListSection() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {
    repeatPurchases,
    isLoading,
    isRefreshing,
    isLoadingMore,
    error,
    refresh,
    loadMore,
    includeDisabled,
    setIncludeDisabled,
  } = useRepeatPurchaseList();

  const renderItem = useCallback(
    ({ item }: { item: RepeatPurchase }) => (
      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.navigate('RepeatPurchaseDetails', { repeatPurchaseId: item.id })}
        style={styles.row}
      >
        <Text numberOfLines={2} style={styles.productName}>
          {item.productName}
        </Text>
        <Text style={styles.purchaseDate}>
          {t('repeatPurchase.nextPurchaseDateLabel', {
            date: formatDateOnlyForDisplay(item.nextPurchaseDate),
          })}
        </Text>
        <Text style={styles.secondary}>
          {formatIntervalDescription(t, item.intervalValue, item.intervalUnit)}
        </Text>
        {/* Only a status hint - re-enabling still only happens from RepeatPurchaseDetails' own button. */}
        {!item.isEnabled ? <Text style={styles.pausedLabel}>{t('repeatPurchase.paused')}</Text> : null}
      </Pressable>
    ),
    [navigation, t],
  );

  if (isLoading && repeatPurchases.length === 0 && !error) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.content}
      data={repeatPurchases}
      keyExtractor={item => item.id.toString()}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      refreshControl={<RefreshControl onRefresh={refresh} refreshing={isRefreshing} />}
      renderItem={renderItem}
      ListHeaderComponent={
        <View>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('RepeatPurchaseEditor', {})}
            style={styles.addButton}
          >
            <Text style={styles.addButtonLabel}>{t('item.addRepeatPurchase')}</Text>
          </Pressable>
          <View style={styles.includeDisabledRow}>
            <Text style={styles.includeDisabledLabel}>{t('purchaseHistory.includeDisabled')}</Text>
            <Switch onValueChange={setIncludeDisabled} value={includeDisabled} />
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={
        !error ? <Text style={styles.empty}>{t('item.noRepeatPurchases')}</Text> : undefined
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
  screen: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 4,
  },
  segmentButton: {
    alignItems: 'center',
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    marginEnd: 8,
    paddingVertical: 10,
  },
  segmentButtonActive: {
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  segmentLabel: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '600',
  },
  segmentLabelActive: {
    color: '#FFFFFF',
  },
  content: {
    flexGrow: 1,
    padding: 24,
  },
  addButton: {
    alignSelf: 'flex-end',
    backgroundColor: '#111111',
    borderRadius: 8,
    marginBottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addButtonLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  includeDisabledRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  includeDisabledLabel: {
    color: '#111111',
    fontSize: 14,
  },
  pausedLabel: {
    color: '#9A9A9A',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
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
