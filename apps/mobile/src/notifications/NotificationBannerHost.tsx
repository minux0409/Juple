import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { cardShadow, colors, radii, spacing } from '../theme/tokens';
import { notificationBannerQueue, type BannerQueue, type NotificationBanner } from './bannerQueue';
import { NotificationTypeIcon } from './NotificationTypeIcon';
import { openNotification, subscribeNotificationUnavailable } from './openNotification';

/** How long a banner stays before it slides away by itself. */
export const BANNER_VISIBLE_MS = 4000;
const SLIDE_MS = 220;
/** An upward drag past this (or a quick flick) dismisses early. */
const SWIPE_DISMISS_DISTANCE = 24;
const MAX_BANNER_WIDTH = 480;

/** Whether a released drag dismisses the banner: far enough up, or a quick upward flick. */
export function isDismissSwipe(dy: number, vy: number): boolean {
  return dy < -SWIPE_DISMISS_DISTANCE || vy < -0.5;
}

/**
 * Mounted once above the navigator: the in-app banner for a Push that arrives while Juple is in the
 * foreground (the OS shows no notification of its own then - see usePushMessageHandling), and the
 * shared "this notification's content is no longer available" notice. One banner at a time, from the
 * TOP (safe-area aware), sliding down with a short fade; it leaves after BANNER_VISIBLE_MS, on an
 * upward swipe, or on a tap - which opens it through the same path as an OS Push tap. Merely showing
 * a banner never marks anything read.
 */
export function NotificationBannerHost({ queue = notificationBannerQueue }: { readonly queue?: BannerQueue }) {
  const { t, i18n } = useTranslation();
  const request = useAuthenticatedApi();
  const current = useSyncExternalStore(queue.subscribe, queue.current, queue.current);
  const [isUnavailableVisible, setIsUnavailableVisible] = useState(false);

  useEffect(() => subscribeNotificationUnavailable(() => setIsUnavailableVisible(true)), []);

  const handlePress = useCallback(
    (banner: NotificationBanner) => {
      openNotification(
        { notificationId: banner.notificationId, legacyData: banner.data },
        { request, locale: i18n.language },
      ).catch(() => undefined);
    },
    [i18n.language, request],
  );

  return (
    <>
      {current ? (
        <BannerCard
          banner={current}
          key={current.key}
          onDismissed={() => queue.dismissCurrent()}
          onPress={handlePress}
        />
      ) : null}
      <ConfirmDialog
        confirmLabel={t('common.confirm')}
        destructive={false}
        message={t('notifications.unavailable')}
        onConfirm={() => setIsUnavailableVisible(false)}
        title={t('common.notice')}
        visible={isUnavailableVisible}
      />
    </>
  );
}

function BannerCard({
  banner,
  onDismissed,
  onPress,
}: {
  readonly banner: NotificationBanner;
  readonly onDismissed: () => void;
  readonly onPress: (banner: NotificationBanner) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLeavingRef = useRef(false);
  const onDismissedRef = useRef(onDismissed);
  onDismissedRef.current = onDismissed;

  const leave = useCallback(() => {
    if (isLeavingRef.current) {
      return;
    }
    isLeavingRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    Animated.timing(progress, { duration: SLIDE_MS, toValue: 0, useNativeDriver: true }).start(() => onDismissedRef.current());
  }, [progress]);

  const startTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(leave, BANNER_VISIBLE_MS);
  }, [leave]);

  useEffect(() => {
    Animated.timing(progress, { duration: SLIDE_MS, toValue: 1, useNativeDriver: true }).start();
    startTimer();
    // Said once per banner - never repeated while it stays.
    AccessibilityInfo.announceForAccessibility(t('notifications.bannerAnnouncement', { title: banner.title, body: banner.body }));
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      // Only a vertical drag takes over - a plain tap stays the Pressable's.
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderGrant: () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
      },
      onPanResponderMove: (_event, gesture) => drag.setValue(Math.min(0, gesture.dy)),
      onPanResponderRelease: (_event, gesture) => {
        if (isDismissSwipe(gesture.dy, gesture.vy)) {
          leave();
          return;
        }
        Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
        startTimer();
      },
      onPanResponderTerminate: () => {
        Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
        startTimer();
      },
    }),
  ).current;

  const translateY = Animated.add(
    progress.interpolate({ inputRange: [0, 1], outputRange: [-(insets.top + 120), 0] }),
    drag,
  );

  return (
    <View pointerEvents="box-none" style={[styles.layer, { top: insets.top + spacing.sm }]}>
      <Animated.View
        {...panResponder.panHandlers}
        style={[styles.card, { maxWidth: Math.min(MAX_BANNER_WIDTH, width - spacing.lg * 2), opacity: progress, transform: [{ translateY }] }]}
        testID="notification-banner"
      >
        <Pressable
          accessibilityHint={t('notifications.bannerHint')}
          accessibilityLabel={t('notifications.bannerAnnouncement', { title: banner.title, body: banner.body })}
          accessibilityRole="button"
          onPress={() => {
            leave();
            onPress(banner);
          }}
          style={styles.pressable}
          testID="notification-banner-press"
        >
          <NotificationTypeIcon size={36} type={banner.type} />
          <View style={styles.text}>
            {banner.title ? <Text numberOfLines={1} style={styles.title}>{banner.title}</Text> : null}
            {banner.body ? <Text numberOfLines={2} style={styles.body}>{banner.body}</Text> : null}
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { alignItems: 'center', end: 0, paddingHorizontal: spacing.lg, position: 'absolute', start: 0, zIndex: 1000, elevation: 1000 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    width: '100%',
    ...cardShadow,
    elevation: 6,
    shadowOpacity: 0.12,
    shadowRadius: 10,
  },
  pressable: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: 56, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  text: { flex: 1, minWidth: 0 },
  title: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  body: { color: colors.textPrimary, fontSize: 14, marginTop: 2 },
});
