import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import i18n from '../i18n';
import { ItemRepresentativeThumbnail } from '../images/ItemRepresentativeThumbnail';
import { groupHistoryByLocalDate } from '../items/historyDateGrouping';
import { useItemHistory } from '../items/useItemHistory';
import type { ItemHistoryEntry } from '../items/api/itemsApi';
import type { RootStackParamList } from '../navigation/RootStack';
import { NotificationBellButton } from '../notifications/NotificationBellButton';

function formatSavedTime(savedAtUtc: string): string {
  return new Intl.DateTimeFormat(i18n.language, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(savedAtUtc));
}

/**
 * 기록: every URL the user has ever saved, grouped by the date it was originally saved
 * (SavedAtUtc, converted to the device's local calendar date - see historyDateGrouping.ts) -
 * never the Item's current Inbox/Wishlist/Archived state. A page boundary landing mid-day merges
 * into the same on-screen section since grouping runs over the whole accumulated flat list from
 * useItemHistory, not per-page.
 */
export function DateHistoryScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { items, isLoading, isRefreshing, isLoadingMore, error, refresh, loadMore } =
    useItemHistory();

  const sections = useMemo(() => groupHistoryByLocalDate(items, t), [items, t]);

  if (isLoading && items.length === 0 && !error) {
    return (
      <SafeAreaView edges={['top']} style={styles.loadingContainer}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <SectionList
        contentContainerStyle={styles.content}
        sections={sections.map(section => ({ ...section, data: section.items }))}
        keyExtractor={item => item.id.toString()}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{t('history.title')}</Text>
              <NotificationBellButton />
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={!error ? <Text style={styles.empty}>{t('history.empty')}</Text> : undefined}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>
            {t('history.sectionHeader', { label: section.label, count: section.items.length })}
          </Text>
        )}
        renderItem={({ item }) => (
          <HistoryRow
            item={item}
            onPress={() => {
              navigation.navigate('ItemDetails', { itemId: item.id });
            }}
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

interface HistoryRowProps {
  readonly item: ItemHistoryEntry;
  readonly onPress: () => void;
}

function HistoryRow({ item, onPress }: HistoryRowProps) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
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
        <Text style={styles.savedTime}>{formatSavedTime(item.savedAtUtc)}</Text>
      </View>
    </Pressable>
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
    marginBottom: 8,
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
  sectionHeader: {
    backgroundColor: '#F5F5F5',
    color: '#666666',
    fontSize: 13,
    fontWeight: '700',
    paddingTop: 16,
    paddingBottom: 6,
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
  savedTime: {
    color: '#666666',
    fontSize: 13,
    marginTop: 5,
  },
  footerLoading: {
    paddingVertical: 20,
  },
});
