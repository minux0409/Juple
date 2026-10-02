import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { formatCommentTime } from '../comments/formatCommentTime';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { UserAvatar } from '../components/UserAvatar';
import type { RootStackParamList } from '../navigation/RootStack';
import type { AppNotification } from '../notifications/notificationsApi';
import { useUnreadNotificationCount } from '../notifications/notificationState';
import { parseNotificationTarget } from '../notifications/notificationTarget';
import { NotificationTypeIcon } from '../notifications/NotificationTypeIcon';
import { openNotification } from '../notifications/openNotification';
import { useNotificationInbox } from '../notifications/useNotificationInbox';
import { useLiveRefresh } from '../push/useLiveRefresh';
import { colors, minTouchTarget, spacing } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'Notifications'>;

/** The visible Push types - a new one arriving while this screen is open refreshes its first page. */
const INBOX_PUSH_TYPES = [
  'friendRequest',
  'collectionInvitation',
  'collectionItemsAdded',
  'collectionLinkShared',
  'collectionItemReaction',
  'collectionItemComment',
  'collectionLinkSubmission',
  'collectionLinkSubmissionApproved',
  'collectionLinkSubmissionRejected',
] as const;

/**
 * 알림: the signed-in user's notifications, newest first - the same sentences the Push used. A tap
 * marks the row read (at once on screen and on the bell), then opens it through the one shared path
 * (openNotification) the OS Push and the banner use; a row whose target is gone says so in a generic
 * line and names nothing. 모두 읽음 is offered only while something is unread.
 */
export function NotificationsScreen({ navigation }: Props) {
  const { t, i18n } = useTranslation();
  const request = useAuthenticatedApi();
  const unreadCount = useUnreadNotificationCount();
  const { state, reload, loadMore, markRowRead, markAllRead } = useNotificationInbox(request, i18n.language);
  const canMarkAllRead = state.status === 'ready' && ((unreadCount ?? 0) > 0 || state.hasUnread);

  useFocusEffect(
    useCallback(() => {
      reload('refresh').catch(() => undefined);
    }, [reload]),
  );
  useLiveRefresh(() => {
    reload('refresh').catch(() => undefined);
  }, INBOX_PUSH_TYPES);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: canMarkAllRead
        ? () => (
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => {
                markAllRead().catch(() => undefined);
              }}
              style={styles.headerAction}
              testID="notifications-mark-all-read"
            >
              <Text numberOfLines={1} style={styles.headerActionText}>{t('notifications.markAllRead')}</Text>
            </Pressable>
          )
        : undefined,
    });
  }, [canMarkAllRead, markAllRead, navigation, t]);

  const openRow = (row: AppNotification) => {
    const knownUnread = row.readAtUtc === null;
    markRowRead(row.id);
    openNotification(
      { notificationId: row.id, target: parseNotificationTarget(row.target), knownUnread },
      { request, locale: i18n.language },
    ).catch(() => undefined);
  };

  if (state.status === 'loading' && state.items.length === 0) {
    return (
      <StackScreenSafeArea style={styles.centered}>
        <ActivityIndicator testID="notifications-loading" />
      </StackScreenSafeArea>
    );
  }

  if (state.status === 'error') {
    return (
      <StackScreenSafeArea style={styles.centered}>
        <Text style={styles.message}>{t('notifications.loadError')}</Text>
        <Pressable accessibilityRole="button" onPress={() => reload('initial')} style={styles.retry} testID="notifications-retry">
          <Text style={styles.retryText}>{t('notifications.retry')}</Text>
        </Pressable>
      </StackScreenSafeArea>
    );
  }

  return (
    <StackScreenSafeArea style={styles.screen}>
      <FlatList
        contentContainerStyle={state.items.length === 0 ? styles.emptyContent : styles.content}
        data={state.items}
        keyExtractor={row => row.id.toString()}
        ListEmptyComponent={<Text style={styles.message} testID="notifications-empty">{t('notifications.empty')}</Text>}
        ListFooterComponent={
          state.isLoadingMore ? (
            <ActivityIndicator style={styles.footer} testID="notifications-loading-more" />
          ) : state.loadMoreFailed ? (
            <Pressable accessibilityRole="button" onPress={() => loadMore()} style={[styles.retry, styles.footer]} testID="notifications-load-more-retry">
              <Text style={styles.retryText}>{t('notifications.retry')}</Text>
            </Pressable>
          ) : undefined
        }
        onEndReached={() => {
          if (state.hasMore && !state.loadMoreFailed) {
            loadMore().catch(() => undefined);
          }
        }}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl onRefresh={() => reload('refresh')} refreshing={state.isRefreshing} />}
        renderItem={({ item }) => <NotificationRow notification={item} onPress={() => openRow(item)} />}
      />
    </StackScreenSafeArea>
  );
}

function NotificationRow({ notification, onPress }: { readonly notification: AppNotification; readonly onPress: () => void }) {
  const { t } = useTranslation();
  const isUnread = notification.readAtUtc === null;
  const text = notification.body ?? t('notifications.unavailable');
  const time = formatCommentTime(notification.createdAtUtc, t);
  const accessibilityLabel = [isUnread ? t('notifications.unreadA11y') : null, text, notification.collectionName, time]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, isUnread && styles.rowUnread, pressed && styles.rowPressed]}
      testID={`notification-row-${notification.id}`}
    >
      {notification.actor ? (
        <UserAvatar
          displayName={notification.actor.displayName}
          imageUrl={notification.actor.profileImageUrl}
          imageVersion={notification.actor.profileImageVersion}
          jupleId={notification.actor.jupleId}
          size={40}
        />
      ) : (
        <NotificationTypeIcon type={notification.type} />
      )}
      <View style={styles.rowText}>
        <Text style={[styles.body, isUnread && styles.bodyUnread]}>{text}</Text>
        <Text numberOfLines={1} style={styles.meta}>
          {notification.collectionName ? `${time} · ${notification.collectionName}` : time}
        </Text>
      </View>
      {isUnread ? <View style={styles.unreadDot} testID={`notification-unread-${notification.id}`} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  centered: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl },
  content: { paddingVertical: spacing.sm },
  emptyContent: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  message: { color: colors.textSecondary, fontSize: 15, textAlign: 'center' },
  retry: { alignItems: 'center', justifyContent: 'center', marginTop: spacing.md, minHeight: minTouchTarget, paddingHorizontal: spacing.lg },
  retryText: { color: colors.brand, fontSize: 15, fontWeight: '600' },
  footer: { marginVertical: spacing.md },
  headerAction: { justifyContent: 'center', maxWidth: 160, minHeight: minTouchTarget, paddingHorizontal: spacing.xs },
  headerActionText: { color: colors.brand, fontSize: 15, fontWeight: '600' },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  // Subtle: a pale tint and a small dot - never a loud color; read rows stay fully legible.
  rowUnread: { backgroundColor: colors.brandSoft },
  rowPressed: { opacity: 0.7 },
  rowText: { flex: 1, minWidth: 0 },
  body: { color: colors.textPrimary, fontSize: 15, lineHeight: 21 },
  bodyUnread: { fontWeight: '600' },
  meta: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  unreadDot: { backgroundColor: colors.brand, borderRadius: 4, height: 8, width: 8 },
});
