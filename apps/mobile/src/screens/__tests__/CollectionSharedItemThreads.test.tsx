import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n from '../../i18n';
import { CollectionSharedItemScreen } from '../CollectionSharedItemScreen';
import { getSharedCollectionItem } from '../../collections/api/collectionsApi';
import { getCommentReplies, getItemComments, setCommentLike, type ItemComment } from '../../comments/commentsApi';
import { clearCollectionUnlockGrants } from '../../collections/collectionUnlockGrants';

jest.mock('../../friends/api/friendsApi', () => ({
  ...jest.requireActual('../../friends/api/friendsApi'),
  getFriends: jest.fn(),
  getFriendRequests: jest.fn(),
  sendFriendRequest: jest.fn(),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../collections/api/collectionsApi', () => ({
  getSharedCollectionItem: jest.fn(),
  setItemReaction: jest.fn(),
  removeItemReaction: jest.fn(),
}));
jest.mock('../../comments/commentsApi', () => ({
  ...jest.requireActual('../../comments/commentsApi'),
  getItemComments: jest.fn(),
  getCommentReplies: jest.fn(),
  addItemComment: jest.fn(),
  deleteItemComment: jest.fn(),
  setCommentLike: jest.fn(),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
beforeEach(() => {
  jest.mocked(getSharedCollectionItem).mockResolvedValue({
    itemId: 7, url: 'https://example.com/a', title: 'Shared title', previewImageUrl: null, addedAtUtc: '2026-01-01T00:00:00Z', isMine: false,
  });
});
afterEach(() => {
  jest.clearAllMocks();
  clearCollectionUnlockGrants();
});

const person = (name: string, isMe: boolean) => ({ jupleId: 'ABCD2345', displayName: name, profileImageUrl: null, profileImageVersion: null, isCollectionOwner: false, isMe });
const comment = (id: number, body: string, overrides: Partial<ItemComment> = {}): ItemComment => ({
  id, body, createdAtUtc: new Date().toISOString(), author: person('민욱', true), replyCount: 0, likeCount: 0, viewerLiked: false, ...overrides,
});

async function renderScreen(params: Record<string, unknown> = {}) {
  const route = { key: 'CollectionSharedItem', name: 'CollectionSharedItem', params: { collectionId: 5, itemId: 7, ...params } } as never;
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<CollectionSharedItemScreen navigation={{} as never} route={route} />);
  });
  return renderer;
}
const shown = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));
const press = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];

describe('CollectionSharedItemScreen - threads', () => {
  it('opens with the threads closed - and no reply is requested until one is opened', async () => {
    jest.mocked(getItemComments).mockResolvedValue({ items: [comment(3, 'my comment', { replyCount: 2 })], previousCursor: null, totalCount: 3 });

    const renderer = await renderScreen();

    expect(shown(renderer)).toContain('답글 2개 보기');
    expect(getCommentReplies).not.toHaveBeenCalled();
  });

  it('a reply / heart notification opens the thread of its comment, replies shown, on arrival', async () => {
    jest.mocked(getItemComments).mockResolvedValue({ items: [comment(3, 'my comment', { replyCount: 1 })], previousCursor: null, totalCount: 2 });
    jest.mocked(getCommentReplies).mockResolvedValue({
      items: [comment(10, 'the answer', { rootCommentId: 3, parentCommentId: 3, author: person('지우', false) })],
      nextCursor: null,
      totalCount: 1,
    });

    const renderer = await renderScreen({ focusThreadRootId: 3 });

    expect(getCommentReplies).toHaveBeenCalledTimes(1);
    expect(getCommentReplies).toHaveBeenCalledWith(expect.anything(), 5, 7, 3, { unlockToken: null });
    expect(shown(renderer)).toContain('the answer');
    expect(shown(renderer)).toContain('답글 숨기기');
  });

  it('hearting a comment shows the heart at once and the count the server answers', async () => {
    jest.mocked(getItemComments).mockResolvedValue({ items: [comment(3, 'liked soon', { likeCount: 1 })], previousCursor: null, totalCount: 1 });
    jest.mocked(setCommentLike).mockResolvedValue({ liked: true, likeCount: 2 });
    const renderer = await renderScreen();

    await act(async () => press(renderer, 'comment-like-3').props.onPress());

    expect(setCommentLike).toHaveBeenCalledWith(expect.anything(), 5, 7, 3, true, null);
    expect(shown(renderer)).toContain('2');
    expect(press(renderer, 'comment-like-3').props.accessibilityState).toEqual({ selected: true });
  });
});
