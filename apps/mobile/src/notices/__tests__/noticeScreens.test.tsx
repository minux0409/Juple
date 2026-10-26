import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppState, Text, FlatList, StyleSheet } from 'react-native';
import { SettingsMenuRow } from '../../components/SettingsMenuRow';
import i18n from '../../i18n';
import { NoticeMenuRow } from '../NoticeMenuRow';
import { NoticesScreen } from '../../screens/NoticesScreen';
import { NoticeDetailScreen } from '../../screens/NoticeDetailScreen';
const mockRequest = jest.fn();
const mockNavigate = jest.fn();
let mockActive = true;
jest.mock('../../api/useAuthenticatedApi', () => ({
  useAuthenticatedApi: () => mockRequest,
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) => {
    const React = require('react');
    React.useEffect(callback, [callback]);
  },
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: { noticeId: 1 } }),
  useIsFocused: () => mockActive,
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
let read = false;
let failRead = false;
const item = {
  id: 1,
  language: 'ko',
  title: '공지 제목',
  preview: '미리보기',
  publishedAtUtc: '2026-10-24T12:00:00Z',
  isImportant: true,
  isPinned: false,
  isRead: false,
  readVersion: 1,
};
beforeEach(async () => {
  await i18n.changeLanguage('ko');
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
  jest
    .spyOn(AppState, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() });
  read = false;
  failRead = false;
  mockActive = true;
  mockRequest.mockReset();
  mockNavigate.mockClear();
  mockRequest.mockImplementation(
    async ({ path, method }: { path: string; method: string }) => {
      if (path.includes('/unread'))
        return { status: 200, body: { hasUnread: !read } };
      if (method === 'PUT') {
        if (failRead) throw new Error('offline');
        read = true;
        return { status: 204 };
      }
      if (path.includes('/notices?'))
        return {
          status: 200,
          body: { items: [{ ...item, isRead: read }], nextCursor: null },
        };
      return {
        status: 200,
        body: {
          notice: { ...item, isRead: read },
          body: '본문\n- 목록\n[도움말](https://juple.co.kr)',
          officialUrl: 'https://juple.co.kr/help',
        },
      };
    },
  );
});
afterEach(() => jest.restoreAllMocks());
const byId = (r: ReactTestRenderer.ReactTestRenderer, id: string) =>
  r.root.findAll(n => n.props.testID === id);
const press = (r: ReactTestRenderer.ReactTestRenderer, id: string) =>
  byId(r, id)
    .find(n => typeof n.props.onPress === 'function')!
    .props.onPress();
it('notices uses the ordinary single-line My Page menu and keeps only the unread badge', async () => {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    r = ReactTestRenderer.create(<NoticeMenuRow />);
  });
  expect(r.root.findByType(SettingsMenuRow).props.title).toBe(
    i18n.t('notices.title'),
  );
  const texts = r.root.findAllByType(Text).map(n => String(n.props.children));
  expect(texts).not.toContain(i18n.t('notices.description'));
  expect(texts).not.toContain('›');
  const label = r.root
    .findAllByType(Text)
    .find(n => n.props.children === i18n.t('notices.title'))!;
  expect(StyleSheet.flatten(label.props.style)).toMatchObject({
    fontSize: 15,
    fontWeight: '600',
  });
  await act(async () => r.unmount());
});
it('an empty list centers content inside the safe-area list, whereas failure offers retry', async () => {
  mockRequest.mockResolvedValue({
    status: 200,
    body: { items: [], nextCursor: null },
  });
  let r!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    r = ReactTestRenderer.create(<NoticesScreen />);
  });
  expect(byId(r, 'notices-empty').length).toBeGreaterThan(0);
  expect(
    StyleSheet.flatten(r.root.findByType(FlatList).props.contentContainerStyle),
  ).toMatchObject({ flexGrow: 1, justifyContent: 'center' });
  await act(async () => r.unmount());
  mockRequest.mockRejectedValue(new Error('offline'));
  await act(async () => {
    r = ReactTestRenderer.create(<NoticesScreen />);
  });
  expect(byId(r, 'notices-empty')).toHaveLength(0);
  await act(async () => r.unmount());
});
it('My Page N uses a separate endpoint and a successful detail read removes N across the menu', async () => {
  let menu!: ReactTestRenderer.ReactTestRenderer;
  let detail!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    menu = ReactTestRenderer.create(<NoticeMenuRow />);
  });
  expect(byId(menu, 'notice-new-badge').length).toBeGreaterThan(0);
  await act(async () => press(menu, 'my-notices'));
  expect(mockNavigate).toHaveBeenCalledWith('Notices');
  await act(async () => {
    detail = ReactTestRenderer.create(<NoticeDetailScreen />);
  });
  expect(
    mockRequest.mock.calls.filter(([x]) => x.method === 'PUT'),
  ).toHaveLength(1);
  expect(byId(menu, 'notice-new-badge')).toHaveLength(0);
  expect(
    mockRequest.mock.calls.some(([x]) => x.path.includes('/notifications')),
  ).toBe(false);
  await act(async () => {
    menu.unmount();
    detail.unmount();
  });
});
it('list renders server state and navigates to the common detail route', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<NoticesScreen />);
  });
  await act(async () => press(renderer, 'notice-1'));
  expect(mockNavigate).toHaveBeenCalledWith('NoticeDetail', { noticeId: 1 });
  await act(async () => renderer.unmount());
});
it('a notice card reads title, then its text, then the date - no 고정 / 중요 / 읽음 labels in front of the title', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<NoticesScreen />);
  });
  const card = renderer.root.find(node => node.props.testID === 'notice-1' && typeof node.props.onPress === 'function');
  const lines = card.findAllByType(Text).map(node => String(node.props.children));
  expect(lines[0]).toBe('공지 제목');
  expect(lines[1]).toBe('미리보기');
  expect(lines).toHaveLength(3);
  for (const hidden of ['notices.pinned', 'notices.important', 'notices.read', 'notices.unread']) {
    expect(lines).not.toContain(i18n.t(hidden));
  }
  // Unread: a bold title, and a screen reader is told.
  expect(card.props.accessibilityHint).toBe(i18n.t('notices.unread'));
  await act(async () => renderer.unmount());
});
it('failed mark-read keeps content visible, reports retry and does not clear N', async () => {
  failRead = true;
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<NoticeDetailScreen />);
  });
  expect(read).toBe(false);
  expect(
    renderer.root.findAllByType(Text).map(n => String(n.props.children)),
  ).toContain(i18n.t('notices.readFailed'));
  await act(async () => renderer.unmount());
});
it('a detail outside the focused screen does not mark unseen content read', async () => {
  mockActive = false;
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<NoticeDetailScreen />);
  });
  expect(
    mockRequest.mock.calls.filter(([x]) => x.method === 'PUT'),
  ).toHaveLength(0);
  await act(async () => renderer.unmount());
});
