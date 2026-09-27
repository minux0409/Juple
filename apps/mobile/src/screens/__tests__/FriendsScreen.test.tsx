import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { FriendsScreen } from '../FriendsScreen';
import { lookupJupleId } from '../../collections/api/collaborationApi';
import { getMyProfile } from '../../api/profileApi';
import { TextInput } from 'react-native';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  getFriendRequests,
  getFriends,
  removeFriend,
  sendFriendRequest,
  setFriendNote,
  type Friend,
} from '../../friends/api/friendsApi';

jest.mock('../../push/pushPermissionFlow', () => ({ ensurePushPermissionOnce: jest.fn() }));
import { Modal } from 'react-native';
import { AppModal } from '../../components/AppModal';
import { emitSocialPushEvent } from '../../push/pushEvents';
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
jest.mock('../../collections/api/collaborationApi', () => ({
  ...jest.requireActual('../../collections/api/collaborationApi'),
  lookupJupleId: jest.fn(),
}));
jest.mock('../../api/profileApi', () => ({
  ...jest.requireActual('../../api/profileApi'),
  getMyProfile: jest.fn(),
}));
jest.mock('../../friends/api/friendsApi', () => ({
  ...jest.requireActual('../../friends/api/friendsApi'),
  getFriends: jest.fn(),
  getFriendRequests: jest.fn(),
  sendFriendRequest: jest.fn(),
  acceptFriendRequest: jest.fn(),
  declineFriendRequest: jest.fn(),
  cancelFriendRequest: jest.fn(),
  removeFriend: jest.fn(),
  setFriendNote: jest.fn(),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

const pikachu: Friend = { friendshipId: 7, jupleId: 'K7MP4Q8N', displayName: '피카츄', myNote: '회사 개발팀 김민수', friendsSinceUtc: '' };

beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(getMyProfile).mockResolvedValue({ displayName: '나', jupleId: 'MYID2345' });
  jest.mocked(getFriends).mockResolvedValue({ items: [pikachu], nextCursor: null });
  jest.mocked(getFriendRequests).mockResolvedValue([
    { requestId: 1, jupleId: 'NCMNG234', displayName: '파이리', direction: 'incoming', createdAtUtc: '' },
    { requestId: 2, jupleId: 'TGNG2345', displayName: null, direction: 'outgoing', createdAtUtc: '' },
  ]);
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

const texts = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAllByType(Text).map(node => node.props.children);

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<FriendsScreen />);
  });
  return renderer;
}

