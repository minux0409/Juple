import ReactTestRenderer, { act } from 'react-test-renderer';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  SHEET_DISMISS_DISTANCE,
  SHEET_DISMISS_VELOCITY,
  SHEET_HANDLE,
  SheetHeader,
  clampSheetDrag,
  shouldDismissSheet,
  shouldStartSheetDrag,
  useSheetDismissGesture,
  type SheetDismissGesture,
} from '../sheetDismissGesture';
import { animatedValue, dragSheet, settleSheet } from '../../testing/sheetGestureDriver';

describe('the shared bottom-sheet decisions (one place for every sheet)', () => {
  it('starts a sheet drag only for a clear downward, mostly vertical move', () => {
    expect(shouldStartSheetDrag(0, 4)).toBe(false); // a twitch
    expect(shouldStartSheetDrag(0, 12)).toBe(true);
    expect(shouldStartSheetDrag(30, 12)).toBe(false); // horizontal
    expect(shouldStartSheetDrag(0, -20)).toBe(false); // upward: never
  });

  it('dismisses past the distance, or on a fast downward flick - otherwise it snaps back', () => {
    expect(SHEET_DISMISS_DISTANCE).toBeGreaterThanOrEqual(70);
    expect(SHEET_DISMISS_DISTANCE).toBeLessThanOrEqual(100);
    expect(shouldDismissSheet(SHEET_DISMISS_DISTANCE, 0)).toBe(true);
    expect(shouldDismissSheet(SHEET_DISMISS_DISTANCE - 1, 0.1)).toBe(false);
    expect(shouldDismissSheet(30, SHEET_DISMISS_VELOCITY)).toBe(true);
    expect(shouldDismissSheet(5, 5)).toBe(false); // too short to be a flick
  });

  it('never lets the sheet go above its resting place', () => {
    expect(clampSheetDrag(-40)).toBe(0);
    expect(clampSheetDrag(25)).toBe(25);
  });
});

