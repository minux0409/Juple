import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
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
import { ChevronIcon } from '../icons/ChevronIcon';
import i18n from '../i18n';
import { ItemRepresentativeThumbnail } from '../images/ItemRepresentativeThumbnail';
import { groupHistoryByLocalDate, todayDateKey } from '../items/historyDateGrouping';
import { useItemHistory } from '../items/useItemHistory';
import type { ItemHistoryEntry } from '../items/api/itemsApi';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, spacing } from '../theme/tokens';

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
 *
 * Each date section is an independent accordion: today starts expanded, older dates start
 * collapsed (rendered with zero rows via SectionList's own `data`, not a separate component), and
 * the user's expand/collapse choices are only initialized once (not reset on every refetch).
 */
export function DateHistoryScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { items, isLoading, isRefreshing, isLoadingMore, error, refresh, loadMore } =
    useItemHistory();

  const sections = useMemo(() => groupHistoryByLocalDate(items, t), [items, t]);

  const [expandedDateKeys, setExpandedDateKeys] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    if (expandedDateKeys !== null || sections.length === 0) {
      return;
    }
    const initialKey = sections.find(section => section.dateKey === todayDateKey())?.dateKey
      ?? sections[0]?.dateKey;
    if (initialKey) {
      setExpandedDateKeys(new Set([initialKey]));
    }
  }, [sections, expandedDateKeys]);

  const toggleSection = (dateKey: string) => {
    setExpandedDateKeys(previous => {
      const next = new Set(previous ?? []);
      if (next.has(dateKey)) {
        next.delete(dateKey);
      } else {
        next.add(dateKey);
      }
      return next;
    });
  };

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
        sections={sections.map(section => ({
          ...section,
          data: expandedDateKeys?.has(section.dateKey) ? section.items : [],
        }))}
        keyExtractor={item => item.id.toString()}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{t('history.title')}</Text>
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={!error ? <Text style={styles.empty}>{t('history.empty')}</Text> : undefined}
        renderSectionHeader={({ section }) => {
          const isExpanded = expandedDateKeys?.has(section.dateKey) ?? false;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: isExpanded }}
              onPress={() => toggleSection(section.dateKey)}
              style={styles.sectionHeader}
            >
              <Text style={styles.sectionHeaderLabel}>
                {t('history.sectionHeader', { label: section.label, count: section.items.length })}
              </Text>
              <ChevronIcon
                color={colors.textSecondary}
                direction={isExpanded ? 'up' : 'down'}
                size={18}
              />
            </Pressable>
          );
        }}
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
    marginBottom: spacing.sm,
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
  sectionHeader: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs + 2,
  },
  sectionHeaderLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  row: {
    borderTopColor: colors.divider,
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingVertical: spacing.sm,
  },
  rowTextColumn: {
    flex: 1,
  },
  url: {
    color: colors.textPrimary,
    fontSize: 15,
  },
  secondaryUrl: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 3,
  },
  memoPreview: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 3,
  },
  savedTime: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 3,
  },
  footerLoading: {
    paddingVertical: spacing.lg,
  },
});
