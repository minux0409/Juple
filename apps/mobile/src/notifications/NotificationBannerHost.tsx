import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  Animated,
  PanResponder,
  type PanResponderCallbacks,
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
import { isHorizontalBannerDrag, resolveBannerSwipe, type BannerSwipeDirection } from './bannerGesture';
import { NotificationTypeIcon } from './NotificationTypeIcon';
import { openNotification, subscribeNotificationUnavailable } from './openNotification';

/** How long a banner stays before it slides away by itself. */
export const BANNER_VISIBLE_MS = 4000;
const SLIDE_MS = 220;
const MAX_BANNER_WIDTH = 480;

/** Where each animated axis ends for one way of leaving; null = that axis is left exactly where it is. */
export interface BannerExitPlan {
  /** Horizontal drag offset (dp). */
  readonly x: number | null;
  /** The slide-in/out progress (1 = shown, 0 = slid up out of the top) - only the timer / a tap use it. */
  readonly progress: number | null;
}

/**
 * The exits. A user's swipe keeps going the way it was thrown, sideways and on X only - it never
 * touches the vertical slide (`progress` maps to a translateY, which is what used to send a
 * horizontally thrown banner flying UP at the end). Only the timer / a tap slide the banner back up
 * through `progress`, as it came in.
 */
export function planBannerExit(direction: BannerSwipeDirection | undefined, screenWidth: number): BannerExitPlan {
  switch (direction) {
    case 'left':
      return { x: -screenWidth, progress: null };
    case 'right':
      return { x: screenWidth, progress: null };
    default:
      return { x: null, progress: 0 };
  }
}

export interface BannerPanCallbacks {
  /** The touch became a drag (beyond a tap's slop): the tap that would follow must be ignored. */
  readonly onDragStart: () => void;
  /** The finger's horizontal travel - the only thing that moves the banner while dragging. */
  readonly onDrag: (dx: number) => void;
  readonly onSwipe: (direction: BannerSwipeDirection) => void;
  readonly onDragCancel: () => void;
  /** A new touch began - a previous drag's tap suppression ends. */
  readonly onTouchStart: () => void;
}

/**
 * The banner's gesture arbitration. A touch that stays within a tap's slop is left to the Pressable
 * (tap -> open). Once it moves beyond it SIDEWAYS (more horizontal than vertical) the banner claims it
 * in the capture phase, so the Pressable gets a terminate (no press on release) and the drag alone
 * decides: a left/right swipe past the threshold dismisses (never opening), anything shorter springs
 * back to X = 0. A vertical or vertical-dominant movement is never claimed: the banner neither moves
 * nor dismisses.
 */
export function createBannerPanConfig(callbacks: BannerPanCallbacks): PanResponderCallbacks {
  return {
    onStartShouldSetPanResponderCapture: () => {
      callbacks.onTouchStart();
      return false;
    },
    onMoveShouldSetPanResponderCapture: (_event, gesture) => isHorizontalBannerDrag(gesture),
    onMoveShouldSetPanResponder: (_event, gesture) => isHorizontalBannerDrag(gesture),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => callbacks.onDragStart(),
    onPanResponderMove: (_event, gesture) => callbacks.onDrag(gesture.dx),
    onPanResponderRelease: (_event, gesture) => {
      const direction = resolveBannerSwipe(gesture);
      if (direction) {
        callbacks.onSwipe(direction);
      } else {
        callbacks.onDragCancel();
      }
    },
    onPanResponderTerminate: () => callbacks.onDragCancel(),
  };
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
  const dragX = useRef(new Animated.Value(0)).current;
  // Fades a swiped-away banner (1 = visible) independently of the slide-in progress.
  const swipeFade = useRef(new Animated.Value(1)).current;
  const wasDraggedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLeavingRef = useRef(false);
  const onDismissedRef = useRef(onDismissed);
  onDismissedRef.current = onDismissed;

  const leave = useCallback((direction?: BannerSwipeDirection) => {
    if (isLeavingRef.current) {
      return;
    }
    isLeavingRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    const plan = planBannerExit(direction, width);
    const animations: Animated.CompositeAnimation[] = [];
    if (plan.x !== null) {
      animations.push(Animated.timing(dragX, { duration: SLIDE_MS, toValue: plan.x, useNativeDriver: true }));
    }
    if (plan.progress !== null) {
      animations.push(Animated.timing(progress, { duration: SLIDE_MS, toValue: plan.progress, useNativeDriver: true }));
    }
    if (direction) {
      animations.push(Animated.timing(swipeFade, { duration: SLIDE_MS, toValue: 0, useNativeDriver: true }));
    }
    Animated.parallel(animations).start(() => onDismissedRef.current());
  }, [dragX, progress, swipeFade, width]);

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

  const springBack = () => {
    Animated.spring(dragX, { toValue: 0, useNativeDriver: true }).start();
    startTimer();
  };
  const panResponder = useRef(
    PanResponder.create(
      createBannerPanConfig({
        onTouchStart: () => {
          wasDraggedRef.current = false;
        },
        onDragStart: () => {
          wasDraggedRef.current = true;
          if (timerRef.current) {
            clearTimeout(timerRef.current);
          }
        },
        // Only the horizontal travel follows the finger; the banner never moves vertically.
        onDrag: dx => dragX.setValue(dx),
        onSwipe: direction => leave(direction),
        onDragCancel: springBack,
      }),
    ),
  ).current;

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-(insets.top + 120), 0] });

  return (
    <View pointerEvents="box-none" style={[styles.layer, { top: insets.top + spacing.sm }]}>
      <Animated.View
        {...panResponder.panHandlers}
        style={[styles.card, { maxWidth: Math.min(MAX_BANNER_WIDTH, width - spacing.lg * 2), opacity: Animated.multiply(progress, swipeFade), transform: [{ translateX: dragX }, { translateY }] }]}
        testID="notification-banner"
      >
        <Pressable
          accessibilityHint={t('notifications.bannerHint')}
          accessibilityLabel={t('notifications.bannerAnnouncement', { title: banner.title, body: banner.body })}
          accessibilityRole="button"
          onPress={() => {
            // A release that ended a drag is never a tap.
            if (wasDraggedRef.current) {
              return;
            }
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