describe('SheetHeader + useSheetDismissGesture - the one header every bottom sheet uses', () => {
  let gesture!: SheetDismissGesture;
  const onHeaderClose = jest.fn();
  const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

  function Host(props: Parameters<typeof useSheetDismissGesture>[0]) {
    gesture = useSheetDismissGesture(props);
    return (
      <View>
        <SheetHeader
          actions={<Pressable onPress={onHeaderClose} testID="header-close"><Text>X</Text></Pressable>}
          gesture={gesture}
          testID="header"
          title={<Text testID="header-title-text">받은 승인 요청</Text>}
        />
        <View testID="content" />
      </View>
    );
  }
  function render(props: Parameters<typeof useSheetDismissGesture>[0]) {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<Host {...props} />);
    });
    mounted.push(renderer);
    return renderer;
  }
  const host = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
    renderer.root.findAll(node => node.props.testID === testID && typeof node.type === 'string')[0];
  const headerHandlers = (renderer: ReactTestRenderer.ReactTestRenderer) => host(renderer, 'header').props;

  // Under Jest a native-driver animation completes without moving the JS-side value: what the sheet animates TO is
  // what is checked (0 = snapped back, the window height = slid away).
  let timing: jest.SpyInstance;
  const lastTarget = () => timing.mock.calls[timing.mock.calls.length - 1]?.[1]?.toValue;
  beforeEach(() => {
    onHeaderClose.mockClear();
    timing = jest.spyOn(Animated, 'timing');
  });
  afterEach(() => {
    act(() => {
      mounted.splice(0).forEach(renderer => renderer.unmount());
    });
    timing.mockRestore();
  });

  it('structure: ONE full-width native view owns the drag; handle, title, the empty title space and X are all inside it', () => {
    const renderer = render({ onDismiss: jest.fn() });
    const header = host(renderer, 'header');
    // The responder surface: never flattened, touchable, stretched to the width it is given, at least a touch target tall.
    expect(header.props.collapsable).toBe(false);
    expect(header.props.pointerEvents).toBe('auto');
    expect(typeof header.props.onStartShouldSetResponder).toBe('function');
    expect(typeof header.props.onMoveShouldSetResponderCapture).toBe('function');
    expect(typeof header.props.onResponderMove).toBe('function');
    const headerStyle = StyleSheet.flatten(header.props.style);
    expect(headerStyle.alignSelf).toBe('stretch');
    expect(headerStyle.minHeight).toBeGreaterThanOrEqual(44);
    // The title area takes all the free width: the empty space between the title and X is part of the header.
    const titleArea = host(renderer, 'sheet-header-title');
    expect(StyleSheet.flatten(titleArea.props.style)).toMatchObject({ flex: 1 });
    expect(titleArea.findAll(node => node.props.testID === 'header-title-text').length).toBeGreaterThan(0);
    for (const testID of ['sheet-handle', 'sheet-header-row', 'sheet-header-title', 'sheet-header-actions', 'header-close']) {
      expect(header.findAll(node => node.props.testID === testID).length).toBeGreaterThan(0);
    }
    // Only the OUTER header has the handlers - not the handle, the title or the button wrapper.
    for (const testID of ['sheet-handle', 'sheet-header-row', 'sheet-header-title', 'sheet-header-actions']) {
      expect(host(renderer, testID).props.onStartShouldSetResponder).toBeUndefined();
    }
    // The content below is not part of it.
    expect(header.findAll(node => node.props.testID === 'content')).toHaveLength(0);
    expect(host(renderer, 'content').props.onMoveShouldSetResponderCapture).toBeUndefined();
  });

  it('the handle is the one look: a small neutral capsule (36 x 4) near the top edge', () => {
    const renderer = render({ onDismiss: jest.fn() });
    const capsule = StyleSheet.flatten(host(renderer, 'sheet-handle').findAll(node => typeof node.type === 'string')[1].props.style);
    expect(capsule).toMatchObject({ width: SHEET_HANDLE.width, height: SHEET_HANDLE.height, borderRadius: SHEET_HANDLE.radius });
  });

  it('a drag that starts on the TITLE / empty header space: the header owns it from touch-down; far enough closes - once', async () => {
    const onDismiss = jest.fn();
    const renderer = render({ onDismiss });
    expect(dragSheet(headerHandlers(renderer), { from: 'header', dy: 140, durationMs: 700 })).toBe(true);
    // It followed the finger...
    expect(animatedValue(gesture.dragY)).toBeGreaterThan(100);
    await settleSheet();
    // ...then slid away and closed through onDismiss.
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(lastTarget()).toBe(1334);
    expect(onHeaderClose).not.toHaveBeenCalled();
    dragSheet(headerHandlers(renderer), { from: 'header', dy: 140, durationMs: 700 });
    await settleSheet();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('a short drag from the title snaps back; a plain tap on the title does nothing', async () => {
    const onDismiss = jest.fn();
    const renderer = render({ onDismiss });
    dragSheet(headerHandlers(renderer), { from: 'header', dy: 30, durationMs: 600 });
    await settleSheet();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(lastTarget()).toBe(0);
    dragSheet(headerHandlers(renderer), { from: 'header', dy: 0, steps: 1 });
    await settleSheet();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('a fast downward flick from the title closes before the distance threshold', async () => {
    const onDismiss = jest.fn();
    const renderer = render({ onDismiss });
    dragSheet(headerHandlers(renderer), { from: 'header', dy: 50, durationMs: 40, steps: 2 });
    await settleSheet();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('X: a plain tap closes through its own onPress; a clear downward drag from it is captured by the header (X not pressed)', async () => {
    const onDismiss = jest.fn();
    const renderer = render({ onDismiss });
    act(() => renderer.root.findAll(node => node.props.testID === 'header-close' && typeof node.props.onPress === 'function')[0].props.onPress());
    expect(onHeaderClose).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();

    // The button lets the header have the touch when asked (it is cancelled, not pressed)...
    const button = renderer.root.findAll(node => node.props.testID === 'header-close' && typeof node.props.onResponderTerminationRequest === 'function')[0];
    expect(button.props.onResponderTerminationRequest()).toBe(true);
    // ...and the header captures a clear downward move that started on the button.
    expect(dragSheet(headerHandlers(renderer), { from: 'control', dy: 160, durationMs: 600 })).toBe(true);
    await settleSheet();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onHeaderClose).toHaveBeenCalledTimes(1);
    // A tiny wobble on the button is never captured (the tap stays the button's).
    expect(dragSheet(headerHandlers(renderer), { from: 'control', dy: 4 })).toBe(false);
  });

  it('dragging up never moves the sheet above its resting place, and never closes it', async () => {
    const onDismiss = jest.fn();
    const renderer = render({ onDismiss });
    dragSheet(headerHandlers(renderer), { from: 'header', startDy: 10, dy: -80, durationMs: 600 });
    expect(animatedValue(gesture.dragY)).toBe(0);
    await settleSheet();
    expect(onDismiss).not.toHaveBeenCalled();
    // From a button, an upward move is not even captured.
    expect(dragSheet(headerHandlers(renderer), { from: 'control', dy: -80 })).toBe(false);
  });

  it('dismissEnabled=false: the header takes nothing - nothing moves, nothing closes', async () => {
    const onDismiss = jest.fn();
    const renderer = render({ onDismiss, dismissEnabled: false });
    expect(dragSheet(headerHandlers(renderer), { from: 'header', dy: 200 })).toBe(false);
    expect(dragSheet(headerHandlers(renderer), { from: 'control', dy: 200 })).toBe(false);
    await settleSheet();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(animatedValue(gesture.dragY)).toBe(0);
  });

  it('a close its own guard would stop (unsaved edits): snaps back, and the same close path is called for that guard', async () => {
    const onDismiss = jest.fn();
    const renderer = render({ onDismiss, canDismiss: () => false });
    dragSheet(headerHandlers(renderer), { from: 'header', dy: 160, durationMs: 600 });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await settleSheet();
    expect(lastTarget()).toBe(0);
    expect(timing.mock.calls.some(call => call[1]?.toValue === 1334)).toBe(false);
  });

  it('a close that did not happen after all (still open): the sheet comes back instead of staying off-screen', async () => {
    const onDismiss = jest.fn();
    const renderer = render({ onDismiss, isStillOpen: () => true });
    dragSheet(headerHandlers(renderer), { from: 'header', dy: 160, durationMs: 600 });
    await settleSheet(1100);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(timing.mock.calls.some(call => call[1]?.toValue === 1334)).toBe(true);
    expect(lastTarget()).toBe(0);
  });

  it('opening again (a new resetKey) puts the sheet back at rest', async () => {
    const onDismiss = jest.fn();
    const renderer = render({ onDismiss, resetKey: 1 });
    dragSheet(headerHandlers(renderer), { from: 'header', dy: 160, durationMs: 600 });
    await settleSheet();
    expect(animatedValue(gesture.dragY)).toBeGreaterThan(0);
    act(() => renderer.update(<Host onDismiss={onDismiss} resetKey={2} />));
    expect(animatedValue(gesture.dragY)).toBe(0);
  });
});
