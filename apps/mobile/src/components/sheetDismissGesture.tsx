import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  StyleSheet,
  View,
  useWindowDimensions,
  type GestureResponderHandlers,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, minTouchTarget, spacing } from '../theme/tokens';

/*
 * Every Juple bottom sheet - Item Details, the 승인 요청 sheets, 참여자, the Collection pickers, the link share sheet -
 * shows the same header (SheetHeader: the small handle over its title row), and that whole header (handle, title, the
 * empty space, header buttons) is where a downward drag takes the sheet: it follows the finger and, far / fast enough,
 * closes exactly like its X / backdrop / back button (the sheet's own close path - never a separate force-close). The content below scrolls as it always
 * does; it never closes the sheet. One implementation, here: plain PanResponder + Animated (no gesture dependency;
 * nothing newer than API 27); the drag never goes through React state.
 */

/** Released this far down (dp), the sheet closes. */
export const SHEET_DISMISS_DISTANCE = 80;
/** A downward flick this fast (dp per ms - PanResponder's vy) closes it even before SHEET_DISMISS_DISTANCE. */
export const SHEET_DISMISS_VELOCITY = 0.9;
/** A flick must still have moved a little - a tap with a twitch is not a dismiss. */
const SHEET_FLICK_MIN_DISTANCE = 12;
/** Movement before a drag is taken from a tap (on the header's X / toggles too) or a horizontal swipe. */
const SHEET_DRAG_START_SLOP = 8;
/** The motion of the snap-back and of leaving (the app's 220-250 ms motion language). */
export const SHEET_DRAG_ANIMATION_MS = 220;

/** The one handle look: a small neutral capsule near the top edge - a visual cue; the whole header is the touch target. */
export const SHEET_HANDLE = { width: 36, height: 4, radius: 2, topSpacing: spacing.sm, bottomSpacing: spacing.xs } as const;

/** Is this movement the start of a sheet drag: clearly downward, more vertical than horizontal? */
export function shouldStartSheetDrag(dx: number, dy: number): boolean {
  return dy > SHEET_DRAG_START_SLOP && Math.abs(dy) > Math.abs(dx);
}

/** On release: dismiss (far enough, or a fast enough downward flick), or snap back. */
export function shouldDismissSheet(dy: number, vy: number): boolean {
  return dy >= SHEET_DISMISS_DISTANCE || (dy >= SHEET_FLICK_MIN_DISTANCE && vy >= SHEET_DISMISS_VELOCITY);
}

/** The sheet only follows the finger DOWN; it never goes above its resting place. */
export function clampSheetDrag(dy: number): number {
  return Math.max(0, dy);
}

interface SheetDismissGestureOptions {
  /** The sheet's own close path (its X / backdrop / back button). Called once per dismiss. */
  readonly onDismiss: () => void;
  /** False while the sheet's close is unavailable (a running save / creation): the drag then does nothing. */
  readonly dismissEnabled?: boolean;
  /**
   * False when closing would be stopped by the sheet's own guard (e.g. unsaved edits): the sheet snaps back and
   * onDismiss is still called, so that guard (its dialog) shows exactly as for X / back.
   */
  readonly canDismiss?: () => boolean;
  /**
   * Whether the sheet is still open a moment after onDismiss - when the close did not happen after all, the sheet
   * comes back instead of staying off-screen. Absent: assumed closed.
   */
  readonly isStillOpen?: () => boolean;
  /** A new value (the sheet opened again) puts the sheet back at rest. */
  readonly resetKey?: unknown;
}

export interface SheetDismissGesture {
  /** The sheet's drag offset - add it to the sheet's translateY (with any other offsets it already has). */
  readonly dragY: Animated.Value;
  /** 1 at rest, toward 0 as the sheet is dragged away - for the backdrop's opacity. */
  readonly backdropOpacity: Animated.AnimatedInterpolation<number>;
  /** For the sheet's header (see SheetHeader): a downward drag there moves the sheet. */
  readonly dragAreaHandlers: GestureResponderHandlers;
}

