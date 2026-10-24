import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { LoadFailureState } from '../components/LoadFailureState';
import type { RootStackParamList } from '../navigation/RootStack';
import {
  noticeGet,
  noticeQuery,
  type NoticeItem,
  type NoticePage,
} from '../notices/noticesApi';
import {
  colors,
  minTouchTarget,
  radii,
  spacing,
  themedStyles,
} from '../theme/tokens';

export function NoticesScreen() {
  const { t, i18n } = useTranslation();
  const request = useAuthenticatedApi();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [items, setItems] = useState<readonly NoticeItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const language = i18n.resolvedLanguage ?? i18n.language;
  const load = useCallback(
    async (next: string | null = null) => {
      if (next && pending.current) return;
      const own = next ? generation.current : ++generation.current;
      pending.current = true;
      setBusy(true);
      setError(null);
      try {
        const page = await noticeGet<NoticePage>(
          request,
          `/api/v1/notices?${noticeQuery(language)}${
            next ? `&cursor=${encodeURIComponent(next)}` : ''
          }`,
        );
        if (own === generation.current) {
          setItems(old =>
            next
              ? [
                  ...old,
                  ...page.items.filter(n => !old.some(x => x.id === n.id)),
                ]
              : page.items,
          );
          setCursor(page.nextCursor);
        }
      } catch (caught) {
        if (own === generation.current) setError(caught);
      } finally {
        if (own === generation.current) {
          pending.current = false;
          setBusy(false);
        }
      }
    },
    [request, language],
  );
  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
      const sub = AppState.addEventListener('change', state => {
        if (state === 'active') load().catch(() => undefined);
      });
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') load().catch(() => undefined);
      }, 60000);
      return () => {
        generation.current++;
        pending.current = false;
        sub.remove();
        clearInterval(timer);
      };
    }, [load]),
  );
  return (
    <StackScreenSafeArea style={styles.safe}>
      <FlatList
        data={items}
        keyExtractor={item => String(item.id)}
        contentContainerStyle={[
          styles.list,
          !items.length && !busy && !error && styles.emptyList,
        ]}
        refreshing={busy}
        onRefresh={() => {
          load().catch(() => undefined);
        }}
        onEndReached={() => {
          if (cursor && !busy && !error) load(cursor).catch(() => undefined);
        }}
        ListEmptyComponent={
          !busy && !error ? (
            <Text style={styles.empty} testID="notices-empty">
              {t('notices.empty')}
            </Text>
          ) : undefined
        }
        ListFooterComponent={
          error ? (
            <LoadFailureState
              error={error}
              onRetry={() => {
                load().catch(() => undefined);
              }}
            />
          ) : busy ? (
            <ActivityIndicator />
          ) : cursor ? (
            <Pressable
              accessibilityRole="button"
              style={styles.more}
              onPress={() => {
                load(cursor).catch(() => undefined);
              }}
            >
              <Text style={styles.secondary}>{t('notices.more')}</Text>
            </Pressable>
          ) : undefined
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            testID={`notice-${item.id}`}
            style={styles.card}
            onPress={() =>
              navigation.navigate('NoticeDetail', { noticeId: item.id })
            }
          >
            <View style={styles.meta}>
              {item.isPinned ? (
                <Text style={styles.secondary}>{t('notices.pinned')}</Text>
              ) : null}
              {item.isImportant ? (
                <Text style={styles.important}>{t('notices.important')}</Text>
              ) : null}
              <Text style={styles.secondary}>
                {new Intl.DateTimeFormat(language, {
                  dateStyle: 'medium',
                }).format(new Date(item.publishedAtUtc))}
              </Text>
              <Text style={styles.secondary}>
                {t(item.isRead ? 'notices.read' : 'notices.unread')}
              </Text>
            </View>
            <Text style={[styles.title, !item.isRead && styles.unread]}>
              {item.title}
            </Text>
            <Text numberOfLines={2} style={styles.preview}>
              {item.preview}
            </Text>
          </Pressable>
        )}
      />
    </StackScreenSafeArea>
  );
}
const styles = themedStyles(() => ({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  emptyList: { justifyContent: 'center' },
  empty: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
  card: {
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    minHeight: minTouchTarget,
  },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  secondary: { fontSize: 12, color: colors.textSecondary },
  important: { fontSize: 12, color: colors.brand, fontWeight: '700' },
  title: { fontSize: 17, color: colors.textPrimary, marginTop: spacing.sm },
  unread: { fontWeight: '700' },
  preview: { fontSize: 14, color: colors.textSecondary, marginTop: spacing.sm },
  more: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    alignItems: 'center',
  },
}));
