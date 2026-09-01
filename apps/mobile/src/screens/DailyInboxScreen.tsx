import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import {
  getTodayInbox,
  saveInboxEntry,
  type DailyInbox,
  type InboxEntry,
} from '../inbox/api/inboxApi';
import { deleteItem, moveItemToArchive, moveItemToWishlist } from '../items/api/itemsApi';
import { useAuth } from '../auth/AuthContext';
import { parseSharedText } from '../share/sharedTextParser';
import { useIncomingShare } from '../share/useIncomingShare';

function getInboxErrorMessage(error: unknown, isSave: boolean): string {
  if (error instanceof ApiError) {
    if (error.kind === 'badRequest') {
      return '올바른 http 또는 https 주소를 입력해 주세요.';
    }

    if (error.kind === 'forbidden') {
      return '이 요청을 수행할 권한을 확인하지 못했습니다.';
    }

    if (error.kind === 'conflict') {
      return 'Juple 계정 준비 상태를 확인할 수 없습니다.';
    }

    if (error.kind === 'unauthorized') {
      return '인증 상태를 다시 확인할 수 없습니다.';
    }
  }

  return isSave
    ? '링크를 저장할 수 없습니다.'
    : '오늘의 Inbox를 불러올 수 없습니다.';
}

function getItemActionErrorMessage(error: unknown, isDelete: boolean): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return '인증 상태를 다시 확인할 수 없습니다.';
  }
  return isDelete ? '항목을 삭제할 수 없습니다.' : '항목을 이동할 수 없습니다.';
}

function formatSavedTime(savedAtUtc: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(savedAtUtc));
}

export function DailyInboxScreen() {
  const authenticatedRequest = useAuthenticatedApi();
  const { signOut } = useAuth();
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
      if (isPullToRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        setDailyInbox(await getTodayInbox(authenticatedRequest));
      } catch (caughtError) {
        setError(getInboxErrorMessage(caughtError, false));
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [authenticatedRequest],
  );

  useEffect(() => {
    loadTodayInbox();
  }, [loadTodayInbox]);

  useEffect(() => {
    if (!pendingShare) {
      return;
    }

    const parsedShare = parseSharedText(pendingShare.text);
    setUrl(parsedShare.text);
    setShareMessage(
      parsedShare.kind === 'exactUrl'
        ? '공유된 링크를 확인해 주세요.'
        : '공유된 내용을 확인해 주세요.',
    );
  }, [pendingShare]);

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
      setError(getInboxErrorMessage(caughtError, true));
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
      setError(getItemActionErrorMessage(caughtError, isDelete));
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
      '항목 삭제',
      '이 항목을 삭제할까요? 삭제 후 되돌릴 수 없습니다.',
      [
        { text: '취소', style: 'cancel', onPress: closeConfirmation },
        {
          text: '삭제',
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
      <View style={styles.loadingContainer}>
        <ActivityIndicator />
      </View>
    );
  }

  const entries = dailyInbox?.items ?? [];

  return (
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
          <Text style={styles.title}>오늘의 Inbox</Text>
          <Text style={styles.date}>
            {dailyInbox?.date} {entries.length}개
          </Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={setUrl}
            placeholder="URL을 붙여넣어 주세요"
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
              {isSaving ? '저장 중...' : '저장'}
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
                <Text style={styles.cancelShareLabel}>공유 내용 취소</Text>
              </Pressable>
            </View>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.recentTitle}>최근 저장</Text>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.empty}>오늘 저장한 링크가 아직 없습니다.</Text>
      }
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
          onWishlist={() => {
            runItemAction(item.id, moveItemToWishlist);
          }}
        />
      )}
      ListFooterComponent={
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            signOut();
          }}
          style={styles.signOutButton}
        >
          <Text style={styles.signOutLabel}>로그아웃</Text>
        </Pressable>
      }
    />
  );
}

interface InboxRowProps {
  readonly item: InboxEntry;
  readonly isActionDisabled: boolean;
  readonly isActionInFlight: boolean;
  readonly onWishlist: () => void;
  readonly onArchive: () => void;
  readonly onDelete: () => void;
}

function InboxRow({
  item,
  isActionDisabled,
  isActionInFlight,
  onWishlist,
  onArchive,
  onDelete,
}: InboxRowProps) {
  return (
    <View style={styles.row}>
      <Text numberOfLines={2} style={styles.url}>
        {item.url}
      </Text>
      <Text style={styles.savedTime}>{formatSavedTime(item.savedAtUtc)}</Text>
      <View style={styles.itemActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isActionDisabled, busy: isActionInFlight }}
          disabled={isActionDisabled}
          onPress={onWishlist}
          style={[styles.itemActionButton, isActionDisabled && styles.disabledButton]}
        >
          <Text style={styles.itemActionLabel}>
            {isActionInFlight ? '처리 중...' : '위시리스트'}
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
            {isActionInFlight ? '처리 중...' : '보관'}
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
            {isActionInFlight ? '처리 중...' : '삭제'}
          </Text>
        </Pressable>
      </View>
    </View>
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
  url: {
    color: '#111111',
    fontSize: 15,
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
    marginRight: 10,
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
  signOutButton: {
    alignItems: 'center',
    borderColor: '#111111',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 28,
    paddingVertical: 12,
  },
  signOutLabel: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '600',
  },
});
