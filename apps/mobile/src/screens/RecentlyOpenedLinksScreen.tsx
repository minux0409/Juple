import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import i18n from '../i18n';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import {
  deleteAllRecentlyOpenedLinks,
  deleteRecentlyOpenedLink,
  type RecentlyOpenedLink,
} from '../items/api/recentlyOpenedLinksApi';
import { recordItemOpen } from '../items/api/itemsApi';
import { useRecentlyOpenedLinks } from '../items/useRecentlyOpenedLinks';

function formatLastOpenedTime(lastOpenedAtUtc: string): string {
  return new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(lastOpenedAtUtc));
}

/**
 * My Page → "최근 본 링크" (Recently opened links): every saved Item the user has opened the
 * original URL of from within Juple, newest-opened-first (see GET /api/v1/recently-opened-links).
 * Re-opening a row here records the open again (moving it back to the top server-side) and then
 * simply reloads the first page - see useRecentlyOpenedLinks.ts's doc for why that is the safest
 * option, rather than reconciling the reorder client-side.
 */
export function RecentlyOpenedLinksScreen() {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const {
    items,
    isLoading,
    isRefreshing,
    isLoadingMore,
    error,
    refresh,
    loadMore,
    removeLocally,
    clearLocally,
  } = useRecentlyOpenedLinks();

  const [actionInFlightItemId, setActionInFlightItemId] = useState<number | null>(null);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const isClearAllConfirmOpenRef = useRef(false);

  const openLink = async (link: RecentlyOpenedLink) => {
    if (actionInFlightItemId !== null || isClearingAll) {
      return;
    }

    setActionInFlightItemId(link.itemId);
    setActionError(null);
    try {
      await Linking.openURL(link.url);
    } catch {
      setActionInFlightItemId(null);
      return;
    }

    try {
      await recordItemOpen(authenticatedRequest, link.itemId);
    } catch {
      // Best-effort - the URL already opened successfully, which is what matters. The list simply
      // won't reflect this particular re-open until the next successful record.
    }

    refresh();
    setActionInFlightItemId(null);
  };

  const removeEntry = async (itemId: number) => {
    if (actionInFlightItemId !== null || isClearingAll) {
      return;
    }

    setActionInFlightItemId(itemId);
    setActionError(null);
    try {
      await deleteRecentlyOpenedLink(authenticatedRequest, itemId);
      removeLocally(itemId);
    } catch {
      setActionError(t('recentlyOpenedLinks.errorDeleteFallback'));
    } finally {
      setActionInFlightItemId(null);
    }
  };

  const clearAll = async () => {
    if (isClearingAll || actionInFlightItemId !== null) {
      return;
    }

    setIsClearingAll(true);
    setActionError(null);
    try {
      await deleteAllRecentlyOpenedLinks(authenticatedRequest);
      clearLocally();
    } catch {
      setActionError(t('recentlyOpenedLinks.errorDeleteAllFallback'));
    } finally {
      setIsClearingAll(false);
    }
  };

  const confirmClearAll = () => {
    if (isClearAllConfirmOpenRef.current) {
      return;
    }
    isClearAllConfirmOpenRef.current = true;

    const closeConfirmation = () => {
      isClearAllConfirmOpenRef.current = false;
    };

    Alert.alert(
      t('recentlyOpenedLinks.deleteAllConfirmTitle'),
      t('recentlyOpenedLinks.deleteAllConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel', onPress: closeConfirmation },
        {
          text: t('recentlyOpenedLinks.deleteAll'),
          style: 'destructive',
          onPress: () => {
            closeConfirmation();
            clearAll();
          },
        },
      ],
      { cancelable: true, onDismiss: closeConfirmation },
    );
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
      <FlatList
        contentContainerStyle={styles.content}
        data={items}
        keyExtractor={item => item.itemId.toString()}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              if (actionInFlightItemId !== null || isClearingAll) {
                return;
              }
              refresh();
            }}
          />
        }
        ListHeaderComponent={
          items.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isClearingAll }}
              disabled={isClearingAll}
              onPress={confirmClearAll}
              style={[styles.deleteAllButton, isClearingAll && styles.disabledButton]}
            >
              <Text style={styles.deleteAllButtonLabel}>
                {isClearingAll ? t('common.processing') : t('recentlyOpenedLinks.deleteAll')}
              </Text>
            </Pressable>
          ) : undefined
        }
        ListEmptyComponent={
          !isLoading && !error ? (
            <Text style={styles.empty}>{t('recentlyOpenedLinks.empty')}</Text>
          ) : undefined
        }
        renderItem={({ item }) => (
          <RecentlyOpenedLinkRow
            isActionDisabled={actionInFlightItemId !== null || isClearingAll}
            isActionInFlight={actionInFlightItemId === item.itemId}
            item={item}
            onOpen={() => {
              openLink(item);
            }}
            onRemove={() => {
              removeEntry(item.itemId);
            }}
          />
        )}
        ListFooterComponent={
          <View>
            {isLoadingMore ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator />
              </View>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
          </View>
        }
      />
    </SafeAreaView>
  );
}

interface RecentlyOpenedLinkRowProps {
  readonly item: RecentlyOpenedLink;
  readonly isActionDisabled: boolean;
  readonly isActionInFlight: boolean;
  readonly onOpen: () => void;
  readonly onRemove: () => void;
}

function RecentlyOpenedLinkRow({
  item,
  isActionDisabled,
  isActionInFlight,
  onOpen,
  onRemove,
}: RecentlyOpenedLinkRowProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isActionDisabled }}
        disabled={isActionDisabled}
        onPress={onOpen}
        style={styles.rowPressable}
      >
        <View style={styles.rowTextColumn}>
          <Text numberOfLines={2} style={styles.title}>
            {item.title ?? item.url}
          </Text>
          {item.title ? (
            <Text numberOfLines={1} style={styles.secondaryUrl}>
              {item.url}
            </Text>
          ) : null}
          <Text style={styles.lastOpenedTime}>{formatLastOpenedTime(item.lastOpenedAtUtc)}</Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isActionDisabled, busy: isActionInFlight }}
        disabled={isActionDisabled}
        onPress={onRemove}
        style={[styles.removeButton, isActionDisabled && styles.disabledButton]}
      >
        <Text style={styles.removeButtonLabel}>
          {isActionInFlight ? t('common.processing') : t('recentlyOpenedLinks.deleteEntry')}
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
  deleteAllButton: {
    alignSelf: 'flex-end',
    borderColor: '#B42318',
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  deleteAllButtonLabel: {
    color: '#B42318',
    fontSize: 13,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.5,
  },
  empty: {
    color: '#666666',
    fontSize: 14,
    paddingVertical: 16,
  },
  row: {
    alignItems: 'center',
    borderTopColor: '#E0E0E0',
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingVertical: 14,
  },
  rowPressable: {
    flex: 1,
  },
  rowTextColumn: {
    flex: 1,
  },
  title: {
    color: '#111111',
    fontSize: 15,
  },
  secondaryUrl: {
    color: '#666666',
    fontSize: 13,
    marginTop: 3,
  },
  lastOpenedTime: {
    color: '#666666',
    fontSize: 13,
    marginTop: 5,
  },
  removeButton: {
    borderColor: '#9A9A9A',
    borderRadius: 6,
    borderWidth: 1,
    marginStart: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  removeButtonLabel: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '600',
  },
  error: {
    color: '#B42318',
    fontSize: 14,
    marginTop: 12,
  },
  footerLoading: {
    paddingVertical: 20,
  },
});
