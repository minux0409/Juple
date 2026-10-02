import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';
import { CountBadge } from '../components/CountBadge';
import { BellIcon } from '../icons/BellIcon';
import { colors, minTouchTarget } from '../theme/tokens';
import { useUnreadNotificationCount } from './notificationState';

/**
 * The way into 알림 (Home's top end): a bell - not a heart, which in Juple means a reaction - with the
 * unread total as a number (1-99, "99+"), never only a dot. The accessibility label says the full count.
 */
export function NotificationBellButton({ onPress }: { readonly onPress: () => void }) {
  const { t } = useTranslation();
  const unread = useUnreadNotificationCount() ?? 0;
  return (
    <Pressable
      accessibilityLabel={unread > 0 ? t('notifications.bellUnreadA11y', { count: unread }) : t('notifications.bellA11y')}
      accessibilityRole="button"
      hitSlop={4}
      onPress={onPress}
      style={styles.button}
      testID="notification-bell"
    >
      <BellIcon color={colors.textPrimary} size={24} />
      <CountBadge count={unread} style={styles.badge} testID="notification-bell-badge" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
  badge: { end: 0, position: 'absolute', top: 2 },
});
