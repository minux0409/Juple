import { act } from 'react-test-renderer';
import type { GestureResponderHandlers } from 'react-native';

/**
 * TEST-ONLY: drives a sheet header's real PanResponder handlers (see components/sheetDismissGesture) with synthetic
 * touch history, the way React Native's responder system calls them. Two ways a header drag begins:
 *  - 'header': the touch starts on the header itself (its title, the empty space, the handle) - nothing deeper claims
 *    it, so the header is asked at touch-down (onStartShouldSetResponder) and owns every move from then on;
 *  - 'control': the touch starts on a header button (X, List/Grid), which owns it from touch-down - the header gets it
 *    only by capturing a clear downward move (onMoveShouldSetResponderCapture).
 * Then moves -> release. Distances are dp, times ms.
 */
export interface SheetDragOptions {
  /** Total downward movement (negative = upward). */
  readonly dy: number;
  /** Total time of the drag; the last step decides the release velocity (dy of the last step / its time). */
  readonly durationMs?: number;
  readonly steps?: number;
  /** The first step - by default up to 10 in the direction of dy. */
  readonly startDy?: number;
  /** Where the finger lands: on the header itself (default) or on a header button. */
  readonly from?: 'header' | 'control';
}

export function dragSheet(handlers: GestureResponderHandlers, { dy, durationMs = 400, steps = 6, startDy, from = 'header' }: SheetDragOptions): boolean {
  let time = 1;
  let y = 200;
  let previousY = y;
  let previousTime = time;
  const event = () => ({
    nativeEvent: { touches: [{}], changedTouches: [{}] },
    touchHistory: {
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: time,
      touchBank: [{
        touchActive: true,
        startPageX: 0, startPageY: 200, startTimeStamp: 1,
        currentPageX: 0, currentPageY: y, currentTimeStamp: time,
        previousPageX: 0, previousPageY: previousY, previousTimeStamp: previousTime,
      }],
    },
  }) as never;
  const moveTo = (nextY: number, elapsed: number) => {
    previousY = y;
    previousTime = time;
    y = nextY;
    time += elapsed;
  };

  let claimed = false;
  act(() => {
    handlers.onStartShouldSetResponderCapture?.(event());
    if (from === 'header') {
      claimed = handlers.onStartShouldSetResponder?.(event()) ?? false;
      if (claimed) {
        handlers.onResponderGrant?.(event());
      }
    }
  });
  const firstStep = startDy ?? Math.sign(dy) * Math.min(Math.abs(dy), 10);
  moveTo(200 + firstStep, 16);
  if (from === 'control') {
    // The button owns the touch; the header only gets it by capturing the move.
    act(() => {
      claimed = handlers.onMoveShouldSetResponderCapture?.(event()) ?? false;
      if (claimed) {
        handlers.onResponderGrant?.(event());
      }
    });
  } else if (claimed) {
    act(() => {
      handlers.onResponderMove?.(event());
    });
  }
  if (!claimed) {
    return false;
  }
  const stepTime = Math.max(Math.round((durationMs - 16) / Math.max(steps, 1)), 1);
  for (let index = 1; index <= steps; index += 1) {
    moveTo(200 + firstStep + ((dy - firstStep) * index) / steps, stepTime);
    act(() => {
      handlers.onResponderMove?.(event());
    });
  }
  act(() => {
    handlers.onResponderRelease?.(event());
  });
  return true;
}

/** Lets the sheet's snap-back / leave animation (and the "still open?" check after it) run out. */
export async function settleSheet(ms = 700): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, ms));
  });
}

/** The current value of an Animated.Value (the sheet's drag offset). */
export function animatedValue(value: unknown): number {
  return (value as { __getValue(): number }).__getValue();
}
