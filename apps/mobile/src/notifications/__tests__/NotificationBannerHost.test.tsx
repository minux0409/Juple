import ReactTestRenderer, { act } from 'react-test-renderer';
import { AccessibilityInfo, Animated, Text } from 'react-native';
import i18n from '../../i18n';
import { navigationRef } from '../../navigation/navigationRef';
import { createBannerQueue, type NotificationBanner } from '../bannerQueue';
import { BANNER_VISIBLE_MS, createBannerPanConfig, NotificationBannerHost, planBannerExit } from '../NotificationBannerHost';
import { isHorizontalBannerDrag, resolveBannerSwipe, type BannerSwipeDirection } from '../bannerGesture';
import { getNotification, markNotificationRead } from '../notificationsApi';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../navigation/navigationRef', () => ({ navigationRef: { navigate: jest.fn() } }));
jest.mock('../notificationsApi', () => ({
  ...jest.requireActual('../notificationsApi'),
  getNotification: jest.fn(),
  markNotificationRead: jest.fn(),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  jest.restoreAllMocks();
  act(() => {
    mounted.splice(0).forEach(renderer => renderer.unmount());
  });
  jest.useRealTimers();
  jest.clearAllMocks();
});

function banner(key: string, notificationId: number | null = null): NotificationBanner {
  return { key, notificationId, type: 'collectionItemComment', title: `제목 ${key}`, body: `본문 ${key}`, data: { type: 'collectionItemComment', collectionId: '4' } };
}

async function render(queue = createBannerQueue()) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<NotificationBannerHost queue={queue} />);
  });
  mounted.push(renderer);
  return { renderer, queue };
}

const banners = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(node => node.props.testID === 'notification-banner' && typeof node.type === 'string');

