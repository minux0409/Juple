import { act, type ReactTestInstance } from 'react-test-renderer';

/**
 * TEST-ONLY: drives a SwipeableItemRow's real PanResponder handlers (see components/SwipeableItemRow) with synthetic touch
 * history, the way React Native's responder system calls them: grant -> moves -> release. `within` is the row itself or
 * anything containing exactly the row to swipe (its content layer is the first node carrying accessibilityActions).
 */
function touchesAt(x: number, y: number, at: number, previous: readonly [number, number, number]) {
  return {
    touchHistory: {
      touchBank: [{ touchActive: true, startPageX: 0, startPageY: 0, startTimeStamp: 0, currentPageX: x, currentPageY: y, currentTimeStamp: at, previousPageX: previous[0], previousPageY: previous[1], previousTimeStamp: previous[2] }],
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: at,
    },
    nativeEvent: {},
  };
}

const NO_TOUCHES = {
  touchHistory: { touchBank: [], numberActiveTouches: 0, indexOfSingleActiveTouch: -1, mostRecentTimeStamp: 0 },
  nativeEvent: {},
};

function contentLayer(within: ReactTestInstance): ReactTestInstance {
  const layer = within.findAll(node => Array.isArray(node.props.accessibilityActions))[0];
  if (!layer) {
    throw new Error('No SwipeableItemRow content layer found.');
  }
  return layer;
}

/** A full, flat left swipe (well past the delete distance) and release: what asks the row's onDelete. */
export async function swipeRowToDelete(within: ReactTestInstance): Promise<void> {
  const layer = contentLayer(within);
  await act(async () => {
    layer.props.onResponderGrant(NO_TOUCHES);
    layer.props.onResponderMove(touchesAt(-60, 0, 1, [0, 0, 0]));
    layer.props.onResponderMove(touchesAt(-240, 0, 2, [-60, 0, 1]));
    layer.props.onResponderRelease(touchesAt(-240, 0, 2, [-60, 0, 1]));
  });
}
