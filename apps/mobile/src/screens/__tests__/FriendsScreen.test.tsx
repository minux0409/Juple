import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppState, StyleSheet, Text } from 'react-native';
import { colors } from '../../theme/tokens';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { FriendsScreen, OUTGOING_POLL_INTERVAL_MS, OUTGOING_POLL_MAX_MS } from '../FriendsScreen';
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

  it('a sent request being accepted leaves 보낸 친구 신청 and joins the friend list at once, while the screen is open', async () => {
    const renderer = await renderScreen();
    expect(renderer.root.findAll(node => node.props.testID === 'friends-outgoing-2').length).toBeGreaterThan(0);

    const togepi: Friend = { friendshipId: 2, jupleId: 'TGNG2345', displayName: null, myNote: null, friendsSinceUtc: '' };
    jest.mocked(getFriendRequests).mockResolvedValue([
      { requestId: 1, jupleId: 'NCMNG234', displayName: '파이리', direction: 'incoming', createdAtUtc: '' },
    ]);
    jest.mocked(getFriends).mockResolvedValue({ items: [togepi, pikachu], nextCursor: null });
    await act(async () => {
      emitSocialPushEvent({ type: 'friendRequestAnswered', collectionId: null });
    });

    expect(renderer.root.findAll(node => node.props.testID === 'friends-outgoing-2')).toHaveLength(0);
    expect(renderer.root.findAll(node => node.props.testID === 'friends-outgoing-title')).toHaveLength(0);
    expect(renderer.root.findAll(node => node.props.testID === 'friend-2').length).toBeGreaterThan(0);
  });

  describe('while a sent request waits: a short, bounded re-check of the request list only', () => {
    const tick = async (ms: number) => {
      await act(async () => {
        jest.advanceTimersByTime(ms);
      });
    };

    it('re-checks every OUTGOING_POLL_INTERVAL_MS, and an accepted request moves to the friend list without any Push', async () => {
      const renderer = await renderScreen();
      const requestCalls = jest.mocked(getFriendRequests).mock.calls.length;
      const friendCalls = jest.mocked(getFriends).mock.calls.length;

      await tick(OUTGOING_POLL_INTERVAL_MS - 100);
      expect(jest.mocked(getFriendRequests).mock.calls.length).toBe(requestCalls);

      const togepi: Friend = { friendshipId: 2, jupleId: 'TGNG2345', displayName: null, myNote: null, friendsSinceUtc: '' };
      jest.mocked(getFriendRequests).mockResolvedValue([]);
      jest.mocked(getFriends).mockResolvedValue({ items: [togepi, pikachu], nextCursor: null });
      await tick(200);

      expect(jest.mocked(getFriendRequests).mock.calls.length).toBe(requestCalls + 1);
      // Only the request list is polled - the friend list is reloaded once, because one was answered.
      expect(jest.mocked(getFriends).mock.calls.length).toBe(friendCalls + 1);
      expect(renderer.root.findAll(node => node.props.testID === 'friends-outgoing-2')).toHaveLength(0);
      expect(renderer.root.findAll(node => node.props.testID === 'friend-2').length).toBeGreaterThan(0);

      // Nothing pending any more: polling stops.
      await tick(OUTGOING_POLL_INTERVAL_MS * 3);
      expect(jest.mocked(getFriendRequests).mock.calls.length).toBe(requestCalls + 1);
    });

    it('never polls without a sent request, and stops after OUTGOING_POLL_MAX_MS on screen', async () => {
      jest.mocked(getFriendRequests).mockResolvedValue([
        { requestId: 1, jupleId: 'NCMNG234', displayName: '파이리', direction: 'incoming', createdAtUtc: '' },
      ]);
      await renderScreen();
      const onlyIncoming = jest.mocked(getFriendRequests).mock.calls.length;
      await tick(OUTGOING_POLL_INTERVAL_MS * 5);
      expect(jest.mocked(getFriendRequests).mock.calls.length).toBe(onlyIncoming);
      jest.clearAllMocks();

      jest.mocked(getFriends).mockResolvedValue({ items: [pikachu], nextCursor: null });
      jest.mocked(getFriendRequests).mockResolvedValue([
        { requestId: 2, jupleId: 'TGNG2345', displayName: null, direction: 'outgoing', createdAtUtc: '' },
      ]);
      await renderScreen();
      await tick(OUTGOING_POLL_MAX_MS + OUTGOING_POLL_INTERVAL_MS);
      const atCap = jest.mocked(getFriendRequests).mock.calls.length;
      expect(atCap).toBeLessThanOrEqual(1 + OUTGOING_POLL_MAX_MS / OUTGOING_POLL_INTERVAL_MS + 1);
      await tick(OUTGOING_POLL_INTERVAL_MS * 5);
      expect(jest.mocked(getFriendRequests).mock.calls.length).toBe(atCap);
    });

    it('pauses while the app is in the background', async () => {
      const mutableAppState = AppState as unknown as { currentState: unknown };
      const original = mutableAppState.currentState;
      mutableAppState.currentState = 'background';
      try {
        await renderScreen();
        const calls = jest.mocked(getFriendRequests).mock.calls.length;
        await tick(OUTGOING_POLL_INTERVAL_MS * 3);
        expect(jest.mocked(getFriendRequests).mock.calls.length).toBe(calls);
      } finally {
        mutableAppState.currentState = original;
      }
    });
  });

  it('a declined one simply disappears from 보낸 친구 신청', async () => {
    const renderer = await renderScreen();
    jest.mocked(getFriendRequests).mockResolvedValue([]);
    await act(async () => {
      emitSocialPushEvent({ type: 'friendRequestAnswered', collectionId: null });
    });

    expect(renderer.root.findAll(node => node.props.testID === 'friends-outgoing-2')).toHaveLength(0);
    expect(renderer.root.findAll(node => node.props.testID === 'friend-7').length).toBeGreaterThan(0);
  });

  it('the friend modal: my note field has no example text or extra hint, and 친구 삭제 looks destructive', async () => {
    const renderer = await renderScreen();
    await act(async () => {
      renderer.root.findByProps({ testID: 'friend-7' }).props.onPress();
    });

    const detail = renderer.root.findByType(AppModal);
    expect(renderer.root.findByProps({ testID: 'friend-note-input' }).props.placeholder).toBeUndefined();
    const detailTexts = detail.findAllByType(Text).map(node => node.props.children);
    expect(detailTexts).toContain(i18n.t('friends.note'));
    expect(detailTexts.some(text => /나만 볼 수|예:/.test(String(text)))).toBe(false);

    const remove = renderer.root.findAll(node => typeof node.type === 'string' && node.props.testID === 'friend-remove')[0];
    expect(StyleSheet.flatten(remove.props.style).borderColor).toBe(colors.danger);
    expect(StyleSheet.flatten(remove.findByType(Text).props.style).color).toBe(colors.danger);
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
