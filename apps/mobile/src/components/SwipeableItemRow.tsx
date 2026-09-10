import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { ShareIcon } from '../icons/ShareIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { colors, minTouchTarget, spacing } from '../theme/tokens';
import { closeOpenRow, notifyRowClosed, notifyRowOpened } from './swipeableRowCoordinator';

const ACTION_WIDTH = 76;
const OPEN_THRESHOLD = ACTION_WIDTH / 2;
/** Below this horizontal movement, a touch is treated as a tap/vertical scroll, not a swipe. */
const HORIZONTAL_INTENT_THRESHOLD = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface SwipeableItemRowProps {
  /** Row content - unchanged tap-to-navigate behavior, always enabled regardless of `disabled`. */
  readonly children: ReactNode;
  readonly onPress: () => void;
  /** Reveals a compact 삭제 action on the right when the row is swiped left. */
  readonly onDelete: () => void;
  /** Reveals a compact 공유 action on the left when the row is swiped right. */
  readonly onShare: () => void;
  /** Disables opening/using the swipe actions (e.g. another row's action is in flight) - navigation stays enabled. */
  readonly disabled?: boolean;
  /**
   * Extra styling for the outer row container - e.g. a screen's own card radius/border/margin
   * (see DailyInboxScreen/DateHistoryScreen). Merged after the base wrapper style, so it can add
   * to but should not fight the `overflow: 'hidden'` this component relies on for clipping the
   * swipe-revealed actions to the card's own shape (rounded corners included).
   */
  readonly containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Reusable swipe-to-reveal row for Home and History (see DailyInboxScreen/DateHistoryScreen) -
 * replaces the old `⋮` -> RowActionSheet bottom sheet. Built on React Native's own
 * Animated + PanResponder (no gesture-handler/Reanimated in this project - see package.json - and
 * this doesn't need either). Only one row across a whole list stays open at a time; a list should
 * call closeOpenRow() from swipeableRowCoordinator on scroll start (see its own screen).
 */
export function SwipeableItemRow({
  children,
  onPress,
  onDelete,
  onShare,
  disabled,
  containerStyle,
}: SwipeableItemRowProps) {
  const { t } = useTranslation();
  const translateX = useRef(new Animated.Value(0)).current;
  const openDirectionRef = useRef<'left' | 'right' | null>(null);
  const currentOffsetRef = useRef(0);

  useEffect(() => {
    const listenerId = translateX.addListener(({ value }) => {
      currentOffsetRef.current = value;
    });
    return () => translateX.removeListener(listenerId);
  }, [translateX]);

  const close = useCallback(() => {
    openDirectionRef.current = null;
    Animated.timing(translateX, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    notifyRowClosed(close);
  }, [translateX]);

  // Unregisters this row from the shared "one open row" coordinator if it unmounts while open
  // (e.g. the item was just deleted) - never leaves a stale close callback registered.
  useEffect(() => () => notifyRowClosed(close), [close]);

  const openTo = useCallback(
    (direction: 'left' | 'right') => {
      openDirectionRef.current = direction;
      const target = direction === 'left' ? -ACTION_WIDTH : ACTION_WIDTH;
      Animated.timing(translateX, { toValue: target, duration: 200, useNativeDriver: true }).start();
      notifyRowOpened(close);
    },
    [translateX, close],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !disabled &&
          Math.abs(gesture.dx) > HORIZONTAL_INTENT_THRESHOLD &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_event, gesture) => {
          const base =
            openDirectionRef.current === 'left'
              ? -ACTION_WIDTH
              : openDirectionRef.current === 'right'
                ? ACTION_WIDTH
                : 0;
          translateX.setValue(clamp(base + gesture.dx, -ACTION_WIDTH, ACTION_WIDTH));
        },
        onPanResponderRelease: () => {
          const offset = currentOffsetRef.current;
          if (offset <= -OPEN_THRESHOLD) {
            openTo('left');
          } else if (offset >= OPEN_THRESHOLD) {
            openTo('right');
          } else {
            close();
          }
        },
        onPanResponderTerminate: close,
      }),
    [disabled, translateX, openTo, close],
  );

  const handleContentPress = () => {
    if (openDirectionRef.current !== null) {
      // A tap while this row is open just closes it - it never also navigates.
      close();
      return;
    }
    closeOpenRow();
    onPress();
  };

  return (
    <View style={[styles.wrapper, containerStyle]}>
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <View style={[styles.actionSlot, styles.shareSlot]}>
          <Pressable
            accessibilityLabel={t('common.share')}
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => {
              close();
              onShare();
            }}
            style={[styles.actionButton, styles.shareAction]}
          >
            <ShareIcon color={colors.surface} size={18} />
            <Text style={styles.actionLabel}>{t('common.share')}</Text>
          </Pressable>
        </View>
        <View style={[styles.actionSlot, styles.deleteSlot]}>
          <Pressable
            accessibilityLabel={t('common.delete')}
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => {
              close();
              onDelete();
            }}
            style={[styles.actionButton, styles.deleteAction]}
          >
            <TrashIcon color={colors.surface} size={18} />
            <Text style={styles.actionLabel}>{t('common.delete')}</Text>
          </Pressable>
        </View>
      </View>
      <Animated.View
        accessibilityActions={[
          { name: 'delete', label: t('common.delete') },
          { name: 'share', label: t('common.share') },
        ]}
        onAccessibilityAction={event => {
          if (event.nativeEvent.actionName === 'delete') {
            onDelete();
          } else if (event.nativeEvent.actionName === 'share') {
            onShare();
          }
        }}
        style={[styles.content, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <Pressable accessibilityRole="button" onPress={handleContentPress} style={styles.contentPressable}>
          {children}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    overflow: 'hidden',
  },
  content: {
    backgroundColor: colors.surface,
  },
  // Deliberately no flexDirection here - contentPressable has exactly one child (the screen's own
  // row content, e.g. InboxRow/HistoryRow), which needs the full row width to lay itself out.
  // `flexDirection: 'row'` previously here made that single child size to its own content instead
  // of stretching to fill the row (row-direction's default main-axis sizing is content-based, not
  // stretch) - the child's own flex:1 text column then had no real width to grow into, collapsing
  // every row's title/URL/memo to an invisible sliver. Plain default column layout gives the
  // single child the full width via Yoga's normal cross-axis stretch instead.
  contentPressable: {},
  actionSlot: {
    bottom: 0,
    position: 'absolute',
    top: 0,
    width: ACTION_WIDTH,
  },
  shareSlot: {
    left: 0,
  },
  deleteSlot: {
    right: 0,
  },
  actionButton: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: minTouchTarget,
  },
  shareAction: {
    backgroundColor: colors.brand,
  },
  deleteAction: {
    backgroundColor: colors.danger,
  },
  actionLabel: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: '600',
  },
});