describe('FriendsScreen', () => {
  it('lists friends with their Juple ID and my private note, plus received and sent requests', async () => {
    const renderer = await renderScreen();

    const row = renderer.root.findByProps({ testID: 'friend-7' });
    expect(row.findAllByType(Text).map(node => node.props.children)).toEqual(['피카츄', 'K7MP-4Q8N', '회사 개발팀 김민수']);
    expect(renderer.root.findByProps({ testID: 'friends-incoming-1' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: 'friends-outgoing-2' })).toBeTruthy();
  });

  it('searches only within my friends, once typing settles', async () => {
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByProps({ testID: 'friends-search' }).props.onChangeText('개발');
    });
    expect(getFriends).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    expect(getFriends).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ query: '개발' }));
  });

  it('adds a friend by exact Juple ID: find, then send a request', async () => {
    jest.mocked(lookupJupleId).mockResolvedValue({ jupleId: 'NEWW2345', isSelf: false, displayName: '이상해씨' });
    jest.mocked(sendFriendRequest).mockResolvedValue({ requestId: 3, jupleId: 'NEWW2345', displayName: '이상해씨', direction: 'outgoing', createdAtUtc: '' });
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByProps({ testID: 'friends-add-input' }).props.onChangeText('neww-2345');
    });
    await act(async () => {
      await renderer.root.findByProps({ testID: 'friends-add-lookup' }).props.onPress();
    });
    expect(renderer.root.findByProps({ testID: 'friends-add-result' }).findAllByType(Text).map(node => node.props.children))
      .toEqual(expect.arrayContaining(['이상해씨', 'NEWW-2345']));

    await act(async () => {
      await renderer.root.findByProps({ testID: 'friends-add-send' }).props.onPress();
    });
    expect(sendFriendRequest).toHaveBeenCalledWith(expect.anything(), 'NEWW2345');
    expect(texts(renderer)).toContain(i18n.t('friends.requestSent'));
  });

  it('points to the existing request instead of sending a duplicate when they already asked', async () => {
    jest.mocked(lookupJupleId).mockResolvedValue({ jupleId: 'NCMNG234', isSelf: false, displayName: '파이리' });
    jest.mocked(sendFriendRequest).mockRejectedValue(new ApiError('conflict', 409, 'incomingRequestExists'));
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByProps({ testID: 'friends-add-input' }).props.onChangeText('NCMNG234');
    });
    await act(async () => {
      await renderer.root.findByProps({ testID: 'friends-add-lookup' }).props.onPress();
    });
    await act(async () => {
      await renderer.root.findByProps({ testID: 'friends-add-send' }).props.onPress();
    });

    expect(renderer.root.findByProps({ testID: 'friends-add-message' }).props.children).toBe(i18n.t('friends.incomingRequestExists'));
    expect(renderer.root.findByProps({ testID: 'friends-accept-1' })).toBeTruthy();
  });

  it('refuses my own Juple ID without sending anything', async () => {
    jest.mocked(lookupJupleId).mockResolvedValue({ jupleId: 'MEEE2345', isSelf: true });
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByProps({ testID: 'friends-add-input' }).props.onChangeText('MEEE2345');
    });
    await act(async () => {
      await renderer.root.findByProps({ testID: 'friends-add-lookup' }).props.onPress();
    });

    expect(renderer.root.findByProps({ testID: 'friends-add-message' }).props.children).toBe(i18n.t('friends.cannotAddSelf'));
    expect(sendFriendRequest).not.toHaveBeenCalled();
  });

  it('accepts and declines received requests, and cancels a sent one', async () => {
    const renderer = await renderScreen();

    await act(async () => {
      await renderer.root.findByProps({ testID: 'friends-accept-1' }).props.onPress();
    });
    expect(acceptFriendRequest).toHaveBeenCalledWith(expect.anything(), 1);

    await act(async () => {
      await renderer.root.findByProps({ testID: 'friends-decline-1' }).props.onPress();
    });
    expect(declineFriendRequest).toHaveBeenCalledWith(expect.anything(), 1);

    await act(async () => {
      await renderer.root.findByProps({ testID: 'friends-cancel-2' }).props.onPress();
    });
    expect(cancelFriendRequest).toHaveBeenCalledWith(expect.anything(), 2);
  });

  it('edits my private note, and removes a friend only after confirming', async () => {
    jest.mocked(setFriendNote).mockResolvedValue({ ...pikachu, myNote: '대학 동기' });
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByProps({ testID: 'friend-7' }).props.onPress();
    });
    await act(async () => {
      renderer.root.findByProps({ testID: 'friend-note-input' }).props.onChangeText('대학 동기');
    });
    await act(async () => {
      await renderer.root.findByProps({ testID: 'friend-note-save' }).props.onPress();
    });
    expect(setFriendNote).toHaveBeenCalledWith(expect.anything(), 7, '대학 동기');

    await act(async () => {
      renderer.root.findByProps({ testID: 'friend-remove' }).props.onPress();
    });
    expect(removeFriend).not.toHaveBeenCalled();
  });

  it('opens a friend in the centered modal (never a bottom sheet), which the remove confirmation keeps open', async () => {
    const renderer = await renderScreen();
    await act(async () => {
      renderer.root.findByProps({ testID: 'friend-7' }).props.onPress();
    });

    const detail = renderer.root.findByType(AppModal);
    expect(detail.props.testID).toBe('friend-detail');
    expect(detail.props.dismissible).toBe(true);
    expect(detail.findByType(Modal).props.animationType).toBe('fade');

    await act(async () => {
      renderer.root.findByProps({ testID: 'friend-remove' }).props.onPress();
    });
    expect(renderer.root.findByType(AppModal).props.dismissible).toBe(false);
  });

  it('a friend request arriving while the screen is open shows up without leaving it', async () => {
    const renderer = await renderScreen();
    const calls = jest.mocked(getFriendRequests).mock.calls.length;

    await act(async () => {
      emitSocialPushEvent({ type: 'friendRequest', collectionId: null });
    });

    expect(jest.mocked(getFriendRequests).mock.calls.length).toBeGreaterThan(calls);
    expect(renderer.root.findAll(node => node.props.testID === 'friend-7').length).toBeGreaterThan(0);
  });

  describe('layout: 받은 친구 신청 → 친구 추가 → 친구 → 보낸 친구 신청', () => {
    const order = (renderer: ReactTestRenderer.ReactTestRenderer, testIds: readonly string[]) => {
      // findAll walks the tree depth-first, i.e. in on-screen order.
      const ids = renderer.root.findAll(node => typeof node.props.testID === 'string').map(node => node.props.testID as string);
      return testIds.map(id => ids.indexOf(id));
    };

    it('has no "my Juple ID" row and never reads my profile - the add field is for a friend\'s ID, empty', async () => {
      const renderer = await renderScreen();

      expect(getMyProfile).not.toHaveBeenCalled();
      expect(renderer.root.findAll(node => String(node.props.testID).startsWith('friends-my-juple-id'))).toHaveLength(0);
      expect(texts(renderer)).not.toContain(i18n.t('myPage.jupleId'));
      const input = renderer.root.findAllByType(TextInput).find(node => node.props.testID === 'friends-add-input')!;
      expect(input.props.value).toBe('');
      expect(input.props.placeholder).toBe(i18n.t('friends.friendJupleIdPlaceholder'));
      expect(input.props.placeholder).not.toMatch(/[A-Z0-9]{4}-[A-Z0-9]{4}/);
    });

    it('puts received requests first with their count, the friend list next and sent requests last', async () => {
      const renderer = await renderScreen();

      expect(renderer.root.findByProps({ testID: 'friends-incoming-count' }).props.children).toBe(1);
      expect(texts(renderer)).toEqual(expect.arrayContaining([i18n.t('friends.incomingRequests'), i18n.t('friends.outgoingRequests')]));
      const [incoming, add, friend, outgoing] = order(renderer, ['friends-incoming-1', 'friends-add-input', 'friend-7', 'friends-outgoing-2']);
      expect(incoming).toBeGreaterThanOrEqual(0);
      expect(incoming).toBeLessThan(add);
      expect(add).toBeLessThan(friend);
      expect(friend).toBeLessThan(outgoing);
      const incomingCard = renderer.root.findByProps({ testID: 'friends-incoming-1' });
      expect(incomingCard.findAllByType(Text).map(node => node.props.children)).toEqual(expect.arrayContaining(['파이리', 'NCMN-G234']));
    });

    it('with no received requests the section is not shown at all', async () => {
      jest.mocked(getFriendRequests).mockResolvedValue([]);
      const renderer = await renderScreen();

      expect(renderer.root.findAll(node => node.props.testID === 'friends-incoming-count')).toHaveLength(0);
      expect(texts(renderer)).not.toContain(i18n.t('friends.incomingRequests'));
      expect(texts(renderer)).not.toContain(i18n.t('friends.outgoingRequests'));
    });
  });
});
