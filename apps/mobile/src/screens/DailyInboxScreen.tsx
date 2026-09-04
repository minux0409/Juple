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
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { ItemRepresentativeThumbnail } from '../images/ItemRepresentativeThumbnail';
import {
  getTodayInbox,
  saveInboxEntry,
  type DailyInbox,
  type InboxEntry,
} from '../inbox/api/inboxApi';
import { deleteItem, moveItemToArchive, moveItemToWishlist } from '../items/api/itemsApi';
import type { RootStackParamList } from '../navigation/RootStack';
import { parseSharedText } from '../share/sharedTextParser';
import { useIncomingShare } from '../share/useIncomingShare';

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

function getItemActionErrorMessage(error: unknown, isDelete: boolean, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return isDelete ? t('inbox.errorDeleteFallback') : t('inbox.errorMoveFallback');
}

function formatSavedTime(savedAtUtc: string): string {
  return new Intl.DateTimeFormat(i18n.language, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(savedAtUtc));
}

export function DailyInboxScreen() {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { pendingShare, acknowledgePendingShare } = useIncomingShare();
  const [dailyInbox, setDailyInbox] = useState<DailyInbox | null>(null);
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [actionInFlightItemId, setActionInFlightItemId] = useState<number | null>(null);

  // Mirrors of the latest state/refs for use inside the Delete confirmation Alert's callbacks,
  // which are constructed once when the Alert opens and must not read stale values captured at
  // that moment - a Wishlist/Archive action can complete while the Alert is still on screen.
  const dailyInboxRef = useRef(dailyInbox);
  const actionInFlightItemIdRef = useRef(actionInFlightItemId);
  const isRefreshingRef = useRef(isRefreshing);
  const isDeleteConfirmationOpenRef = useRef(false);
  // Discards a stale in-flight load's result if a newer one has since started (e.g. rapid focus
  // changes), and lets the first focus use the full-screen spinner while later focuses (such as
  // returning from ItemDetails after an edit) use the lighter refresh indicator instead.
  const loadRequestIdRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    dailyInboxRef.current = dailyInbox;
  }, [dailyInbox]);

  useEffect(() => {
    actionInFlightItemIdRef.current = actionInFlightItemId;
  }, [actionInFlightItemId]);

  useEffect(() => {
    isRefreshingRef.current = isRefreshing;
  }, [isRefreshing]);

  const loadTodayInbox = useCallback(
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

  // Refetches every time the Inbox tab regains focus (including returning from ItemDetails after
  // an edit), matching the same focus-driven refresh already used for Wishlist/Archive.
  useFocusEffect(
    useCallback(() => {
      loadTodayInbox(hasLoadedOnceRef.current);
    }, [loadTodayInbox]),
  );

  // Refetches when the app itself comes back from the background/inactive (e.g. the user shared a
  // URL to Juple from another app, then switched back) - useFocusEffect alone only catches
  // in-app navigation, not the app being backgrounded while the Inbox tab stays focused. Only
  // fires on an actual background/inactive -> active transition (mirrors the same AppState
  // precedent in useIncomingShare.ts), never on initial mount, so it never duplicates the
  // useFocusEffect load above. loadTodayInbox's own request-generation guard (loadRequestIdRef)
  // already discards whichever of the two concurrent calls resolves second.
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appStateRef.current?.match(/inactive|background/) && nextAppState === 'active') {
        loadTodayInbox(true);
      }
      appStateRef.current = nextAppState;
    });

    return () => subscription.remove();
  }, [loadTodayInbox]);

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
      await loadTodayInbox();
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

  const runItemAction = async (
    itemId: number,
    action: (request: AuthenticatedApiRequest, id: number) => Promise<void>,
    isDelete = false,
  ) => {
    if (
      actionInFlightItemIdRef.current !== null ||
      isRefreshingRef.current ||
      !dailyInboxRef.current?.items.some(entry => entry.id === itemId)
    ) {
      return;
    }

    setActionInFlightItemId(itemId);
    setError(null);
    try {
      await action(authenticatedRequest, itemId);
      setDailyInbox(previous =>
        previous
          ? { ...previous, items: previous.items.filter(item => item.id !== itemId) }
          : previous,
      );
    } catch (caughtError) {
      setError(getItemActionErrorMessage(caughtError, isDelete, t));
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
            runItemAction(itemId, deleteItem, true);
          },
        },
      ],
      { cancelable: true, onDismiss: closeConfirmation },
    );
  };

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
        keyExtractor={entry => entry.id.toString()}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              if (actionInFlightItemId !== null) {
                return;
              }
              loadTodayInbox(true);
            }}
          />
        }
        ListHeaderComponent={
          <View>
            <Text style={styles.brand}>Juple</Text>
            <Text style={styles.title}>{t('inbox.title')}</Text>
            <Text style={styles.date}>
              {t('inbox.dateCount', { date: dailyInbox?.date, count: entries.length })}
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
            onArchive={() => {
              runItemAction(item.id, moveItemToArchive);
            }}
            onDelete={() => {
              confirmDelete(item.id);
            }}
            onPress={() => {
              navigation.navigate('ItemDetails', { itemId: item.id });
            }}
            onWishlist={() => {
              runItemAction(item.id, moveItemToWishlist);
            }}
          />
        )}
      />
    </SafeAreaView>
  );
}

interface InboxRowProps {
  readonly item: InboxEntry;
  readonly isActionDisabled: boolean;
  readonly isActionInFlight: boolean;
  readonly onWishlist: () => void;
  readonly onArchive: () => void;
  readonly onDelete: () => void;
  readonly onPress: () => void;
}

function InboxRow({
  item,
  isActionDisabled,
  isActionInFlight,
  onWishlist,
  onArchive,
  onDelete,
  onPress,
}: InboxRowProps) {
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
          {item.category ? (
            <Text numberOfLines={1} style={styles.categoryLabel}>
              {item.category.name}
            </Text>
          ) : null}
          <Text style={styles.savedTime}>{formatSavedTime(item.savedAtUtc)}</Text>
        </View>
      </Pressable>
      <View style={styles.itemActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isActionDisabled, busy: isActionInFlight }}
          disabled={isActionDisabled}
          onPress={onWishlist}
          style={[styles.itemActionButton, isActionDisabled && styles.disabledButton]}
        >
          <Text style={styles.itemActionLabel}>
            {isActionInFlight ? t('common.processing') : t('inbox.moveToWishlist')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isActionDisabled, busy: isActionInFlight }}
          disabled={isActionDisabled}
          onPress={onArchive}
          style={[styles.itemActionButton, isActionDisabled && styles.disabledButton]}
        >
          <Text style={styles.itemActionLabel}>
            {isActionInFlight ? t('common.processing') : t('inbox.moveToArchive')}
          </Text>
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
  brand: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 28,
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
  categoryLabel: {
    color: '#666666',
    fontSize: 11,
    fontWeight: '600',
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
});
