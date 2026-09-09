import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import i18n from '../i18n';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { ItemRepresentativeThumbnail } from '../images/ItemRepresentativeThumbnail';
import { saveInboxEntry } from '../inbox/api/inboxApi';
import {
  deleteItem,
  getItemHistoryByDate,
  type ItemHistoryEntry,
} from '../items/api/itemsApi';
import { formatDateOnly } from '../items/dateOnly';
import { shareItem } from '../items/shareItem';
import type { RootStackParamList } from '../navigation/RootStack';
import { parseSharedText } from '../share/sharedTextParser';
import { useIncomingShare } from '../share/useIncomingShare';

const PAGE_LIMIT = 50;

function getInboxErrorMessage(error: unknown, isSave: boolean, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'badRequest') {
      return t('inbox.errorBadRequest');
    }

    if (error.kind === 'forbidden') {
      return t('inbox.errorForbidden');
    }

    if (error.kind === 'conflict') {
      return t('errors.accountNotReady');
    }

    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }

  return isSave ? t('inbox.errorSaveFallback') : t('inbox.errorLoadFallback');
}

function getDeleteErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('inbox.errorDeleteFallback');
}

/** Share.share only ever rejects on a genuine native module failure - a user dismissing/canceling the sheet resolves normally, never here. */
function getShareErrorMessage(t: TFunction): string {
  return t('item.shareError');
}

function formatSavedTime(savedAtUtc: string): string {
  return new Intl.DateTimeFormat(i18n.language, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(savedAtUtc));
}

/**
 * Home ("오늘 저장한 링크"): every URL the user saved today (SavedAtUtc, local calendar date),
 * regardless of current Inbox/Wishlist/Archived state - not a state-based triage view. A save that
 * is later moved to Wishlist or Archived stays visible here for the rest of the day, matching
 * History's own "오늘" section exactly (both derive from the same SavedAtUtc-local-date concept -
 * see GET /api/v1/items/history/date). Wishlist/Archive-moving actions are therefore not offered
 * from this screen; only viewing (tap -> ItemDetails) and deleting remain.
 *
 * A day's worth of saves is unbounded, so - mirroring useItemHistory.ts's verified
 * pagination/refresh pattern exactly - only one page loads up front and the rest is fetched via
 * onEndReached/loadMore, never all at once.
 */
