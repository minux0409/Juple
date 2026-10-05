import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { ImportantState } from '../components/ImportantState';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { SwipeableItemRow } from '../components/SwipeableItemRow';
import { closeOpenRow } from '../components/swipeableRowCoordinator';
import { UserAvatar } from '../components/UserAvatar';
import { CategoryIconTile } from '../collections/CategoryIconTile';
import { BellIcon } from '../icons/BellIcon';
import type { RootStackParamList } from '../navigation/RootStack';
import type { AppNotification } from '../notifications/notificationsApi';
import { formatNotificationExactTime, formatNotificationTime, groupNotifications, type NotificationGroupKey } from '../notifications/notificationGroups';
import { useUnreadNotificationCount } from '../notifications/notificationState';
import { parseNotificationTarget } from '../notifications/notificationTarget';
import { NotificationTypeIcon } from '../notifications/NotificationTypeIcon';
import { openNotification } from '../notifications/openNotification';
import { useNotificationInbox } from '../notifications/useNotificationInbox';
import { useLiveRefresh } from '../push/useLiveRefresh';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'Notifications'>;

/** The visible Push types - a new one arriving while this screen is open refreshes its first page. */
const INBOX_PUSH_TYPES = [
  'friendRequest',
  'friendRequestAccepted',
  'friendRequestRejected',
  'collectionInvitation',
  'collectionItemsAdded',
  'collectionLinkShared',
  'collectionItemReaction',
  'collectionItemComment',
  'collectionLinkSubmission',
  'collectionLinkSubmissionApproved',
  'collectionLinkSubmissionRejected',
  // A requester cancelling a proposal deletes the Owner's approval-request row; the refresh signal for the Collection re-reads the Inbox.
  'collectionContentChanged',
] as const;

const GROUP_LABEL_KEYS: Record<NotificationGroupKey, string> = {
  today: 'notifications.groupToday',
  yesterday: 'notifications.groupYesterday',
  last7Days: 'notifications.groupLast7Days',
  last30Days: 'notifications.groupLast30Days',
  older: 'notifications.groupOlder',
};

const THUMBNAIL_SIZE = 48;
const AVATAR_SIZE = 44;

/** Types whose right side shows the thumbnail of my own link they are about. */
const PREVIEW_TYPES: ReadonlySet<string> = new Set([
  'collectionItemReaction',
  'collectionItemComment',
  'collectionLinkSubmissionApproved',
  'collectionLinkSubmissionRejected',
]);

/**
 * 알림: the signed-in user's notifications grouped by when they arrived (오늘 / 어제 / 최근 7일 /
 * 최근 30일 / 이전 알림, by the device's local calendar), newest first - the same sentences the Push
 * used. A tap marks the row read (at once on screen and on the bell), then opens it through the one
 * shared path (openNotification); a left swipe reveals a delete icon (swiping alone never deletes).
 * A failed load is a centered state with a retry. 모두 읽음 is offered only while something is unread.
 */
export function NotificationsScreen({ navigation }: Props) {
  const { t, i18n } = useTranslation();
  const request = useAuthenticatedApi();
  const unreadCount = useUnreadNotificationCount();
  const { state, reload, loadMore, markRowRead, markAllRead, removeRow } = useNotificationInbox(request, i18n.language);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const canMarkAllRead = state.status === 'ready' && ((unreadCount ?? 0) > 0 || state.hasUnread);
  const sections = useMemo(
    () => groupNotifications(state.items).map(group => ({ key: group.key, title: t(GROUP_LABEL_KEYS[group.key]), data: group.items })),
    [state.items, t],
  );

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

  const deleteRow = (row: AppNotification) => {
    setDeleteFailed(false);
    removeRow(row.id)
      .then(ok => setDeleteFailed(!ok))
      .catch(() => setDeleteFailed(true));
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
        <ImportantState
          message={t('notifications.loadError')}
          onRetry={() => reload('initial')}
          retryLabel={t('notifications.retry')}
          testID="notifications-error"
          title={t('notifications.loadErrorTitle')}
        />
      </StackScreenSafeArea>
    );
  }

  return (
    <StackScreenSafeArea style={styles.screen}>
      {deleteFailed ? <Text accessibilityLiveRegion="polite" style={styles.banner} testID="notifications-delete-error">{t('notifications.deleteFailed')}</Text> : null}
      <SectionList
        contentContainerStyle={state.items.length === 0 ? styles.emptyContent : styles.content}
        keyExtractor={row => row.id.toString()}
        ListEmptyComponent={<ImportantState icon={BellIcon} message={t('notifications.empty')} testID="notifications-empty" variant="empty" />}
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
        onScrollBeginDrag={closeOpenRow}
        refreshControl={<RefreshControl onRefresh={() => reload('refresh')} refreshing={state.isRefreshing} />}
        renderItem={({ item }) => <NotificationRow notification={item} onDelete={() => deleteRow(item)} onPress={() => openRow(item)} />}
        renderSectionHeader={({ section }) => (
          <Text accessibilityRole="header" style={styles.sectionHeader} testID={`notifications-group-${section.key}`}>{section.title}</Text>
        )}
        sections={sections}
        stickySectionHeadersEnabled={false}
      />
    </StackScreenSafeArea>
  );
}

