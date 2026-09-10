import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { SavedLinkRow } from '../components/SavedLinkRow';
import { SwipeableItemRow } from '../components/SwipeableItemRow';
import { closeOpenRow } from '../components/swipeableRowCoordinator';
import { ChevronIcon } from '../icons/ChevronIcon';
import { groupHistoryByLocalDate, todayDateKey } from '../items/historyDateGrouping';
import { useItemHistory } from '../items/useItemHistory';
import { deleteItem, type ItemHistoryEntry } from '../items/api/itemsApi';
import { shareItem } from '../items/shareItem';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, radii, spacing } from '../theme/tokens';

function getHistoryDeleteErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('history.errorDeleteFallback');
}

/** Share.share only ever rejects on a genuine native module failure - a user dismissing/canceling the sheet resolves normally, never here. */
function getHistoryShareErrorMessage(t: TFunction): string {
  return t('item.shareError');
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
  const authenticatedRequest = useAuthenticatedApi();
  const { items, isLoading, isRefreshing, isLoadingMore, error, refresh, loadMore, removeItem } =
    useItemHistory();

  const sections = useMemo(() => groupHistoryByLocalDate(items, t), [items, t]);

  const [expandedDateKeys, setExpandedDateKeys] = useState<ReadonlySet<string> | null>(null);
  const [actionInFlightItemId, setActionInFlightItemId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const isDeleteConfirmationOpenRef = useRef(false);

  const runDelete = async (itemId: number) => {
    if (actionInFlightItemId !== null) {
      return;
    }

    setActionInFlightItemId(itemId);
    setActionError(null);
    try {
      await deleteItem(authenticatedRequest, itemId);
      removeItem(itemId);
    } catch (caughtError) {
      setActionError(getHistoryDeleteErrorMessage(caughtError, t));
    } finally {
      setActionInFlightItemId(null);
    }
  };

  const runShare = async (item: ItemHistoryEntry) => {
    if (actionInFlightItemId !== null) {
      return;
    }

    setActionInFlightItemId(item.id);
    setActionError(null);
    try {
      await shareItem(item.url, item.title);
    } catch {
      setActionError(getHistoryShareErrorMessage(t));
    } finally {
      setActionInFlightItemId(null);
    }
  };

  const confirmDelete = (itemId: number) => {
    if (isDeleteConfirmationOpenRef.current) {
      return;
    }
    isDeleteConfirmationOpenRef.current = true;

    const closeConfirmation = () => {
      isDeleteConfirmationOpenRef.current = false;
    };

    Alert.alert(
      t('history.deleteConfirmTitle'),
      t('history.deleteConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel', onPress: closeConfirmation },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            closeConfirmation();
            runDelete(itemId);
          },
        },
      ],
      { cancelable: true, onDismiss: closeConfirmation },
    );
  };

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
        onScrollBeginDrag={closeOpenRow}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{t('history.title')}</Text>
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
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
              style={[styles.sectionHeader, !isExpanded && styles.sectionHeaderCollapsed]}
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
        renderItem={({ item, index, section }) => {
          const isLast = index === section.data.length - 1;
          return (
            <SwipeableItemRow
              containerStyle={[styles.historyCard, isLast && styles.historyCardLast]}
              disabled={actionInFlightItemId !== null}
              onDelete={() => confirmDelete(item.id)}
              onPress={() => {
                navigation.navigate('ItemDetails', { itemId: item.id });
              }}
              onShare={() => runShare(item)}
            >
              <SavedLinkRow isActionInFlight={actionInFlightItemId === item.id} item={item} />
            </SwipeableItemRow>
          );
        }}
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
  // A date section reads as one grouped card: the header always rounds its top corners, and only
  // rounds its bottom corners (and gets a matching gap below) when collapsed - i.e. when it's the
  // entire visible card for that date on its own. When expanded, that bottom corner/gap job moves
  // to the section's last item instead (see historyCardLast), so there is exactly one gap between
  // this date's card and the next, never a doubled one.
  sectionHeader: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.divider,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopWidth: 1,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sectionHeaderCollapsed: {
    borderBottomWidth: 1,
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
    marginBottom: spacing.sm,
  },
  sectionHeaderLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  // Every item in an expanded section shares one continuous side border with the header above it
  // (see sectionHeader) and a thin top separator - never a full bold rule, and inset from the
  // screen edge by the same amount as the header/Home cards. Only the section's last item closes
  // the shape off with rounded bottom corners and the gap before the next date's card.
  historyCard: {
    borderColor: colors.divider,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopWidth: 1,
  },
  historyCardLast: {
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
    borderBottomWidth: 1,
    marginBottom: spacing.sm,
  },
  footerLoading: {
    paddingVertical: spacing.lg,
  },
});
