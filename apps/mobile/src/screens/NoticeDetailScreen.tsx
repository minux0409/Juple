import {
  useFocusEffect,
  useIsFocused,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  Text,
} from 'react-native';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { LoadFailureState } from '../components/LoadFailureState';
import type { RootStackParamList } from '../navigation/RootStack';
import {
  noticeGet,
  noticePlatform,
  noticeQuery,
  noticeReadChanged,
  type NoticeDetail,
} from '../notices/noticesApi';
import { noticeBlocks, safeNoticeUrl } from '../notices/noticeContent';
import { colors, minTouchTarget, spacing, themedStyles } from '../theme/tokens';

export function NoticeDetailScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'NoticeDetail'>>();
  const { t, i18n } = useTranslation();
  const request = useAuthenticatedApi();
  const focused = useIsFocused();
  const [detail, setDetail] = useState<NoticeDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [readError, setReadError] = useState(false);
  const generation = useRef(0);
  const language = i18n.resolvedLanguage ?? i18n.language;
  const load = useCallback(
    (clear = true) => {
      const own = ++generation.current;
      if (clear) {
        setDetail(null);
        setReadError(false);
      }
      setError(null);
      noticeGet<NoticeDetail>(
        request,
        `/api/v1/notices/${params.noticeId}?${noticeQuery(language)}`,
      ).then(
        value => {
          if (own === generation.current) {
            setDetail(value);
            if (value.notice.isRead) setReadError(false);
          }
        },
        caught => {
          if (own === generation.current) {
            setError(caught);
            if (
              caught instanceof ApiError &&
              (caught.kind === 'notFound' || caught.kind === 'forbidden')
            )
              setDetail(null);
          }
        },
      );
    },
    [request, params.noticeId, language],
  );
  useFocusEffect(
    useCallback(() => {
      load();
      const sub = AppState.addEventListener('change', state => {
        if (state === 'active') load(false);
      });
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') load(false);
      }, 60000);
      return () => {
        generation.current++;
        sub.remove();
        clearInterval(timer);
      };
    }, [load]),
  );
  useEffect(() => {
    if (!detail || !focused || detail.notice.isRead) return;
    let active = true;
    let pending = false;
    const mark = () => {
      if (AppState.currentState !== 'active' || pending) return;
      pending = true;
      request<void>({
        method: 'PUT',
        path: `/api/v1/notices/${
          detail.notice.id
        }/read?platform=${noticePlatform()}`,
        body: { readVersion: detail.notice.readVersion },
      }).then(
        () => {
          if (active) {
            setReadError(false);
            noticeReadChanged();
          }
        },
        () => {
          if (active) {
            pending = false;
            setReadError(true);
          }
        },
      );
    };
    mark();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') mark();
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, [detail, request, focused]);
  const open = (url: string) => {
    const safe = safeNoticeUrl(url);
    if (safe) Linking.openURL(safe).catch(() => undefined);
  };
  return (
    <StackScreenSafeArea style={styles.safe}>
      {!detail ? (
        error ? (
          <LoadFailureState
            error={error}
            onRetry={() => {
              load();
            }}
          />
        ) : (
          <ActivityIndicator />
        )
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>{detail.notice.title}</Text>
          <Text style={styles.secondary}>
            {new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(
              new Date(detail.notice.publishedAtUtc),
            )}
            {detail.notice.isImportant ? ` · ${t('notices.important')}` : ''}
          </Text>
          {noticeBlocks(detail.body).map((block, i) => (
            <Text key={i} style={styles.body}>
              {block.kind === 'bullet'
                ? '• '
                : block.kind === 'number'
                ? `${block.marker}. `
                : null}
              {block.runs.map((run, j) =>
                run.href ? (
                  <Text
                    key={j}
                    accessibilityRole="link"
                    style={styles.link}
                    onPress={() => open(run.href!)}
                  >
                    {run.text}
                  </Text>
                ) : (
                  <Text key={j}>{run.text}</Text>
                ),
              )}
            </Text>
          ))}
          {detail.officialUrl && safeNoticeUrl(detail.officialUrl) ? (
            <Pressable
              accessibilityRole="link"
              style={styles.action}
              onPress={() => open(detail.officialUrl!)}
            >
              <Text style={styles.link}>{t('notices.officialLink')}</Text>
            </Pressable>
          ) : null}
          {error ? (
            <LoadFailureState
              error={error}
              onRetry={() => {
                load();
              }}
            />
          ) : null}
          {readError ? (
            <>
              <Text accessibilityRole="alert" style={styles.secondary}>
                {t('notices.readFailed')}
              </Text>
              <Pressable
                style={styles.action}
                accessibilityRole="button"
                onPress={() => {
                  load();
                }}
              >
                <Text style={styles.link}>{t('auth.retry')}</Text>
              </Pressable>
            </>
          ) : null}
        </ScrollView>
      )}
    </StackScreenSafeArea>
  );
}
const styles = themedStyles(() => ({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 23, fontWeight: '700', color: colors.textPrimary },
  secondary: { fontSize: 13, color: colors.textSecondary },
  body: { fontSize: 16, lineHeight: 26, color: colors.textPrimary },
  link: { color: colors.brand, textDecorationLine: 'underline' },
  action: { minHeight: minTouchTarget, justifyContent: 'center' },
}));
