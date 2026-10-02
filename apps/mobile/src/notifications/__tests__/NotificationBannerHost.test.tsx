import ReactTestRenderer, { act } from 'react-test-renderer';
import { AccessibilityInfo, Text } from 'react-native';
import i18n from '../../i18n';
import { navigationRef } from '../../navigation/navigationRef';
import { createBannerQueue, type NotificationBanner } from '../bannerQueue';
import { BANNER_VISIBLE_MS, isDismissSwipe, NotificationBannerHost } from '../NotificationBannerHost';
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

  it('an upward swipe (or flick) dismisses early; a small or downward drag does not', () => {
    expect(isDismissSwipe(-40, 0)).toBe(true);
    expect(isDismissSwipe(-5, -1.2)).toBe(true);
    expect(isDismissSwipe(-10, -0.1)).toBe(false);
    expect(isDismissSwipe(30, 0.8)).toBe(false);
  });
});
