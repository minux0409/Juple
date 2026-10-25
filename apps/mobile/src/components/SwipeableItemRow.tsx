import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  PanResponder,
  Pressable,
  I18nManager,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { ShareIcon } from '../icons/ShareIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { colors, minTouchTarget, spacing, themedStyles } from '../theme/tokens';
import { closeOpenRow, notifyRowClosed, notifyRowOpened } from './swipeableRowCoordinator';

const ACTION_WIDTH = 76;
/** A compact row (a narrow Grid tile) reveals stacked icon + short-label actions in a slimmer pane, so they never eat most of the tile. */
const COMPACT_ACTION_WIDTH = 72;
/** Below this horizontal movement, a touch is treated as a tap/vertical scroll, not a swipe. */
const HORIZONTAL_INTENT_THRESHOLD = 8;
/** The icon on a revealed action: white on the brand / coral panels in both themes (the panel colours are the same in both). */
const ACTION_ICON_COLOR = '#FFFFFF';

type RevealedEdge = 'left' | 'right' | 'both' | null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface SwipeableStartAction {
  readonly label: string;
  /** @deprecated Swipe actions are icon-only everywhere; the accessibility label is `label`. */
  readonly shortLabel?: string;
  readonly icon: ComponentType<{ readonly color?: string; readonly size?: number }>;
  readonly onPress: () => void;
  /** Background of the revealed action (default: the brand blue 공유 uses). */
  readonly backgroundColor?: string;
  readonly testID?: string;
}