export function DailyInboxScreen() {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { pendingShare, acknowledgePendingShare } = useIncomingShare();
  const [date, setDate] = useState<string | null>(null);
  const [items, setItems] = useState<readonly ItemHistoryEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [actionInFlightItemId, setActionInFlightItemId] = useState<number | null>(null);

  // Mirrors of the latest state/refs for use inside the Delete confirmation Alert's callbacks,
  // which are constructed once when the Alert opens and must not read stale values captured at
  // that moment - a delete can be re-attempted while the Alert is still on screen.
  const itemsRef = useRef(items);
  const actionInFlightItemIdRef = useRef(actionInFlightItemId);
  const isRefreshingRef = useRef(isRefreshing);
  const isDeleteConfirmationOpenRef = useRef(false);
  // Guards onEndReached firing multiple times before state updates are visible to new calls.
  const loadingMoreRef = useRef(false);
  // Discards a stale in-flight initial/refresh load's result if a newer one has since started
  // (e.g. rapid focus changes), and lets the first focus use the full-screen spinner while later
  // focuses (such as returning from ItemDetails after an edit) use the lighter refresh indicator.
  const loadRequestIdRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    actionInFlightItemIdRef.current = actionInFlightItemId;
  }, [actionInFlightItemId]);

  useEffect(() => {
    isRefreshingRef.current = isRefreshing;
  }, [isRefreshing]);

  const loadToday = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const requestId = ++loadRequestIdRef.current;
      if (mode === 'refresh') {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        // Recomputed on every load (not cached in state) so the app staying open across local
        // midnight picks up the new day on its next focus/refresh instead of continuing to show
        // yesterday's date.
        const today = formatDateOnly(new Date());
        const result = await getItemHistoryByDate(authenticatedRequest, today, { limit: PAGE_LIMIT });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setDate(result.date);
        setItems(result.items);
        setNextCursor(result.nextCursor);
      } catch (caughtError) {
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        // Failure keeps whatever Home already shows - only the error text changes.
        setError(getInboxErrorMessage(caughtError, false, t));
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

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || isLoading || isRefreshing || !nextCursor || !date) {
      return;
    }

    const requestId = loadRequestIdRef.current;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    (async () => {
      try {
        const result = await getItemHistoryByDate(authenticatedRequest, date, {
          limit: PAGE_LIMIT,
          cursor: nextCursor,
        });
        if (loadRequestIdRef.current !== requestId) {
          return;
        }
        setItems(previousItems => {
          const seenIds = new Set(previousItems.map(item => item.id));
          const additionalItems = result.items.filter(item => !seenIds.has(item.id));
          return [...previousItems, ...additionalItems];
        });
        setNextCursor(result.nextCursor);
      } catch (caughtError) {
        if (loadRequestIdRef.current === requestId) {
          setError(getInboxErrorMessage(caughtError, false, t));
        }
      } finally {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    })();
  }, [authenticatedRequest, date, nextCursor, isLoading, isRefreshing, t]);

  // Refetches every time the Home tab regains focus (including returning from ItemDetails after
  // an edit), matching the same focus-driven refresh already used for Wishlist/Archive.
  useFocusEffect(
    useCallback(() => {
      loadToday(hasLoadedOnceRef.current ? 'refresh' : 'initial');
    }, [loadToday]),
  );

  // Refetches when the app itself comes back from the background/inactive (e.g. the user shared a
  // URL to Juple from another app, then switched back) - useFocusEffect alone only catches
  // in-app navigation, not the app being backgrounded while the Home tab stays focused. Only
  // fires on an actual background/inactive -> active transition (mirrors the same AppState
  // precedent in useIncomingShare.ts), never on initial mount, so it never duplicates the
  // useFocusEffect load above. loadToday's own request-generation guard (loadRequestIdRef)
  // already discards whichever of the two concurrent calls resolves second.
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appStateRef.current?.match(/inactive|background/) && nextAppState === 'active') {
        loadToday('refresh');
      }
      appStateRef.current = nextAppState;
    });

    return () => subscription.remove();
  }, [loadToday]);

  useEffect(() => {
    if (!pendingShare) {
      return;
    }

    const parsedShare = parseSharedText(pendingShare.text);
    setUrl(parsedShare.text);
    setShareMessage(
      parsedShare.kind === 'exactUrl' ? t('inbox.shareReviewExactUrl') : t('inbox.shareReviewOther'),
    );
  }, [pendingShare, t]);

  const saveUrl = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || isSaving) {
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await saveInboxEntry(authenticatedRequest, trimmedUrl, pendingShare?.id);
      if (pendingShare) {
        await acknowledgePendingShare(pendingShare.id);
      }
      setUrl('');
      setShareMessage(null);
      await loadToday('refresh');
    } catch (caughtError) {
      setError(getInboxErrorMessage(caughtError, true, t));
    } finally {
      setIsSaving(false);
    }
  };

  const cancelPendingShare = async () => {
    if (!pendingShare) {
      return;
    }

    await acknowledgePendingShare(pendingShare.id);
    setUrl('');
    setShareMessage(null);
  };

  const runDelete = async (itemId: number) => {
    if (
      actionInFlightItemIdRef.current !== null ||
      isRefreshingRef.current ||
      !itemsRef.current.some(entry => entry.id === itemId)
    ) {
      return;
    }

    setActionInFlightItemId(itemId);
    setError(null);
    try {
      await deleteItem(authenticatedRequest, itemId);
      setItems(previousItems => previousItems.filter(item => item.id !== itemId));
    } catch (caughtError) {
      setError(getDeleteErrorMessage(caughtError, t));
    } finally {
      setActionInFlightItemId(null);
    }
  };

  const runShare = async (item: ItemHistoryEntry) => {
    if (actionInFlightItemIdRef.current !== null || isRefreshingRef.current) {
      return;
    }

    setActionInFlightItemId(item.id);
    setError(null);
    try {
      await shareItem(item.url, item.title);
    } catch {
      setError(getShareErrorMessage(t));
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
      t('inbox.deleteConfirmTitle'),
      t('inbox.deleteConfirmMessage'),
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
        keyExtractor={entry => entry.id.toString()}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              if (actionInFlightItemId !== null) {
                return;
              }
              loadToday('refresh');
            }}
          />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.brandRow}>
              <Text style={styles.brand}>Juple</Text>
            </View>
            <Text style={styles.title}>{t('inbox.title')}</Text>
            <Text style={styles.date}>
              {t('inbox.dateCount', { date, count: items.length })}
            </Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={setUrl}
              placeholder={t('inbox.urlPlaceholder')}
              style={styles.input}
              value={url}
            />
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={() => {
                saveUrl();
              }}
              style={[styles.saveButton, isSaving ? styles.disabledButton : null]}
            >
              <Text style={styles.saveButtonLabel}>
                {isSaving ? t('common.saving') : t('common.save')}
              </Text>
            </Pressable>
            {shareMessage ? (
              <View style={styles.shareReview}>
                <Text style={styles.shareMessage}>{shareMessage}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    cancelPendingShare();
                  }}
                  style={styles.cancelShareButton}
                >
                  <Text style={styles.cancelShareLabel}>{t('inbox.cancelShare')}</Text>
                </Pressable>
              </View>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Text style={styles.recentTitle}>{t('inbox.recentSaved')}</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>{t('inbox.empty')}</Text>}
        renderItem={({ item }) => (
          <InboxRow
            isActionDisabled={actionInFlightItemId !== null || isRefreshing}
            isActionInFlight={actionInFlightItemId === item.id}
            item={item}
            onDelete={() => {
              confirmDelete(item.id);
            }}
            onPress={() => {
              navigation.navigate('ItemDetails', { itemId: item.id });
            }}
            onShare={() => {
              runShare(item);
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

interface InboxRowProps {
  readonly item: ItemHistoryEntry;
  readonly isActionDisabled: boolean;
  readonly isActionInFlight: boolean;
  readonly onDelete: () => void;
  readonly onPress: () => void;
  readonly onShare: () => void;
}

function InboxRow({ item, isActionDisabled, isActionInFlight, onDelete, onPress, onShare }: InboxRowProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.row}>
      <Pressable accessibilityRole="button" onPress={onPress} style={styles.rowPressable}>
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
      <View style={styles.itemActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isActionDisabled }}
          disabled={isActionDisabled}
          onPress={onShare}
          style={[styles.itemActionButton, isActionDisabled && styles.disabledButton]}
        >
          <Text style={styles.itemActionLabel}>{t('item.share')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isActionDisabled, busy: isActionInFlight }}
          disabled={isActionDisabled}
          onPress={onDelete}
          style={[
            styles.itemActionButton,
            styles.deleteActionButton,
            isActionDisabled && styles.disabledButton,
          ]}
        >
          <Text style={[styles.itemActionLabel, styles.deleteActionLabel]}>
            {isActionInFlight ? t('common.processing') : t('common.delete')}
          </Text>
        </Pressable>
      </View>
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
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  brand: {
    fontSize: 26,
    fontWeight: '700',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  date: {
    marginTop: 6,
    color: '#666666',
    fontSize: 14,
  },
  input: {
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 16,
    marginTop: 24,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 8,
    marginTop: 10,
    paddingVertical: 12,
  },
  disabledButton: {
    opacity: 0.5,
  },
  saveButtonLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: '#B42318',
    fontSize: 14,
    marginTop: 12,
  },
  shareReview: {
    marginTop: 12,
  },
  shareMessage: {
    color: '#666666',
    fontSize: 14,
  },
  cancelShareButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  cancelShareLabel: {
    color: '#666666',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  recentTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 28,
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
  rowPressable: {
    flexDirection: 'row',
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
  itemActions: {
    flexDirection: 'row',
    marginTop: 10,
  },
  itemActionButton: {
    borderColor: '#9A9A9A',
    borderRadius: 6,
    borderWidth: 1,
    marginEnd: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  itemActionLabel: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '600',
  },
  deleteActionButton: {
    borderColor: '#B42318',
  },
  deleteActionLabel: {
    color: '#B42318',
  },
  footerLoading: {
    paddingVertical: 20,
  },
});