function NotificationLeading({ notification }: { readonly notification: AppNotification }) {
  if (notification.type === 'collectionLinkSubmission') {
    // An approval request received: the Collection (its photo, else the folder), never who proposed.
    return (
      <CategoryIconTile
        collectionId={notification.target.collectionId ?? notification.id}
        icon="folder"
        imageUrl={notification.collectionImageUrl}
        imageVersion={notification.collectionImageVersion}
        size={AVATAR_SIZE}
      />
    );
  }
  if (notification.actor) {
    return (
      <UserAvatar
        displayName={notification.actor.displayName}
        imageUrl={notification.actor.profileImageUrl}
        imageVersion={notification.actor.profileImageVersion}
        jupleId={notification.actor.jupleId}
        size={AVATAR_SIZE}
      />
    );
  }
  return <NotificationTypeIcon size={AVATAR_SIZE} type={notification.type} />;
}

function NotificationRow({ notification, onPress, onDelete }: {
  readonly notification: AppNotification;
  readonly onPress: () => void;
  readonly onDelete: () => void;
}) {
  const { t } = useTranslation();
  const isUnread = notification.readAtUtc === null;
  const text = notification.body ?? t('notifications.unavailable');
  const time = formatNotificationTime(notification.createdAtUtc, t);
  const accessibilityLabel = [
    isUnread ? t('notifications.unreadA11y') : null,
    text,
    notification.collectionName,
    formatNotificationExactTime(notification.createdAtUtc),
  ].filter(Boolean).join(', ');
  const previewUrl = PREVIEW_TYPES.has(notification.type) ? notification.previewImageUrl : null;

  return (
    <SwipeableItemRow
      accessibilityLabel={accessibilityLabel}
      deleteLabel={t('notifications.deleteA11y')}
      deleteTestID={`notification-delete-${notification.id}`}
      onDelete={onDelete}
      onPress={onPress}
      testID={`notification-row-${notification.id}`}
    >
      <View style={[styles.row, isUnread && styles.rowUnread]}>
        <NotificationLeading notification={notification} />
        <View style={styles.rowText}>
          <Text style={[styles.body, isUnread && styles.bodyUnread]}>{text}</Text>
          <Text numberOfLines={1} style={styles.meta}>
            {notification.collectionName ? `${time} · ${notification.collectionName}` : time}
          </Text>
        </View>
        {previewUrl ? <Image accessibilityIgnoresInvertColors source={{ uri: previewUrl }} style={styles.thumbnail} testID={`notification-preview-${notification.id}`} /> : null}
        {isUnread ? <View style={styles.unreadDot} testID={`notification-unread-${notification.id}`} /> : null}
      </View>
    </SwipeableItemRow>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  centered: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl },
  content: { paddingBottom: spacing.lg },
  emptyContent: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  retry: { alignItems: 'center', justifyContent: 'center', marginTop: spacing.md, minHeight: minTouchTarget, paddingHorizontal: spacing.lg },
  retryText: { color: colors.brand, fontSize: 15, fontWeight: '600' },
  footer: { marginVertical: spacing.md },
  banner: { backgroundColor: colors.brandSoft, color: colors.danger, fontSize: 13, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, textAlign: 'center' },
  headerAction: { justifyContent: 'center', maxWidth: 160, minHeight: minTouchTarget, paddingHorizontal: spacing.xs },
  headerActionText: { color: colors.brand, fontSize: 15, fontWeight: '600' },
  sectionHeader: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', paddingBottom: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
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
  rowText: { flex: 1, minWidth: 0 },
  body: { color: colors.textPrimary, fontSize: 15, lineHeight: 21 },
  bodyUnread: { fontWeight: '600' },
  meta: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  thumbnail: { backgroundColor: colors.brandSoft, borderRadius: radii.md, height: THUMBNAIL_SIZE, width: THUMBNAIL_SIZE },
  unreadDot: { backgroundColor: colors.brand, borderRadius: 4, height: 8, width: 8 },
});
