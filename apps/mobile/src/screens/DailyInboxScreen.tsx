import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import {
  getTodayInbox,
  saveInboxEntry,
  type DailyInbox,
  type InboxEntry,
} from '../inbox/api/inboxApi';
import { useAuth } from '../auth/AuthContext';

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

function formatSavedTime(savedAtUtc: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(savedAtUtc));
}

export function DailyInboxScreen() {
  const authenticatedRequest = useAuthenticatedApi();
  const { signOut } = useAuth();
  const [dailyInbox, setDailyInbox] = useState<DailyInbox | null>(null);
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const saveUrl = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || isSaving) {
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await saveInboxEntry(authenticatedRequest, trimmedUrl);
      setUrl('');
      await loadTodayInbox();
    } catch (caughtError) {
      setError(getInboxErrorMessage(caughtError, true));
    } finally {
      setIsSaving(false);
    }
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
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.recentTitle}>최근 저장</Text>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.empty}>오늘 저장한 링크가 아직 없습니다.</Text>
      }
      renderItem={({ item }) => <InboxRow item={item} />}
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

function InboxRow({ item }: { readonly item: InboxEntry }) {
  return (
    <View style={styles.row}>
      <Text numberOfLines={2} style={styles.url}>
        {item.url}
      </Text>
      <Text style={styles.savedTime}>{formatSavedTime(item.savedAtUtc)}</Text>
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
