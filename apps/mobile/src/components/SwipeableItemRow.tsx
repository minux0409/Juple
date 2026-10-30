import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  PanResponder,
  I18nManager,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Pressable } from './Pressable';
import { ShareIcon } from '../icons/ShareIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { colors, minTouchTarget, spacing, themedStyles } from '../theme/tokens';
import { closeOpenRow, notifyRowClosed, notifyRowOpened, setSwipeScrollLock } from './swipeableRowCoordinator';

const ACTION_WIDTH = 76;
/** A compact row (a narrow Grid tile) reveals stacked icon + short-label actions in a slimmer pane, so they never eat most of the tile. */
const COMPACT_ACTION_WIDTH = 72;
/** Below this horizontal movement, a touch is treated as a tap/vertical scroll, not a swipe. */
const HORIZONTAL_INTENT_THRESHOLD = 8;
/** A left swipe asks to delete once it has travelled this share of the row's width (never less than one action width). */
const DELETE_SWIPE_DISTANCE_SHARE = 0.4;
/** ...or once it is flung left this fast (px/ms, PanResponder's vx) after at least half an action width. */
const DELETE_SWIPE_VELOCITY = 0.5;
/** A release that drifted more than this share of its horizontal travel vertically is a diagonal move, never a delete. */
const DELETE_SWIPE_MAX_VERTICAL_SHARE = 0.5;
/** The icon on a revealed action: white on the dark-grey share / red delete panels in both themes. */
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
  /** Background of the revealed action (default: the dark grey 공유 uses). */
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
  /** testID of the delete underlay shown while the row is dragged left. */
  readonly deleteTestID?: string;
  /**
   * Asked once when the row is swiped left past the delete threshold (distance or a fling): the row springs back and this
   * runs - the caller shows its own confirmation. There is no intermediate revealed delete button. Omit it when the viewer
   * may not delete/remove this row (e.g. a Contributor in a shared Category, or another member's link) - then the row
   * cannot be swiped left at all.
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
 * this doesn't need either). Swiping right reveals the start action (공유 / 복구); swiping left far enough asks to
 * delete right away (no intermediate button). Only one row across a whole list stays open at a time; a list should
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
  const deleteDistance = Math.max(actionWidth, Math.round(rowWidth * DELETE_SWIPE_DISTANCE_SHARE));
  // How far the content may follow the finger left: the whole row once it is measured.
  const deleteDragLimit = rowWidth > 0 ? rowWidth : deleteDistance * 2;
  const hasStartSide = onShare !== undefined || startAction !== undefined;
  const translateX = useRef(new Animated.Value(0)).current;
  /** Only the start side (공유 / startAction) stays open; a left swipe never rests open. */
  const openDirectionRef = useRef<'right' | null>(null);
  /** Set when this gesture already asked to delete, so one swipe never opens two confirmations. */
  const deleteRequestedRef = useRef(false);
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

  const openStart = useCallback(() => {
    openDirectionRef.current = 'right';
    Animated.timing(translateX, { toValue: actionWidth, duration: 200, useNativeDriver: true }).start();
    notifyRowOpened(close);
  }, [translateX, close, actionWidth]);

  /**
   * Where the row goes when the finger lifts. A left swipe past the delete distance - or flung left, mostly horizontally -
   * springs back and asks onDelete once; anything shorter just springs back. The start side opens past its threshold.
   * An interrupted gesture (`gesture` null: the system took the touch) never deletes.
   */
  const settle = useCallback(
    (gesture: { readonly dx: number; readonly dy: number; readonly vx: number } | null) => {
      const offset = currentOffsetRef.current;
      const horizontal = gesture !== null && Math.abs(gesture.dy) <= Math.abs(gesture.dx) * DELETE_SWIPE_MAX_VERTICAL_SHARE;
      const farEnough = offset <= -deleteDistance;
      const flung = gesture !== null && gesture.vx <= -DELETE_SWIPE_VELOCITY && offset <= -actionWidth / 2;
      if (onDelete && horizontal && (farEnough || flung) && !deleteRequestedRef.current) {
        deleteRequestedRef.current = true;
        close();
        onDelete();
      } else if (hasStartSide && offset >= openThreshold) {
        openStart();
      } else {
        close();
      }
    },
    [onDelete, hasStartSide, openThreshold, deleteDistance, actionWidth, openStart, close],
  );

  // Never leave the list frozen if the row disappears mid-swipe (e.g. deleted by a refresh).
  useEffect(() => () => setSwipeScrollLock(false), []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !disabled &&
          Math.abs(gesture.dx) > HORIZONTAL_INTENT_THRESHOLD &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: (_event, gesture) => {
          // A horizontal swipe from here on: the list stops scrolling until the finger lifts (see setSwipeScrollLock).
          setSwipeScrollLock(true);
          deleteRequestedRef.current = false;
          if (openDirectionRef.current !== null) {
            showEdge('left');
          } else {
            showEdge(gesture.dx > 0 ? 'left' : gesture.dx < 0 ? 'right' : 'both');
          }
        },
        onPanResponderMove: (_event, gesture) => {
          const base = openDirectionRef.current === 'right' ? actionWidth : 0;
          const next = clamp(base + gesture.dx, onDelete ? -deleteDragLimit : 0, hasStartSide ? actionWidth : 0);
          translateX.setValue(next);
          showEdge(next > 0 ? 'left' : next < 0 ? 'right' : revealedEdgeRef.current);
        },
        onPanResponderRelease: (_event, gesture) => {
          setSwipeScrollLock(false);
          settle(gesture);
        },
        // Once the swipe has been recognized as horizontal, a scroll view asking for the touch is refused - a small vertical drift
        // must not turn it into a scroll.
        onPanResponderTerminationRequest: () => false,
        // If the system takes the touch anyway (an incoming call, an edge-back gesture), the start side settles where the finger
        // left it, a left drag springs back without deleting (nobody released it), and the list scrolls again.
        onPanResponderTerminate: () => {
          setSwipeScrollLock(false);
          settle(null);
        },
      }),
    [disabled, translateX, settle, onDelete, hasStartSide, actionWidth, deleteDragLimit, showEdge],
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
          // Only an underlay that says what the swipe will do - not a button: the delete is asked by the swipe itself
          // (see settle), and screen readers use the row's delete accessibility action.
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={[styles.deleteUnderlay, styles.deleteAction]}
            testID={deleteTestID}
          >
            <View style={[styles.deleteIconSlot, { width: actionWidth }]}>
              <TrashIcon color={ACTION_ICON_COLOR} size={22} />
            </View>
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
  // The whole row behind the content, so however far the card is dragged the uncovered part is one red surface; the
  // icon stays at the end edge, where the drag first uncovers it.
  deleteUnderlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  deleteIconSlot: {
    alignItems: 'center',
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  actionButton: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: minTouchTarget,
  },
  shareAction: {
    backgroundColor: colors.neutralAction,
  },
  deleteAction: {
    backgroundColor: colors.destructive,
  },
}));
