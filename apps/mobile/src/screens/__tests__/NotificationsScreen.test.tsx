import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Text } from 'react-native';
import i18n from '../../i18n';
import { UserAvatar } from '../../components/UserAvatar';
import { navigationRef } from '../../navigation/navigationRef';
import { NotificationBellButton } from '../../notifications/NotificationBellButton';
import { getUnreadCount, resetNotificationState, setUnreadCount } from '../../notifications/notificationState';
import { NotificationTypeIcon } from '../../notifications/NotificationTypeIcon';
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
  type NotificationsPage,
} from '../../notifications/notificationsApi';
import { emitSocialPushEvent } from '../../push/pushEvents';
import { NotificationsScreen } from '../NotificationsScreen';

const mockNavigation = { setOptions: jest.fn(), navigate: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
  useNavigation: () => mockNavigation,
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../navigation/navigationRef', () => ({ navigationRef: { navigate: jest.fn() } }));
jest.mock('../../notifications/notificationsApi', () => ({
  ...jest.requireActual('../../notifications/notificationsApi'),
  getNotifications: jest.fn(),
  getNotification: jest.fn(),
  markNotificationRead: jest.fn(),
  markAllNotificationsRead: jest.fn(),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach(renderer => renderer.unmount());
  });
  jest.clearAllMocks();
  resetNotificationState();
});

function row(id: number, overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    type: 'collectionItemComment',
    title: '새 댓글',
    body: `알림 ${id}`,
    actor: { jupleId: 'ABCDEFGH', displayName: 'Kim', profileImageUrl: null, profileImageVersion: null },
    collectionName: '여행',
    createdAtUtc: new Date().toISOString(),
    readAtUtc: null,
    target: { kind: 'collectionItem', collectionId: 4, itemId: 9, focus: 'comments' },
    ...overrides,
  };
}

function page(items: AppNotification[], nextCursor: string | null = null, unreadCount = items.filter(item => item.readAtUtc === null).length): NotificationsPage {
  return { items, nextCursor, unreadCount };
}

async function render() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <NotificationsScreen navigation={mockNavigation as never} route={{ key: 'n', name: 'Notifications' } as never} />,
    );
  });
  mounted.push(renderer);
  return renderer;
}

/** Host nodes only - one per rendered element (composite wrappers would match the same testID again). */
const byTestId = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID && typeof node.type === 'string');
/** The pressable element itself (its composite carries onPress). */
const pressable = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];

function headerRight(): React.ReactElement<{ readonly onPress: () => void }> | null {
  const options = mockNavigation.setOptions.mock.calls.at(-1)?.[0];
  return options?.headerRight ? options.headerRight() : null;
}

