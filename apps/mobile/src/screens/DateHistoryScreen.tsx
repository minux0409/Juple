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
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import i18n from '../i18n';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { ItemRepresentativeThumbnail } from '../images/ItemRepresentativeThumbnail';
import { getTodayInbox, type DailyInbox, type InboxEntry } from '../inbox/api/inboxApi';
import type { RootStackParamList } from '../navigation/RootStack';

function getLoadErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('history.errorLoadFallback');
}

function formatSavedTime(savedAtUtc: string): string {
  return new Intl.DateTimeFormat(i18n.language, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(savedAtUtc));
}

/**
 * First-pass shell for the 기록 tab: only today's date section is backed by a real API
 * (getTodayInbox, the same one Home/Inbox uses) - there is no backend endpoint yet for browsing
 * earlier dates, so this deliberately shows just today rather than inventing fake history rows.
 */
export function DateHistoryScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const authenticatedRequest = useAuthenticatedApi();
  const [dailyInbox, setDailyInbox] = useState<DailyInbox | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same request-generation guard idiom as DailyInboxScreen/ItemStateListScreen.
  const loadRequestIdRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);

  const load = useCallback(
    async (isPullToRefresh = false) => {
      const requestId = ++loadRequestIdRef.current;
      if (isPullToRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const inbox = await getTodayInbox(authenticatedRequest);
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setDailyInbox(inbox);
      } catch (caughtError) {
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setError(getLoadErrorMessage(caughtError, t));
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

  useFocusEffect(
    useCallback(() => {
      load(hasLoadedOnceRef.current);
    }, [load]),
  );

  if (isLoading && !dailyInbox) {
    return (
      <SafeAreaView edges={['top']} style={styles.loadingContainer}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  const entries = dailyInbox?.items ?? [];

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <FlatList
        contentContainerStyle={styles.content}
        data={entries}
        keyExtractor={item => item.id.toString()}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={() => load(true)} />
        }
        ListHeaderComponent={
          <View>
            <Text style={styles.title}>{t('history.title')}</Text>
            {dailyInbox ? (
              <Text style={styles.dateHeader}>
                {t('inbox.dateCount', { date: dailyInbox.date, count: entries.length })}
              </Text>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          !error ? <Text style={styles.empty}>{t('history.empty')}</Text> : undefined
        }
        renderItem={({ item }) => (
          <HistoryRow
            item={item}
            onPress={() => {
              navigation.navigate('ItemDetails', { itemId: item.id });
            }}
          />
        )}
      />
    </SafeAreaView>
  );
}

interface HistoryRowProps {
  readonly item: InboxEntry;
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
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  dateHeader: {
    marginTop: 6,
    color: '#666666',
    fontSize: 14,
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
  savedTime: {
    color: '#666666',
    fontSize: 13,
    marginTop: 5,
  },
});
