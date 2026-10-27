import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Pressable } from '../components/Pressable';
import { BellIcon } from '../icons/BellIcon';
import { colors, minTouchTarget, themedStyles } from '../theme/tokens';
import { useUnreadNotificationCount } from './notificationState';

/** The dot's diameter, and where it sits: on the bell's upper end corner (the 24pt glyph is centred in the 44pt button). */
const DOT_SIZE = 8;
const GLYPH_SIZE = 24;
const DOT_INSET = (minTouchTarget - GLYPH_SIZE) / 2 + 1;

/**
 * The way into 알림 (Home's top end): a bell - not a heart, which in Juple means a reaction. Unread notifications are shown the
 * way Instagram does it: a small red dot on the bell's upper end corner, no number (any unread at all = the dot; none = nothing).
 * The accessibility label still says the full count, so the number is never lost for screen-reader users. The Collections tab's own
 * count badge is a different thing and keeps its number.
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
      <BellIcon color={colors.textPrimary} size={GLYPH_SIZE} />
      {unread > 0 ? <View pointerEvents="none" style={styles.dot} testID="notification-bell-dot" /> : null}
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  button: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
  dot: {
    backgroundColor: colors.badge,
    borderRadius: DOT_SIZE / 2,
    end: DOT_INSET,
    height: DOT_SIZE,
    position: 'absolute',
    top: DOT_INSET,
    width: DOT_SIZE,
  },
}));
