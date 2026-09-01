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
import type { ItemListEntry, ItemListState } from '../items/api/itemsApi';
import { useItemStateList } from '../items/useItemStateList';
import type { RootStackParamList } from '../navigation/RootStack';

function formatStateChangedTime(stateChangedAtUtc: string): string {
  return new Intl.DateTimeFormat(undefined, {
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
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { items, isLoading, isRefreshing, isLoadingMore, error, refresh, loadMore } =
    useItemStateList(state);

  const renderItem = useCallback(
    ({ item }: { item: ItemListEntry }) => (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          navigation.navigate('ItemDetails', { itemId: item.id });
        }}
        style={styles.row}
      >
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
        <Text style={styles.stateChangedTime}>
          {formatStateChangedTime(item.stateChangedAtUtc)}
        </Text>
      </Pressable>
    ),
    [navigation],
  );

  if (isLoading && items.length === 0 && !error) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
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
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
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
  stateChangedTime: {
    color: '#666666',
    fontSize: 13,
    marginTop: 5,
  },
  footerLoading: {
    paddingVertical: 20,
  },
});
