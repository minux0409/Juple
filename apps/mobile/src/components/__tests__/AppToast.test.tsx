import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppToastProvider, useAppToast } from '../AppToast';
import { NotificationToast, NOTIFICATION_TOAST_DURATION_MS } from '../NotificationToast';
import { UndoToast, UNDO_TOAST_DURATION_MS } from '../UndoToast';
import { ConfirmDialog } from '../ConfirmDialog';

type AppToastApi = ReturnType<typeof useAppToast>;

/** Captures the real Provider's context value so tests can drive it directly, the same way a
 * screen's useAppToast() call would. */
let capturedApi: AppToastApi;
function Harness() {
  capturedApi = useAppToast();
  return null;
}

function renderHost() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <AppToastProvider>
        <Harness />
      </AppToastProvider>,
    );
  });
  return renderer;
}

function makeUndoSpec(overrides: Partial<Parameters<AppToastApi['showUndoToast']>[0]> = {}) {
  return {
    actionLabel: 'Undo',
    message: 'Moved.',
    noticeTitle: 'Notice',
    confirmLabel: 'OK',
    undoErrorMessage: 'Could not undo.',
    onUndo: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('AppToast Host', () => {
  it('shows a NotificationToast for showNotificationToast', () => {
    const renderer = renderHost();
    act(() => capturedApi.showNotificationToast('Saved.'));

    expect(renderer.root.findByType(NotificationToast).props.message).toBe('Saved.');
    expect(renderer.root.findAllByType(UndoToast)).toHaveLength(0);
  });

  it('shows an UndoToast for showUndoToast', () => {
    const renderer = renderHost();
    const spec = makeUndoSpec({ message: 'Deleted.' });
    act(() => capturedApi.showUndoToast(spec));

    const undoToast = renderer.root.findByType(UndoToast);
    expect(undoToast.props.message).toBe('Deleted.');
    expect(renderer.root.findAllByType(NotificationToast)).toHaveLength(0);
  });

  it('runs the onUndo callback when Undo is pressed', async () => {
    const renderer = renderHost();
    const spec = makeUndoSpec();
    act(() => capturedApi.showUndoToast(spec));

    await act(async () => {
      renderer.root.findByType(UndoToast).props.onUndo();
      await Promise.resolve();
    });

    expect(spec.onUndo).toHaveBeenCalledTimes(1);
  });

  it('calls onUndo exactly once on rapid repeated presses', async () => {
    const renderer = renderHost();
    let resolveUndo!: () => void;
    const spec = makeUndoSpec({ onUndo: jest.fn(() => new Promise<void>(resolve => { resolveUndo = resolve; })) });
    act(() => capturedApi.showUndoToast(spec));

    const onUndo = renderer.root.findByType(UndoToast).props.onUndo;
    act(() => { onUndo(); onUndo(); onUndo(); });
    expect(spec.onUndo).toHaveBeenCalledTimes(1);

    await act(async () => { resolveUndo(); await Promise.resolve(); });
  });

  it('dismisses the UndoToast on its own after the undo duration elapses, without running onUndo', () => {
    const renderer = renderHost();
    const spec = makeUndoSpec();
    act(() => capturedApi.showUndoToast(spec));

    act(() => { jest.advanceTimersByTime(UNDO_TOAST_DURATION_MS); });

    expect(renderer.root.findAllByType(UndoToast)).toHaveLength(0);
    expect(spec.onUndo).not.toHaveBeenCalled();
  });

  it('dismisses the NotificationToast on its own after the notification duration elapses', () => {
    const renderer = renderHost();
    act(() => capturedApi.showNotificationToast('Saved.'));

    act(() => { jest.advanceTimersByTime(NOTIFICATION_TOAST_DURATION_MS); });

    expect(renderer.root.findAllByType(NotificationToast)).toHaveLength(0);
  });

  it('replaces an already-showing Toast with a newly shown one', () => {
    const renderer = renderHost();
    act(() => capturedApi.showNotificationToast('First'));
    act(() => capturedApi.showUndoToast(makeUndoSpec({ message: 'Second' })));

    expect(renderer.root.findAllByType(NotificationToast)).toHaveLength(0);
    expect(renderer.root.findByType(UndoToast).props.message).toBe('Second');
  });

  it("a replaced Toast's own stale timer never dismisses the Toast that replaced it", () => {
    const renderer = renderHost();
    // "First" (a 3s notification) is replaced 1s in by "Second" (a 5s undo, dismissing at t=6000).
    // If "First"'s own timer had survived the replacement, it would fire at t=3000 and wrongly
    // dismiss "Second" too, well before "Second"'s own real deadline.
    act(() => capturedApi.showNotificationToast('First'));
    act(() => { jest.advanceTimersByTime(1000); });
    act(() => capturedApi.showUndoToast(makeUndoSpec({ message: 'Second' })));
    act(() => { jest.advanceTimersByTime(NOTIFICATION_TOAST_DURATION_MS - 1000); });

    expect(renderer.root.findByType(UndoToast).props.message).toBe('Second');
  });

  it('keeps the current Toast showing across a bottom-anchor change, and applies the new offset', () => {
    const renderer = renderHost();
    act(() => capturedApi.showUndoToast(makeUndoSpec({ message: 'Moved.' })));
    act(() => capturedApi.setToastBottomOffset(1, 50));

    const undoToast = renderer.root.findByType(UndoToast);
    expect(undoToast.props.message).toBe('Moved.');
    expect(undoToast.props.bottomOffset).toBe(50);
  });

  it('never resets the auto-dismiss timer when only the bottom anchor changes', () => {
    const renderer = renderHost();
    const spec = makeUndoSpec();
    act(() => capturedApi.showUndoToast(spec));

    act(() => { jest.advanceTimersByTime(3000); });
    act(() => capturedApi.setToastBottomOffset(1, 80));
    // If the anchor change had restarted the timer, only 2s (of a fresh 5s) would have elapsed
    // here and the toast would still be showing - it must already be gone.
    act(() => { jest.advanceTimersByTime(UNDO_TOAST_DURATION_MS - 3000); });

    expect(renderer.root.findAllByType(UndoToast)).toHaveLength(0);
  });

  it('shows the one-button ConfirmDialog (not an error toast) when onUndo rejects', async () => {
    const renderer = renderHost();
    const spec = makeUndoSpec({
      onUndo: jest.fn().mockRejectedValue(new Error('network')),
      undoErrorMessage: 'Could not undo the move.',
      noticeTitle: 'Heads up',
      confirmLabel: 'Got it',
    });
    act(() => capturedApi.showUndoToast(spec));

    await act(async () => {
      renderer.root.findByType(UndoToast).props.onUndo();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderer.root.findAllByType(UndoToast)).toHaveLength(0);
    const dialog = renderer.root.findByType(ConfirmDialog);
    expect(dialog.props.visible).toBe(true);
    expect(dialog.props.message).toBe('Could not undo the move.');
    expect(dialog.props.title).toBe('Heads up');
    expect(dialog.props.confirmLabel).toBe('Got it');
  });

  it('an early manual dismiss leaves no stale timer that could affect a later Toast', () => {
    const renderer = renderHost();
    act(() => capturedApi.showUndoToast(makeUndoSpec({ message: 'First' })));
    act(() => { renderer.root.findByType(UndoToast).props.onDismiss(); });
    expect(renderer.root.findAllByType(UndoToast)).toHaveLength(0);

    act(() => capturedApi.showNotificationToast('Second'));
    // The dismissed Toast's own timer was already cleared on unmount when it unmounted (key
    // change) - this advance reaches its original 5s undo duration while staying under "Second"'s
    // own 3s notification duration, so only a stale-timer bug would make this fail.
    act(() => { jest.advanceTimersByTime(UNDO_TOAST_DURATION_MS - NOTIFICATION_TOAST_DURATION_MS + 500); });

    expect(renderer.root.findByType(NotificationToast).props.message).toBe('Second');
  });
});

describe('AppToast Host - follows the keyboard (one toast, one timer, a moving anchor)', () => {
  type KeyboardHandler = (event: { endCoordinates: { screenY: number; height: number } }) => void;
  let handlers: Map<string, KeyboardHandler>;
  const { Keyboard } = require('react-native');

  beforeEach(() => {
    handlers = new Map();
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, handler: KeyboardHandler) => {
      handlers.set(event, handler);
      return { remove: () => handlers.delete(event) };
    }) as never);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** The host's own area is the whole 750 x 1334 window: a keyboard whose top is at screenY covers 1334 - screenY. */
  function renderMeasuredHost() {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <AppToastProvider>
          <Harness />
        </AppToastProvider>,
      );
    });
    // The jest preset's View mock does not measure: the host container answers as the full window.
    const container = renderer.root.findAll(node => node.props.collapsable === false && node.instance)[0];
    container.instance.measureInWindow = (callback: (x: number, y: number, width: number, height: number) => void) => callback(0, 0, 750, 1334);
    return renderer;
  }
  // The host listens to the platform's own events (iOS: will-, Android: did-) - the test speaks in did- terms.
  const keyboard = (event: 'keyboardDidShow' | 'keyboardDidHide', screenY = 1334) => {
    const { Platform } = require('react-native');
    const name = Platform.OS === 'ios' ? event.replace('Did', 'Will') : event;
    const handler = handlers.get(name);
    expect(handler).toBeDefined();
    act(() => handler?.({ endCoordinates: { screenY, height: 1334 - screenY } }));
  };

  it('a toast shown with the keyboard open appears at once ABOVE it (above the action row riding on it)', () => {
    const renderer = renderMeasuredHost();
    act(() => capturedApi.setToastBottomOffset(1, 80, 56));
    keyboard('keyboardDidShow', 1034);
    act(() => capturedApi.showNotificationToast('저장되었습니다.'));

    // 300 covered by the keyboard + the 56 of the action row above it.
    expect(renderer.root.findByType(NotificationToast).props.bottomOffset).toBe(356);
  });

  it('keyboard closes while it is visible: the SAME toast moves down to its normal anchor, and its timer is not restarted', () => {
    const renderer = renderMeasuredHost();
    act(() => capturedApi.setToastBottomOffset(1, 80, 56));
    keyboard('keyboardDidShow', 1034);
    act(() => capturedApi.showNotificationToast('저장되었습니다.'));
    const before = renderer.root.findByType(NotificationToast);
    expect(before.props.bottomOffset).toBe(356);

    act(() => jest.advanceTimersByTime(NOTIFICATION_TOAST_DURATION_MS - 1000));
    keyboard('keyboardDidHide');

    const after = renderer.root.findByType(NotificationToast);
    expect(after.props.bottomOffset).toBe(80);
    expect(after.instance ?? after).toBe(before.instance ?? before);
    // Still the first timer: 1 s more and it is gone - not another full duration.
    act(() => jest.advanceTimersByTime(1000));
    expect(renderer.root.findAllByType(NotificationToast)).toHaveLength(0);
  });

  it('never applies the keyboard twice where the window already resized for it (no overlap with the host)', () => {
    const renderer = renderMeasuredHost();
    act(() => capturedApi.setToastBottomOffset(1, 80, 56));
    // The keyboard's top is at (or below) the host's bottom - the host already ends above it.
    keyboard('keyboardDidShow', 1334);
    act(() => capturedApi.showNotificationToast('Saved.'));
    expect(renderer.root.findByType(NotificationToast).props.bottomOffset).toBe(80);
  });

  it('a screen anchor with nothing above the keyboard (a tab bar) floats the toast right above the keyboard', () => {
    const renderer = renderMeasuredHost();
    act(() => capturedApi.setToastBottomOffset(1, 64));
    keyboard('keyboardDidShow', 1034);
    act(() => capturedApi.showNotificationToast('Saved.'));
    expect(renderer.root.findByType(NotificationToast).props.bottomOffset).toBe(300);
  });
});