interface SwipeableItemRowProps {
  /** Row content - unchanged tap-to-navigate behavior, always enabled regardless of `disabled`. */
  readonly children: ReactNode;
  /**
   * The row's own tap. Omit it for a row whose content has nothing to open (a pending request card - its only
   * tap target is the icon inside): a tap then only closes an open row.
   */
  readonly onPress?: () => void;
  /**
   * False when the content holds controls of its own (an icon button): the content is then NOT one accessible
   * button, so those controls stay reachable for assistive technology. Default true (the whole row is one button).
   */
  readonly contentAccessible?: boolean;
  /**
   * A different action on the start side (revealed by swiping right) in place of 공유 - e.g. Trash's 복구. Same
   * gesture, same one-open-row rule; `onShare` is ignored when this is given. Revealing never runs it: only a tap
   * on the revealed action does.
   */
  readonly startAction?: SwipeableStartAction;
  /** @deprecated Every revealed action is icon-only now (accessibility labels stay); kept so callers need no change. */
  readonly deleteIconOnly?: boolean;
  /** Narrow tiles (Grid): a slimmer pane with the icon stacked over a short one-line label. */
  readonly compact?: boolean;
  /** testID of the revealed delete action. */
  readonly deleteTestID?: string;
  /**
   * Reveals a compact 삭제 action on the right when the row is swiped left. Omit it when the viewer
   * may not delete/remove this row (e.g. a Contributor in a shared Category, or another member's
   * link) - then there is no delete action at all and the row cannot be swiped left.
   */
  readonly onDelete?: () => void;
  /**
   * What the delete action says - defaults to 삭제. A Collection's own list passes 컬렉션에서 삭제,
   * since there it only takes the link out of that Collection (the saved link stays).
   */
  readonly deleteLabel?: string;
  /**
   * Reveals a compact 공유 action on the left when the row is swiped right. Omit it where a row has
   * nothing to share (e.g. a friend) - then there is no share action and the row only swipes left.
   */
  readonly onShare?: () => void;
  /** Disables opening/using the swipe actions (e.g. another row's action is in flight) - navigation stays enabled. */
  readonly disabled?: boolean;
  /**
   * Extra styling for the outer row container - e.g. a screen's own card radius/border/margin
   * (see DailyInboxScreen/DateHistoryScreen). Merged after the base wrapper style, so it can add
   * to but should not fight the `overflow: 'hidden'` this component relies on for clipping the
   * swipe-revealed actions to the card's own shape (rounded corners included).
   */
  readonly containerStyle?: StyleProp<ViewStyle>;
  /**
   * Optional long-press hook on this same row content (e.g. CollectionDetailsScreen opening its
   * explicit move-up/down menu) - deliberately just forwarded to the content Pressable rather than
   * given its own gesture handling, since React Native's Pressability already suppresses the
   * paired `onPress` for a release that followed a fired `onLongPress` (see Pressability.js's own
   * `isPressCanceledByLongPress`), so a long-press-then-release here never also navigates. Omit to
   * leave long-press unhandled, exactly like every other screen using this component today.
   */
  readonly onLongPress?: () => void;
  /**
   * 바로가기 for assistive technology: the row is one accessible button (its in-card icon button cannot take focus of its own), so the
   * saved original page is also offered as a screen-reader action, next to the row's other actions.
   */
  readonly onOpenOriginal?: () => void;
  /** testID of the content Pressable (the row's tap target). */
  readonly testID?: string;
  /** Overrides the content Pressable's own accessibility label - e.g. CollectionDetailsScreen's "Item N, long-press for options", which needs the row's position, not just its content. */
  readonly accessibilityLabel?: string;
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
  deleteLabel,
  compact = false,
  deleteTestID,
  contentAccessible = true,
  startAction,
  onShare,
  disabled,
  containerStyle,
  onLongPress,
  onOpenOriginal,
  accessibilityLabel,
  testID,
}: SwipeableItemRowProps) {
  const { t } = useTranslation();
  const deleteActionLabel = deleteLabel ?? t('common.delete');
  const [rowWidth, setRowWidth] = useState(0);
  // One revealed action takes its fixed pane width but never more than half the row, so a very narrow tile still keeps its content.
  const preferredWidth = compact ? COMPACT_ACTION_WIDTH : ACTION_WIDTH;
  const actionWidth = rowWidth > 0 ? Math.min(preferredWidth, Math.floor(rowWidth / 2)) : preferredWidth;
  const openThreshold = actionWidth / 2;
  const hasStartSide = onShare !== undefined || startAction !== undefined;
  const translateX = useRef(new Animated.Value(0)).current;
  const openDirectionRef = useRef<'left' | 'right' | null>(null);
  const currentOffsetRef = useRef(0);
  // The share/delete action backgrounds only ever need to exist while the row is open or actively
  // being dragged - mounted here (not just visually covered) rather than always-rendered behind the
  // content, so there is never a frame where a real-device rounding/registration gap between the
  // content's clipped edge and these absolutely-positioned colored panels can leave a sliver of
  // "빨강/파랑" visible at rest (the exact real-device report this guards against - especially
  // visible on the narrower Grid card width, where ACTION_WIDTH is a much larger fraction of the
  // card). Sits alongside (does not replace) translateX, which stays native-driven for smooth drag.
  // Which PHYSICAL edge is being uncovered ('left' while the content is dragged right, 'right' while dragged left; 'both' only for a
  // grant that carries no direction yet, narrowed by the first move). Only the pane on that
  // edge is mounted, so the other action's colour can never show through while one action is open or being dragged.
  const [revealedEdge, setRevealedEdge] = useState<RevealedEdge>(null);
  const revealedEdgeRef = useRef<RevealedEdge>(null);
  const showEdge = useCallback((edge: RevealedEdge) => {
    if (revealedEdgeRef.current !== edge) {
      revealedEdgeRef.current = edge;
      setRevealedEdge(edge);
    }
  }, []);

  useEffect(() => {
    const listenerId = translateX.addListener(({ value }) => {
      currentOffsetRef.current = value;
    });
    return () => translateX.removeListener(listenerId);
  }, [translateX]);

  const close = useCallback(() => {
    openDirectionRef.current = null;
    Animated.timing(translateX, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      showEdge(null);
    });
    notifyRowClosed(close);
  }, [translateX, showEdge]);

  // Unregisters this row from the shared "one open row" coordinator if it unmounts while open
  // (e.g. the item was just deleted) - never leaves a stale close callback registered.
  useEffect(() => () => notifyRowClosed(close), [close]);

  const openTo = useCallback(
    (direction: 'left' | 'right') => {
      openDirectionRef.current = direction;
      const target = direction === 'left' ? -actionWidth : actionWidth;
      Animated.timing(translateX, { toValue: target, duration: 200, useNativeDriver: true }).start();
      notifyRowOpened(close);
    },
    [translateX, close, actionWidth],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !disabled &&
          Math.abs(gesture.dx) > HORIZONTAL_INTENT_THRESHOLD &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: (_event, gesture) => {
          if (openDirectionRef.current !== null) {
            showEdge(openDirectionRef.current === 'right' ? 'left' : 'right');
          } else {
            showEdge(gesture.dx > 0 ? 'left' : gesture.dx < 0 ? 'right' : 'both');
          }
        },
        onPanResponderMove: (_event, gesture) => {
          const base =
            openDirectionRef.current === 'left'
              ? -actionWidth
              : openDirectionRef.current === 'right'
                ? actionWidth
                : 0;
          const next = clamp(base + gesture.dx, onDelete ? -actionWidth : 0, hasStartSide ? actionWidth : 0);
          translateX.setValue(next);
          showEdge(next > 0 ? 'left' : next < 0 ? 'right' : revealedEdgeRef.current);
        },
        onPanResponderRelease: () => {
          const offset = currentOffsetRef.current;
          if (onDelete && offset <= -openThreshold) {
            openTo('left');
          } else if (hasStartSide && offset >= openThreshold) {
            openTo('right');
          } else {
            close();
          }
        },
        onPanResponderTerminate: close,
      }),
    [disabled, translateX, openTo, close, onDelete, hasStartSide, actionWidth, openThreshold, showEdge],
  );

  const handleContentPress = () => {
    if (openDirectionRef.current !== null) {
      // A tap while this row is open just closes it - it never also navigates.
      close();
      return;
    }
    closeOpenRow();
    onPress?.();
  };

  // The start pane sits on the physical left in LTR and on the right in RTL (logical `start`), the delete pane on the other edge.
  const startEdge = I18nManager.isRTL ? 'right' : 'left';
  const showStartPane = revealedEdge === 'both' || revealedEdge === startEdge;
  const showDeletePane = revealedEdge === 'both' || (revealedEdge !== null && revealedEdge !== startEdge);
  const onRowLayout = (event: LayoutChangeEvent) => setRowWidth(Math.round(event.nativeEvent.layout.width));

  return (
    <View onLayout={onRowLayout} style={[styles.wrapper, containerStyle]}>
      {revealedEdge !== null ? (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          {showStartPane && startAction ? (
          <View style={[styles.actionSlot, styles.shareSlot, { width: actionWidth }]}>
            <Pressable
              accessibilityLabel={startAction.label}
              accessibilityRole="button"
              disabled={disabled}
              onPress={() => {
                close();
                startAction.onPress();
              }}
              style={[styles.actionButton, styles.shareAction, startAction.backgroundColor ? { backgroundColor: startAction.backgroundColor } : null]}
              testID={startAction.testID}
            >
              <startAction.icon color={ACTION_ICON_COLOR} size={22} />
            </Pressable>
          </View>
          ) : showStartPane && onShare ? (
          <View style={[styles.actionSlot, styles.shareSlot, { width: actionWidth }]}>
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
              <ShareIcon color={ACTION_ICON_COLOR} size={22} />
            </Pressable>
          </View>
          ) : null}
          {showDeletePane && onDelete ? (
          <View style={[styles.actionSlot, styles.deleteSlot, { width: actionWidth }]}>
            <Pressable
              accessibilityLabel={deleteActionLabel}
              accessibilityRole="button"
              disabled={disabled}
              onPress={() => {
                close();
                onDelete();
              }}
              style={[styles.actionButton, styles.deleteAction]}
              testID={deleteTestID}
            >
              <TrashIcon color={ACTION_ICON_COLOR} size={22} />
            </Pressable>
          </View>
          ) : null}
        </View>
      ) : null}
      <Animated.View
        accessibilityActions={[
          ...(onDelete ? [{ name: 'delete', label: deleteActionLabel }] : []),
          ...(startAction ? [{ name: 'start', label: startAction.label }] : onShare ? [{ name: 'share', label: t('common.share') }] : []),
          // The long-press menu is also an accessibility action, so it never depends on discovering a gesture.
          ...(onOpenOriginal ? [{ name: 'openOriginal', label: t('item.goToUrlA11y') }] : []),
          ...(onLongPress ? [{ name: 'options', label: t('collections.linkActionsA11y') }] : []),
        ]}
        onAccessibilityAction={event => {
          if (event.nativeEvent.actionName === 'delete') {
            onDelete?.();
          } else if (event.nativeEvent.actionName === 'start') {
            startAction?.onPress();
          } else if (event.nativeEvent.actionName === 'share') {
            onShare?.();
          } else if (event.nativeEvent.actionName === 'openOriginal') {
            onOpenOriginal?.();
          } else if (event.nativeEvent.actionName === 'options') {
            onLongPress?.();
          }
        }}
        style={[styles.content, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <Pressable
          accessibilityLabel={accessibilityLabel}
          accessibilityRole={contentAccessible ? 'button' : undefined}
          accessible={contentAccessible}
          delayLongPress={350}
          onLongPress={onLongPress}
          onPress={handleContentPress}
          style={styles.contentPressable}
          testID={testID}
        >
          {children}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = themedStyles(() => ({
  wrapper: {
    overflow: 'hidden',
  },
  // flexGrow: when a parent stretches the wrapper (e.g. a Grid cell sharing a row with a taller
  // neighbor), the opaque content must fill it too - otherwise the uncovered strip below the content
  // is exactly where a revealed action pane shows through as a colored band.
  content: {
    backgroundColor: colors.surface,
    flexGrow: 1,
  },
  // Deliberately no flexDirection here - contentPressable has exactly one child (the screen's own
  // row content, e.g. InboxRow/HistoryRow), which needs the full row width to lay itself out.
  // `flexDirection: 'row'` previously here made that single child size to its own content instead
  // of stretching to fill the row (row-direction's default main-axis sizing is content-based, not
  // stretch) - the child's own flex:1 text column then had no real width to grow into, collapsing
  // every row's title/URL/memo to an invisible sliver. Plain default column layout gives the
  // single child the full width via Yoga's normal cross-axis stretch instead.
  contentPressable: {
    flexGrow: 1,
  },
  actionSlot: {
    bottom: 0,
    position: 'absolute',
    top: 0,
    width: ACTION_WIDTH,
  },
  // Logical (not physical left/right) so RN's automatic RTL mirroring both repositions these
  // slots and - since the PanResponder's own drag math is purely physical (it just uncovers
  // whichever slot sits behind the content on either physical edge) - transparently swaps which
  // swipe direction reveals which action in RTL, with no gesture-logic changes needed at all.
  shareSlot: {
    start: 0,
  },
  deleteSlot: {
    end: 0,
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
}));