describe('NotificationBannerHost', () => {
  it('shows one banner from the top, announces it once, and leaves by itself - then shows the next', async () => {
    const { renderer, queue } = await render();
    act(() => {
      queue.enqueue(banner('a'));
      queue.enqueue(banner('b'));
    });

    expect(banners(renderer)).toHaveLength(1);
    expect(renderer.root.findAllByType(Text).map(text => text.props.children)).toContain('제목 a');
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(BANNER_VISIBLE_MS + 500);
    });
    expect(renderer.root.findAllByType(Text).map(text => text.props.children)).toContain('제목 b');
    expect(queue.pendingCount()).toBe(0);
  });

  it('merely showing a banner never reads the notification', async () => {
    const { queue } = await render();
    act(() => {
      queue.enqueue(banner('n:5', 5));
    });
    await act(async () => {
      jest.advanceTimersByTime(BANNER_VISIBLE_MS + 500);
    });

    expect(markNotificationRead).not.toHaveBeenCalled();
    expect(getNotification).not.toHaveBeenCalled();
  });

  it('a tap opens it through the shared path (lookup, read, navigate) and dismisses it', async () => {
    jest.mocked(getNotification).mockResolvedValue({
      id: 5, type: 'collectionItemComment', title: null, body: null, actor: null, collectionName: null,
      createdAtUtc: '2026-10-02T00:00:00Z', readAtUtc: null, target: { kind: 'collectionItem', collectionId: 4, itemId: 9, focus: 'comments' },
    });
    jest.mocked(markNotificationRead).mockResolvedValue({ markedCount: 1, unreadCount: 0 });
    const { renderer, queue } = await render();
    act(() => {
      queue.enqueue(banner('n:5', 5));
    });

    await act(async () => {
      renderer.root.findAll(node => node.props.testID === 'notification-banner-press' && typeof node.props.onPress === 'function')[0].props.onPress();
    });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(markNotificationRead).toHaveBeenCalledWith(expect.any(Function), 5);
    expect(navigationRef.navigate).toHaveBeenCalledWith('CollectionDetails', expect.objectContaining({ openItem: { itemId: 9, focus: 'comments' } }));
    expect(queue.current()).toBeNull();
  });

  it('resolves only horizontal dismissals: left or right past the distance or a flick; short drags and anything vertical do not', () => {
    expect(resolveBannerSwipe({ dx: -80, vx: 0 })).toBe('left');
    expect(resolveBannerSwipe({ dx: 80, vx: 0 })).toBe('right');
    expect(resolveBannerSwipe({ dx: 12, vx: 0.9 })).toBe('right');
    expect(resolveBannerSwipe({ dx: -12, vx: -0.9 })).toBe('left');
    expect(resolveBannerSwipe({ dx: 15, vx: 0.1 })).toBeNull();
    expect(resolveBannerSwipe({ dx: 0, vx: 0 })).toBeNull();
    // There is no up (or down) direction at all: the type only knows left and right.
    const directions: BannerSwipeDirection[] = ['left', 'right'];
    expect(directions).toHaveLength(2);
    expect(isHorizontalBannerDrag({ dx: 30, dy: 5 })).toBe(true);
    expect(isHorizontalBannerDrag({ dx: -30, dy: -25 })).toBe(true);
    expect(isHorizontalBannerDrag({ dx: 4, dy: 3 })).toBe(false);
    expect(isHorizontalBannerDrag({ dx: 3, dy: -90 })).toBe(false);
    expect(isHorizontalBannerDrag({ dx: 0, dy: 90 })).toBe(false);
    expect(isHorizontalBannerDrag({ dx: 20, dy: -60 })).toBe(false);
  });

  it('no up direction (or any vertical drag-following) remains in the banner code', () => {
    const read = (file: string) => require('fs').readFileSync(require('path').resolve(__dirname, '..', file), 'utf8') as string;
    expect(read('bannerGesture.ts')).not.toMatch(/'up'/);
    expect(read('NotificationBannerHost.tsx')).not.toMatch(/'up'|dragY|UP_EXIT/);
  });

  describe('gesture arbitration', () => {
    const callbacks = () => ({ onTouchStart: jest.fn(), onDragStart: jest.fn(), onDrag: jest.fn(), onSwipe: jest.fn(), onDragCancel: jest.fn() });
    const g = (dx: number, dy: number, vx = 0, vy = 0) => ({ dx, dy, vx, vy }) as never;

    it('a small movement is not claimed - it stays a tap', () => {
      const config = createBannerPanConfig(callbacks());
      expect(config.onMoveShouldSetPanResponderCapture?.({} as never, g(3, 4))).toBe(false);
    });

    it('a horizontal-dominant drag past the slop is claimed in the capture phase (the Pressable is terminated)', () => {
      const config = createBannerPanConfig(callbacks());
      expect(config.onMoveShouldSetPanResponderCapture?.({} as never, g(20, 2))).toBe(true);
      expect(config.onMoveShouldSetPanResponderCapture?.({} as never, g(-20, 2))).toBe(true);
      expect(config.onMoveShouldSetPanResponderCapture?.({} as never, g(-100, -30))).toBe(true);
    });

    it('up, down and vertical-dominant diagonal drags are never claimed - the banner stays still', () => {
      const config = createBannerPanConfig(callbacks());
      for (const gesture of [g(1, -20), g(0, -90), g(2, 90), g(20, -60), g(-20, 60)]) {
        expect(config.onMoveShouldSetPanResponderCapture?.({} as never, gesture)).toBe(false);
        expect(config.onMoveShouldSetPanResponder?.({} as never, gesture)).toBe(false);
      }
    });

    it('only the horizontal travel moves the banner while dragging', () => {
      const cb = callbacks();
      const config = createBannerPanConfig(cb);
      config.onPanResponderMove?.({} as never, g(-35, -50));
      expect(cb.onDrag).toHaveBeenCalledWith(-35);
    });

    it.each([['left', g(-90, 3)], ['right', g(90, 3)], ['left', g(-90, -40)]])('swipe %s dismisses only', (direction, gesture) => {
      const cb = callbacks();
      const config = createBannerPanConfig(cb);
      config.onPanResponderGrant?.({} as never, gesture);
      config.onPanResponderRelease?.({} as never, gesture);
      expect(cb.onSwipe).toHaveBeenCalledWith(direction);
      expect(cb.onDragCancel).not.toHaveBeenCalled();
    });

    it('a short drag springs back instead of dismissing', () => {
      const cb = callbacks();
      const config = createBannerPanConfig(cb);
      config.onPanResponderRelease?.({} as never, g(15, 0, 0.1));
      expect(cb.onSwipe).not.toHaveBeenCalled();
      expect(cb.onDragCancel).toHaveBeenCalled();
    });
  });

  it('a swiped banner does not navigate even if a press still arrives; swiping never marks read', async () => {
    jest.mocked(getNotification).mockResolvedValue({
      id: 5, type: 'collectionItemComment', title: null, body: null, actor: null, collectionName: null,
      createdAtUtc: '2026-10-02T00:00:00Z', readAtUtc: null, target: { kind: 'collectionItem', collectionId: 4, itemId: 9, focus: 'comments' },
    });
    jest.mocked(markNotificationRead).mockResolvedValue({ markedCount: 1, unreadCount: 0 });
    const { renderer, queue } = await render();
    act(() => {
      queue.enqueue(banner('n:5', 5));
    });
    const card = renderer.root.find(node => node.props.testID === 'notification-banner' && typeof node.type === 'string');
    // The pan responder's handlers sit on the card: a touch that grants (a drag) marks the tap as suppressed.
    await act(async () => {
      card.props.onResponderGrant?.({ nativeEvent: { touches: [], changedTouches: [], identifier: 1, touches_: [] }, touchHistory: { touchBank: [], numberActiveTouches: 0, indexOfSingleActiveTouch: -1, mostRecentTimeStamp: 0 } });
    });
    await act(async () => {
      renderer.root.findAll(node => node.props.testID === 'notification-banner-press' && typeof node.props.onPress === 'function')[0].props.onPress();
    });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(navigationRef.navigate).not.toHaveBeenCalled();
    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  describe('exit animation direction', () => {
    it('plans the exits: left = -X only, right = +X only; only the timer / a tap slide up through progress - there is no up exit for a swipe', () => {
      expect(planBannerExit('left', 400)).toEqual({ x: -400, progress: null });
      expect(planBannerExit('right', 400)).toEqual({ x: 400, progress: null });
      expect(planBannerExit(undefined, 400)).toEqual({ x: null, progress: 0 });
    });

    // Drives the card's own responder handlers with a real touch history: grant at (0,0), move, release.
    const touch = (x: number, y: number, t: number) => ({
      touchHistory: {
        indexOfSingleActiveTouch: 0,
        mostRecentTimeStamp: t,
        numberActiveTouches: 1,
        touchBank: [{ touchActive: true, startPageX: 0, startPageY: 0, startTimeStamp: 0, currentPageX: x, currentPageY: y, currentTimeStamp: t, previousPageX: 0, previousPageY: 0, previousTimeStamp: 0 }],
      },
      nativeEvent: { touches: [], changedTouches: [], identifier: 1 },
    });

    /**
     * Mounts a banner with another queued behind it, optionally swipes it, and records every
     * Animated.timing started from then on - which value it drives (the slide-in `progress` is the one
     * value ever interpolated into the Y translation) and where to.
     */
    async function exitTimings(gesture: { dx: number; dy: number } | null) {
      const interpolated: unknown[] = [];
      const originalInterpolate = Animated.Value.prototype.interpolate;
      jest.spyOn(Animated.Value.prototype, 'interpolate').mockImplementation(function (this: Animated.Value, config) {
        interpolated.push(this);
        return originalInterpolate.call(this, config);
      });
      const queue = createBannerQueue();
      const { renderer } = await render(queue);
      act(() => {
        queue.enqueue(banner('n:5', 5));
        queue.enqueue(banner('next'));
      });
      await act(async () => {
        jest.advanceTimersByTime(300); // the slide-in finishes
      });
      const timing = jest.spyOn(Animated, 'timing');
      const card = renderer.root.find(node => node.props.testID === 'notification-banner' && typeof node.type === 'string');
      if (gesture) {
        await act(async () => {
          card.props.onResponderGrant(touch(0, 0, 0));
          card.props.onResponderMove(touch(gesture.dx, gesture.dy, 50));
          card.props.onResponderRelease(touch(gesture.dx, gesture.dy, 60));
        });
      } else {
        await act(async () => {
          jest.advanceTimersByTime(BANNER_VISIBLE_MS);
        });
      }
      const calls = timing.mock.calls.map(([value, config]) => ({ drivesSlide: interpolated.includes(value), toValue: config.toValue as number }));
      await act(async () => {
        jest.advanceTimersByTime(600);
      });
      return { calls, queue };
    }

    it('a left swipe slides LEFT on X only - the vertical slide (progress) is never driven - then the next banner appears', async () => {
      const { calls, queue } = await exitTimings({ dx: -140, dy: 6 });
      expect(calls.some(call => call.drivesSlide)).toBe(false);
      expect(calls.filter(call => call.toValue < 0)).toHaveLength(1);
      expect(calls.some(call => call.toValue > 0)).toBe(false);
      expect(queue.current()?.key).toBe('next');
      expect(navigationRef.navigate).not.toHaveBeenCalled();
      expect(markNotificationRead).not.toHaveBeenCalled();
    });

    it('a right swipe slides RIGHT on X only - the vertical slide is never driven', async () => {
      const { calls, queue } = await exitTimings({ dx: 140, dy: -6 });
      expect(calls.some(call => call.drivesSlide)).toBe(false);
      expect(calls.filter(call => call.toValue > 0)).toHaveLength(1);
      expect(calls.some(call => call.toValue < 0)).toBe(false);
      expect(queue.current()?.key).toBe('next');
      expect(navigationRef.navigate).not.toHaveBeenCalled();
      expect(markNotificationRead).not.toHaveBeenCalled();
    });

    it('a horizontal-dominant diagonal swipe dismisses sideways on X only', async () => {
      const { calls, queue } = await exitTimings({ dx: -120, dy: -40 });
      expect(calls.some(call => call.drivesSlide)).toBe(false);
      expect(calls.filter(call => call.toValue < 0)).toHaveLength(1);
      expect(queue.current()?.key).toBe('next');
    });

    it('a short horizontal drag returns to X = 0: nothing is dismissed, opened or read', async () => {
      const spring = jest.spyOn(Animated, 'spring');
      const { calls, queue } = await exitTimings({ dx: 20, dy: 2 });
      expect(calls.filter(call => call.toValue !== 0)).toHaveLength(0);
      expect(spring).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 0 }));
      expect(queue.current()?.key).toBe('n:5');
      expect(navigationRef.navigate).not.toHaveBeenCalled();
      expect(markNotificationRead).not.toHaveBeenCalled();
    });

    it.each([['up', { dx: 0, dy: -90 }], ['down', { dx: 2, dy: 90 }], ['vertical-dominant diagonal', { dx: 25, dy: -80 }]])('%s: the banner is not claimed - it does not move, dismiss, open or mark read', async (_name, move) => {
      const queue = createBannerQueue();
      const { renderer } = await render(queue);
      act(() => {
        queue.enqueue(banner('n:5', 5));
        queue.enqueue(banner('next'));
      });
      const card = renderer.root.find(node => node.props.testID === 'notification-banner' && typeof node.type === 'string');
      const timing = jest.spyOn(Animated, 'timing');
      const claimed = card.props.onMoveShouldSetResponderCapture(touch(move.dx, move.dy, 50));
      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      expect(claimed).toBe(false);
      expect(timing.mock.calls.filter(([, config]) => config.toValue !== 1)).toHaveLength(0);
      expect(queue.current()?.key).toBe('n:5');
      expect(navigationRef.navigate).not.toHaveBeenCalled();
      expect(markNotificationRead).not.toHaveBeenCalled();
    });

    it('the timeout still slides the banner back up through the slide value (no swipe fade)', async () => {
      const { calls, queue } = await exitTimings(null);
      expect(calls[0]).toEqual({ drivesSlide: true, toValue: 0 });
      expect(calls).toHaveLength(2); // the exit, then the next queued banner sliding in
      expect(queue.current()?.key).toBe('next');
    });
  });
});
