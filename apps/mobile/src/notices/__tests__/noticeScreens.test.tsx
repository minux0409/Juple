import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppState, Text } from 'react-native';
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