describe('NotificationsScreen', () => {
  it('lists newest first with unread rows marked subtly, the actor\'s avatar or a neutral type icon, and a generic line for a gone target', async () => {
    jest.mocked(getNotifications).mockResolvedValue(page([
      row(3),
      row(2, { readAtUtc: '2026-10-01T00:00:00Z' }),
      row(1, { type: 'collectionLinkSubmission', actor: null, body: '\'여행\'에 승인을 기다리는 새 링크가 있어요.' }),
      row(0, { type: 'collectionItemReaction', actor: null, title: null, body: null, collectionName: null, target: { kind: 'unavailable' } }),
    ]));
    const renderer = await render();

    expect(renderer.root.findByType(FlatList).props.data.map((item: AppNotification) => item.id)).toEqual([3, 2, 1, 0]);
    expect(byTestId(renderer, 'notification-unread-3')).toHaveLength(1);
    expect(byTestId(renderer, 'notification-unread-2')).toHaveLength(0);
    expect(renderer.root.findAllByType(UserAvatar)).toHaveLength(2);
    expect(renderer.root.findAllByType(NotificationTypeIcon).map(icon => icon.props.type)).toEqual(['collectionLinkSubmission', 'collectionItemReaction']);
    const texts = renderer.root.findAllByType(Text).map(text => text.props.children);
    expect(texts).toContain('이 알림의 항목을 더 이상 볼 수 없어요.');
    expect(getUnreadCount()).toBe(3);
  });

  it('a cancelled approval request disappears from the open Inbox when the Collection refresh signal arrives, with its unread count; the other rows stay', async () => {
    const request = (id: number) => row(id, { type: 'collectionLinkSubmission', actor: null, body: `request ${id}`, target: { kind: 'collectionSubmissions', collectionId: 4 } });
    jest.mocked(getNotifications).mockResolvedValueOnce(page([request(2), request(1), row(0)]));
    const renderer = await render();
    expect(renderer.root.findByType(FlatList).props.data.map((item: AppNotification) => item.id)).toEqual([2, 1, 0]);
    expect(getUnreadCount()).toBe(3);

    // The requester cancelled request 2: the server deleted its row.
    jest.mocked(getNotifications).mockResolvedValue(page([request(1), row(0)]));
    await act(async () => {
      emitSocialPushEvent({ type: 'collectionContentChanged', collectionId: 4 });
    });

    expect(renderer.root.findByType(FlatList).props.data.map((item: AppNotification) => item.id)).toEqual([1, 0]);
    expect(getUnreadCount()).toBe(2);
  });

  it('tapping a row shows it read at once, lowers the bell, marks it on the server and opens its exact target', async () => {
    jest.mocked(getNotifications).mockResolvedValue(page([row(5), row(4)]));
    jest.mocked(markNotificationRead).mockResolvedValue({ markedCount: 1, unreadCount: 1 });
    const renderer = await render();

    await act(async () => {
      pressable(renderer, 'notification-row-5').props.onPress();
    });

    expect(byTestId(renderer, 'notification-unread-5')).toHaveLength(0);
    expect(markNotificationRead).toHaveBeenCalledWith(expect.any(Function), 5);
    expect(getUnreadCount()).toBe(1);
    expect(navigationRef.navigate).toHaveBeenCalledWith('CollectionDetails', expect.objectContaining({
      collectionId: 4,
      openItem: { itemId: 9, focus: 'comments' },
    }));
  });

  it('모두 읽음 is offered only while something is unread, and reads everything at once', async () => {
    jest.mocked(getNotifications).mockResolvedValue(page([row(2), row(1)]));
    jest.mocked(markAllNotificationsRead).mockResolvedValue({ markedCount: 2, unreadCount: 0 });
    const renderer = await render();

    const action = headerRight();
    expect(action).not.toBeNull();
    await act(async () => {
      action!.props.onPress();
    });

    expect(markAllNotificationsRead).toHaveBeenCalledTimes(1);
    expect(byTestId(renderer, 'notification-unread-2')).toHaveLength(0);
    expect(byTestId(renderer, 'notification-unread-1')).toHaveLength(0);
    expect(getUnreadCount()).toBe(0);
    expect(headerRight()).toBeNull();
  });

  it('a failed 모두 읽음 re-reads the list rather than keep a wrong state', async () => {
    jest.mocked(getNotifications).mockResolvedValue(page([row(2)]));
    jest.mocked(markAllNotificationsRead).mockRejectedValue(new Error('offline'));
    await render();

    await act(async () => {
      headerRight()!.props.onPress();
    });

    expect(getNotifications).toHaveBeenCalledTimes(2);
  });

  it('pages older notifications in near the end, never twice the same id, and a failed page keeps the rows with a retry', async () => {
    jest.mocked(getNotifications)
      .mockResolvedValueOnce(page([row(9), row(8)], '8'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page([row(8), row(7)], null));
    const renderer = await render();
    const list = () => renderer.root.findByType(FlatList);

    await act(async () => {
      list().props.onEndReached();
    });
    expect(list().props.data).toHaveLength(2);
    const retry = byTestId(renderer, 'notifications-load-more-retry');
    expect(retry).toHaveLength(1);

    await act(async () => {
      pressable(renderer, 'notifications-load-more-retry').props.onPress();
    });
    expect(list().props.data.map((item: AppNotification) => item.id)).toEqual([9, 8, 7]);
    expect(jest.mocked(getNotifications).mock.calls[2][1]).toEqual(expect.objectContaining({ cursor: '8', limit: 30 }));
  });

  it('says so when there is nothing yet', async () => {
    jest.mocked(getNotifications).mockResolvedValue(page([]));
    const renderer = await render();

    expect(byTestId(renderer, 'notifications-empty')).toHaveLength(1);
    expect(headerRight()).toBeNull();
  });

  it('a first page that fails offers a retry instead of a blank screen', async () => {
    jest.mocked(getNotifications).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page([row(1)]));
    const renderer = await render();

    await act(async () => {
      pressable(renderer, 'notifications-retry').props.onPress();
    });

    expect(renderer.root.findByType(FlatList).props.data).toHaveLength(1);
  });
});

describe('NotificationBellButton', () => {
  it('shows the unread number (99+ above 99) and says the full count', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<NotificationBellButton onPress={() => undefined} />);
    });
    mounted.push(renderer);
    const bell = () => renderer.root.findAll(node => node.props.testID === 'notification-bell' && typeof node.type === 'string')[0];

    expect(bell().props.accessibilityLabel).toBe('알림');
    expect(renderer.root.findAll(node => node.props.testID === 'notification-bell-badge' && typeof node.type === 'string')).toHaveLength(0);

    act(() => setUnreadCount(7));
    expect(bell().props.accessibilityLabel).toBe('알림, 읽지 않은 알림 7개');
    expect(renderer.root.findAllByType(Text).map(text => text.props.children)).toContain('7');

    act(() => setUnreadCount(120));
    expect(bell().props.accessibilityLabel).toBe('알림, 읽지 않은 알림 120개');
    expect(renderer.root.findAllByType(Text).map(text => text.props.children)).toContain('99+');
  });
});