export function useSheetDismissGesture({ onDismiss, dismissEnabled = true, canDismiss, isStillOpen, resetKey }: SheetDismissGestureOptions): SheetDismissGesture {
  const { height: windowHeight } = useWindowDimensions();
  const dragY = useRef(new Animated.Value(0)).current;
  const isDismissingRef = useRef(false);
  // The latest props for the once-created responder.
  const latest = useRef({ onDismiss, dismissEnabled, canDismiss, isStillOpen, windowHeight });
  latest.current = { onDismiss, dismissEnabled, canDismiss, isStillOpen, windowHeight };

  useEffect(() => {
    isDismissingRef.current = false;
    dragY.setValue(0);
  }, [dragY, resetKey]);

  const snapBack = useCallback(() => {
    Animated.timing(dragY, { duration: SHEET_DRAG_ANIMATION_MS, easing: Easing.out(Easing.cubic), toValue: 0, useNativeDriver: true }).start();
  }, [dragY]);

  const release = useCallback((dy: number, vy: number) => {
    const current = latest.current;
    if (!current.dismissEnabled || !shouldDismissSheet(dy, vy) || isDismissingRef.current) {
      snapBack();
      return;
    }
    if (current.canDismiss && !current.canDismiss()) {
      // The sheet's own guard decides (e.g. "leave without saving?") - shown with the sheet back in place.
      snapBack();
      current.onDismiss();
      return;
    }
    isDismissingRef.current = true;
    Animated.timing(dragY, { duration: SHEET_DRAG_ANIMATION_MS, easing: Easing.in(Easing.cubic), toValue: current.windowHeight, useNativeDriver: true }).start(() => {
      latest.current.onDismiss();
      // If the sheet did not actually close (its close path declined), it comes back rather than staying hidden.
      setTimeout(() => {
        if (latest.current.isStillOpen?.()) {
          isDismissingRef.current = false;
          snapBack();
        }
      }, SHEET_DRAG_ANIMATION_MS + 130);
    });
  }, [dragY, snapBack]);

  const dragArea = useMemo(() => PanResponder.create({
    // A touch that starts on the header itself (the title, its icon, the empty space, the handle) is the header's from
    // touch-down - no header button wants it (bubble phase: a button deeper down claims first). Inside an Android
    // Modal window a drag reached the header only when the touch had been claimed at touch-down (the X / List-Grid
    // case); claiming it here makes the title and the empty space work the same way. A plain tap on them does nothing.
    onStartShouldSetPanResponder: () => latest.current.dismissEnabled && !isDismissingRef.current,
    // A touch that starts on a header button stays that button's (its tap works) until it clearly moves down: then the
    // header captures the move and the button is cancelled, not pressed.
    onMoveShouldSetPanResponderCapture: (_, gesture) => latest.current.dismissEnabled && !isDismissingRef.current && shouldStartSheetDrag(gesture.dx, gesture.dy),
    onMoveShouldSetPanResponder: (_, gesture) => latest.current.dismissEnabled && !isDismissingRef.current && shouldStartSheetDrag(gesture.dx, gesture.dy),
    onPanResponderMove: (_, gesture) => {
      dragY.setValue(clampSheetDrag(gesture.dy));
    },
    onPanResponderRelease: (_, gesture) => release(gesture.dy, gesture.vy),
    onPanResponderTerminate: () => snapBack(),
    // Once the sheet is following the finger, it keeps the gesture.
    onPanResponderTerminationRequest: () => false,
  }), [dragY, release, snapBack]);

  const backdropOpacity = useMemo(
    () => dragY.interpolate({ extrapolate: 'clamp', inputRange: [0, Math.max(windowHeight, 1)], outputRange: [1, 0] }),
    [dragY, windowHeight],
  );

  return { dragY, backdropOpacity, dragAreaHandlers: dragArea.panHandlers };
}

/**
 * Every bottom sheet's header - ONE implementation: the shared handle (a visual cue only) over the title row,
 *
 *   [                handle                ]
 *   [ icon title .................. actions ]
 *
 * all inside a single full-width native view (stretched to the sheet's edges, never flattened away, touchable) that
 * owns the drag. The title area takes the free width, so the empty space between the title and the actions is part of
 * it too: a drag may start anywhere in the header. Header buttons (X, List/Grid) keep their taps.
 */
export function SheetHeader({ gesture, title, icon, actions, style, rowStyle, testID }: {
  readonly gesture: Pick<SheetDismissGesture, 'dragAreaHandlers'>;
  /** The sheet's own title (its own Text and style - the header does not restyle it). */
  readonly title?: ReactNode;
  readonly icon?: ReactNode;
  /** Header buttons at the end (X, List/Grid). */
  readonly actions?: ReactNode;
  /** The outer header (e.g. negative margins to reach the sheet's edges over its padding). */
  readonly style?: StyleProp<ViewStyle>;
  /** The title row's own spacing / border (each sheet keeps its existing look). */
  readonly rowStyle?: StyleProp<ViewStyle>;
  readonly testID?: string;
}) {
  return (
    <View {...gesture.dragAreaHandlers} collapsable={false} pointerEvents="auto" style={[styles.header, style]} testID={testID ?? 'sheet-header'}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.handleArea} testID="sheet-handle">
        <View style={styles.handle} />
      </View>
      {title !== undefined || icon !== undefined || actions !== undefined ? (
        <View style={[styles.row, rowStyle]} testID="sheet-header-row">
          <View style={styles.titleArea} testID="sheet-header-title">
            {icon}
            {title}
          </View>
          {actions !== undefined ? <View style={styles.actions} testID="sheet-header-actions">{actions}</View> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Always the full width it is given (never shrink-wrapped around its content), and never shorter than a touch target.
  header: { alignSelf: 'stretch', minHeight: minTouchTarget },
  handleArea: { alignItems: 'center', paddingBottom: SHEET_HANDLE.bottomSpacing, paddingTop: SHEET_HANDLE.topSpacing },
  handle: { backgroundColor: colors.inputBorder, borderRadius: SHEET_HANDLE.radius, height: SHEET_HANDLE.height, width: SHEET_HANDLE.width },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: minTouchTarget },
  // Takes all the free width, so the empty space up to the actions belongs to the header's title side.
  titleArea: { alignItems: 'center', alignSelf: 'stretch', flex: 1, flexDirection: 'row', gap: spacing.sm, minWidth: 0 },
  actions: { alignItems: 'center', flexDirection: 'row', flexShrink: 0 },
});
