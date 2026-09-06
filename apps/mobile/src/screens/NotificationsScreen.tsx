import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import i18n from '../i18n';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import {
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from '../notifications/api/notificationsApi';
import { useNotificationBadge } from '../notifications/NotificationBadgeContext';
import { useNotifications } from '../notifications/useNotifications';
import type { RootStackParamList } from '../navigation/RootStack';
import { formatDateOnlyForDisplay } from '../purchases/dateOnly';

function formatCreatedTime(createdAtUtc: string): string {
  return new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(createdAtUtc));
}

function getActionErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('notifications.errorActionFallback');
}

/**
 * The Notification Center - currently only RepeatPurchaseDue notifications (see Notification's
 * `type`). Tapping a row marks it read and, when it has a repeatPurchaseId (true for every
 * notification today), opens that RepeatPurchase's own details screen - the same screen ItemDetails
 * itself links to, so there is exactly one place "구매 완료" lives.
 */
export function NotificationsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const authenticatedRequest = useAuthenticatedApi();
  const { refresh: refreshBadge } = useNotificationBadge();
  const {
    notifications,
    isLoading,
    isRefreshing,
    isLoadingMore,
    error,
    refresh,
    loadMore,
    markReadLocally,
    markAllReadLocally,
  } = useNotifications();

  // The list load below already materializes newly-due notifications server-side (see
  // NotificationsController) - this keeps the bell badge in sync with whatever that just surfaced,
  // rather than only updating it after a read/read-all action taken from inside this screen.
  useFocusEffect(
    useCallback(() => {
      refreshBadge();
    }, [refreshBadge]),
  );

  const [actionInFlightId, setActionInFlightId] = useState<number | null>(null);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const isActionBusyRef = useRef(false);

  const openNotification = async (notification: Notification) => {
    if (isActionBusyRef.current) {
      return;
    }

    if (notification.repeatPurchaseId !== null) {
      navigation.navigate('RepeatPurchaseDetails', { repeatPurchaseId: notification.repeatPurchaseId });
    }

    if (notification.isRead) {
      return;
    }

    isActionBusyRef.current = true;
    setActionInFlightId(notification.id);
    setActionError(null);
    try {
      await markNotificationRead(authenticatedRequest, notification.id);
      markReadLocally(notification.id);
      refreshBadge();
    } catch (caughtError) {
      setActionError(getActionErrorMessage(caughtError, t));
    } finally {
      isActionBusyRef.current = false;
      setActionInFlightId(null);
    }
  };

  const markAllRead = async () => {
    if (isActionBusyRef.current) {
      return;
    }

    isActionBusyRef.current = true;
    setIsMarkingAllRead(true);
    setActionError(null);
    try {
      await markAllNotificationsRead(authenticatedRequest);
      markAllReadLocally();
      refreshBadge();
    } catch (caughtError) {
      setActionError(getActionErrorMessage(caughtError, t));
    } finally {
      isActionBusyRef.current = false;
      setIsMarkingAllRead(false);
    }
  };

  const hasUnread = notifications.some(notification => !notification.isRead);

  if (isLoading && notifications.length === 0 && !error) {
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
        data={notifications}
        keyExtractor={notification => notification.id.toString()}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
        ListHeaderComponent={
          hasUnread ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isMarkingAllRead }}
              disabled={isMarkingAllRead}
              onPress={markAllRead}
              style={[styles.markAllReadButton, isMarkingAllRead && styles.disabledButton]}
            >
              <Text style={styles.markAllReadButtonLabel}>
                {isMarkingAllRead ? t('common.processing') : t('notifications.markAllRead')}
              </Text>
            </Pressable>
          ) : undefined
        }
        ListEmptyComponent={
          !isLoading && !error ? <Text style={styles.empty}>{t('notifications.empty')}</Text> : undefined
        }
        renderItem={({ item }) => (
          <NotificationRow
            isActionInFlight={actionInFlightId === item.id}
            notification={item}
            onPress={() => openNotification(item)}
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

interface NotificationRowProps {
  readonly notification: Notification;
  readonly isActionInFlight: boolean;
  readonly onPress: () => void;
}

function NotificationRow({ notification, isActionInFlight, onPress }: NotificationRowProps) {
  const { t } = useTranslation();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: isActionInFlight }}
      onPress={onPress}
      style={[styles.row, !notification.isRead && styles.unreadRow]}
    >
      {!notification.isRead ? <View style={styles.unreadDot} /> : <View style={styles.unreadDotPlaceholder} />}
      <View style={styles.rowTextColumn}>
        <Text numberOfLines={2} style={styles.productName}>
          {notification.productName ?? t('notifications.repeatPurchaseDueFallbackTitle')}
        </Text>
        {notification.dueDate ? (
          <Text style={styles.dueDate}>
            {t('notifications.repeatPurchaseDueMessage', {
              date: formatDateOnlyForDisplay(notification.dueDate),
            })}
          </Text>
        ) : null}
        <Text style={styles.createdTime}>{formatCreatedTime(notification.createdAtUtc)}</Text>
      </View>
    </Pressable>
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
  markAllReadButton: {
    alignSelf: 'flex-end',
    borderColor: '#111111',
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  markAllReadButtonLabel: {
    color: '#111111',
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
    alignItems: 'flex-start',
    borderTopColor: '#E0E0E0',
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingVertical: 14,
  },
  unreadRow: {
    backgroundColor: '#F5F8FF',
  },
  unreadDot: {
    backgroundColor: '#3366CC',
    borderRadius: 4,
    height: 8,
    marginEnd: 10,
    marginTop: 6,
    width: 8,
  },
  unreadDotPlaceholder: {
    marginEnd: 10,
    width: 8,
  },
  rowTextColumn: {
    flex: 1,
  },
  productName: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '600',
  },
  dueDate: {
    color: '#666666',
    fontSize: 13,
    marginTop: 3,
  },
  createdTime: {
    color: '#9A9A9A',
    fontSize: 12,
    marginTop: 5,
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
