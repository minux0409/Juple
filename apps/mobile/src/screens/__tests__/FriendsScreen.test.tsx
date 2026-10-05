import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppState, FlatList, Image, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { FriendsScreen, OUTGOING_POLL_INTERVAL_MS, OUTGOING_POLL_MAX_MS } from '../FriendsScreen';
import { lookupJupleId } from '../../collections/api/collaborationApi';
import { AppModal } from '../../components/AppModal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { UserAvatar } from '../../components/UserAvatar';
import { ChevronIcon } from '../../icons/ChevronIcon';
import { ViewModeToggle } from '../../components/ViewModeToggle';
import { UserIcon } from '../../icons/UserIcon';
import { SearchIcon } from '../../icons/SearchIcon';
import { CopyIcon } from '../../icons/CopyIcon';
import { ActionMenuDialog } from '../../components/ActionMenuDialog';
import { SwipeableItemRow } from '../../components/SwipeableItemRow';
import { colors, radii, spacing } from '../../theme/tokens';
import Clipboard from '@react-native-clipboard/clipboard';
import { emitSocialPushEvent } from '../../push/pushEvents';
import { jupleIdForLookup } from '../../friends/friendIdentity';
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
  type FriendRequest,
} from '../../friends/api/friendsApi';

jest.mock('@react-native-clipboard/clipboard', () => ({ __esModule: true, default: { setString: jest.fn() } }));
jest.mock('../../push/pushPermissionFlow', () => ({ ensurePushPermissionOnce: jest.fn() }));
const mockPrefs = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockPrefs.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockPrefs.set(key, value);
    }),
  },
}));
// The header's [+] is set through navigation options - kept here so a test can render and tap it.
const mockNavigation = { setOptions: jest.fn() };
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
jest.mock('../../collections/api/collaborationApi', () => ({
  ...jest.requireActual('../../collections/api/collaborationApi'),
  lookupJupleId: jest.fn(),
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

const pikachu: Friend = {
  friendshipId: 7,
  jupleId: 'K7MP4Q8N',
  displayName: '피카츄',
  myNote: '회사 개발팀 김민수',
  friendsSinceUtc: '',
  profileImageUrl: 'https://blob.example.test/p/K7MP4Q8N.jpg?sig=1',
  profileImageVersion: 'v1',
};
const noNickname: Friend = { friendshipId: 8, jupleId: 'NNCK2345', displayName: null, myNote: null, friendsSinceUtc: '' };
const incomingCharmander: FriendRequest = {
  requestId: 1,
  jupleId: 'NCMNG234',
  displayName: '파이리',
  direction: 'incoming',
  createdAtUtc: '',
  profileImageUrl: 'https://blob.example.test/p/NCMNG234.jpg?sig=1',
  profileImageVersion: 'v3',
};
const outgoingTogepi: FriendRequest = { requestId: 2, jupleId: 'TGNG2345', displayName: null, direction: 'outgoing', createdAtUtc: '' };

beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(getFriends).mockResolvedValue({ items: [pikachu, noNickname], nextCursor: null });
  jest.mocked(getFriendRequests).mockResolvedValue([incomingCharmander, outgoingTogepi]);
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

type Renderer = ReactTestRenderer.ReactTestRenderer;
const texts = (renderer: Renderer | ReactTestRenderer.ReactTestInstance) =>
  ('root' in renderer ? renderer.root : renderer).findAllByType(Text).map(node => String(node.props.children));
const exists = (renderer: Renderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID).length > 0;
const byId = (renderer: Renderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID && (typeof node.props.onPress === 'function' || typeof node.props.onChangeText === 'function'))[0]
  ?? renderer.root.find(node => node.props.testID === testID);

async function renderScreen() {
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<FriendsScreen />);
  });
  return renderer;
}

async function press(renderer: Renderer, testID: string) {
  await act(async () => {
    await byId(renderer, testID).props.onPress();
  });
}

async function openTab(renderer: Renderer, tab: 'friends' | 'incoming' | 'outgoing') {
  await press(renderer, `friends-tab-${tab}`);
}

/** Renders the header's [+] (set through navigation options) and taps it. */
async function openAddFromHeader(renderer: Renderer) {
  const options = mockNavigation.setOptions.mock.calls.at(-1)![0];
  let header!: Renderer;
  act(() => {
    header = ReactTestRenderer.create(options.headerRight());
  });
  const button = header.root.find(node => node.props.testID === 'friends-add-open' && typeof node.props.onPress === 'function');
  expect(button.props.accessibilityLabel).toBe(i18n.t('friends.add'));
  await act(async () => {
    button.props.onPress();
  });
  return renderer;
}

describe('FriendsScreen - tabs', () => {
  it('opens on 친구 with three tabs, and 받은 요청 carries its count', async () => {
    const renderer = await renderScreen();

    const tabs = renderer.root.findAll(node => typeof node.type === 'string' && node.props.accessibilityRole === 'tab');
    expect(tabs.map(tab => tab.props.testID)).toEqual(['friends-tab-friends', 'friends-tab-incoming', 'friends-tab-outgoing']);
    expect(byId(renderer, 'friends-tab-friends').props.accessibilityState).toEqual({ selected: true });
    expect(texts(byId(renderer, 'friends-tabs'))).toEqual(expect.arrayContaining([i18n.t('friends.title'), '받은 요청', '보낸 요청']));
    expect(byId(renderer, 'friends-tab-incoming-count').props.children).toBe('1');
    expect(byId(renderer, 'friends-tab-outgoing-count').props.children).toBe('1');
    expect(exists(renderer, 'friend-7')).toBe(true);
    expect(exists(renderer, 'friends-incoming-1')).toBe(false);
  });

  it('switching tabs keeps what was loaded - no reload, no blank list', async () => {
    const renderer = await renderScreen();
    const friendCalls = jest.mocked(getFriends).mock.calls.length;
    const requestCalls = jest.mocked(getFriendRequests).mock.calls.length;

    await openTab(renderer, 'incoming');
    expect(exists(renderer, 'friends-incoming-1')).toBe(true);
    await openTab(renderer, 'outgoing');
    expect(exists(renderer, 'friends-outgoing-2')).toBe(true);
    await openTab(renderer, 'friends');
    expect(exists(renderer, 'friend-7')).toBe(true);

    expect(jest.mocked(getFriends).mock.calls.length).toBe(friendCalls);
    expect(jest.mocked(getFriendRequests).mock.calls.length).toBe(requestCalls);
    expect(exists(renderer, 'friends-loading')).toBe(false);
  });

  it('each tab has its own empty state; 친구\'s offers 친구 추가', async () => {
    jest.mocked(getFriends).mockResolvedValue({ items: [], nextCursor: null });
    jest.mocked(getFriendRequests).mockResolvedValue([]);
    const renderer = await renderScreen();

    expect(texts(byId(renderer, 'friends-empty'))).toEqual(expect.arrayContaining(['아직 친구가 없어요.', 'Juple ID로 친구를 추가해 보세요.', i18n.t('friends.add')]));
    await press(renderer, 'friends-empty-add');
    expect(renderer.root.findAllByType(AppModal).some(modal => modal.props.testID === 'friends-add-modal' && modal.props.visible)).toBe(true);
    await act(async () => {
      renderer.root.findAllByType(AppModal).find(modal => modal.props.testID === 'friends-add-modal')!.props.onClose();
    });

    await openTab(renderer, 'incoming');
    expect(texts(byId(renderer, 'friends-incoming-empty'))).toEqual(['받은 친구 요청이 없어요.']);
    await openTab(renderer, 'outgoing');
    expect(texts(byId(renderer, 'friends-outgoing-empty'))).toEqual(['보낸 친구 요청이 없어요.']);
    expect(exists(renderer, 'friends-tab-incoming-count')).toBe(false);
  });

  it('shows a loading state before the first answer', async () => {
    jest.mocked(getFriends).mockReturnValue(new Promise(() => undefined));
    const renderer = await renderScreen();

    expect(exists(renderer, 'friends-loading')).toBe(true);
  });

  it('a first load that fails offers 다시 시도; a later failure keeps the list', async () => {
    jest.mocked(getFriends).mockRejectedValueOnce(new Error('offline'));
    const renderer = await renderScreen();
    expect(texts(byId(renderer, 'friends-error'))).toContain(i18n.t('friends.loadFallback'));

    await press(renderer, 'friends-error-retry');
    expect(exists(renderer, 'friend-7')).toBe(true);

    // Loaded once: a failing refresh never blanks the list.
    jest.mocked(getFriends).mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await renderer.root.findByType(FlatList).props.refreshControl.props.onRefresh();
    });
    expect(exists(renderer, 'friend-7')).toBe(true);
    expect(exists(renderer, 'friends-stale')).toBe(true);
  });

  it('pull to refresh reloads friends and requests once each', async () => {
    const renderer = await renderScreen();
    const friendCalls = jest.mocked(getFriends).mock.calls.length;
    const requestCalls = jest.mocked(getFriendRequests).mock.calls.length;

    await act(async () => {
      await renderer.root.findByType(FlatList).props.refreshControl.props.onRefresh();
    });

    expect(jest.mocked(getFriends).mock.calls.length).toBe(friendCalls + 1);
    expect(jest.mocked(getFriendRequests).mock.calls.length).toBe(requestCalls + 1);
  });

  it('searches only within my friends, once typing settles', async () => {
    const renderer = await renderScreen();
    await act(async () => {
      byId(renderer, 'friends-search').props.onChangeText('피카');
    });
    expect(jest.mocked(getFriends)).not.toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ query: '피카' }));

    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(jest.mocked(getFriends)).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ query: '피카' }));
  });
});

describe('FriendsScreen - a friend row', () => {
  it('shows the photo, name and my memo on ONE line, the Juple ID trailing - no chevron - and opens the friend', async () => {
    const renderer = await renderScreen();
    const row = byId(renderer, 'friend-7');

    const avatar = row.findByType(UserAvatar);
    expect(avatar.props).toEqual(expect.objectContaining({ jupleId: 'K7MP4Q8N', imageUrl: pikachu.profileImageUrl, imageVersion: 'v1', size: 44 }));
    expect(row.findAllByType(Image).length).toBeGreaterThan(0);
    expect(texts(row)).toEqual(['피카츄', '회사 개발팀 김민수', 'K7MP-4Q8N']);
    expect(texts(row).some(text => text.includes('@'))).toBe(false);
    const [name, note] = row.findAllByType(Text);
    // The ID is the trailing, bounded, one-line, muted element - after the content, smaller than the name; the memo keeps its own line.
    const id = byId(renderer, 'friend-7-id');
    const content = row.findAllByType(Text);
    expect(content.indexOf(id)).toBe(content.length - 1);
    expect(id.props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(id.props.style)).toMatchObject({ color: colors.textSecondary, flexShrink: 0 });
    expect(StyleSheet.flatten(id.props.style).fontSize).toBeLessThan(StyleSheet.flatten(name.props.style).fontSize);
    expect(StyleSheet.flatten(id.props.style).maxWidth).toBeDefined();
    expect(name.props.numberOfLines).toBe(1);
    expect(note.props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(note.props.style).fontSize).toBeLessThan(StyleSheet.flatten(name.props.style).fontSize);
    // No right-side chevron.
    expect(row.findAllByType(ChevronIcon)).toHaveLength(0);

    await press(renderer, 'friend-7');
    expect(renderer.root.findAllByType(AppModal).some(modal => modal.props.testID === 'friend-detail')).toBe(true);
  });

  it('without a nickname the @Juple ID is the name (a row needs one), the avatar falls back to a person glyph', async () => {
    const renderer = await renderScreen();
    const row = byId(renderer, 'friend-8');

    expect(texts(row)[0]).toBe('@NNCK-2345');
    expect(row.findAllByType(UserIcon).length).toBeGreaterThan(0);
  });

  it('List: every friend is an individual Home-family card (shared card layout), not a flat divided row', async () => {
    const renderer = await renderScreen();
    const swipe = renderer.root.findAllByType(SwipeableItemRow).find(row => row.props.testID === 'friend-7')!;

    const frame = StyleSheet.flatten(swipe.props.containerStyle);
    expect(frame).toEqual(expect.objectContaining({ backgroundColor: colors.surface, borderRadius: radii.lg }));
    // Cards sit closer together (8dp) than the controls sit above the first card (12dp): the section gap is the larger one.
    expect(frame.marginBottom).toBe(spacing.sm);
    const controls = StyleSheet.flatten(byId(renderer, 'friends-list').props.ListHeaderComponent.props.children[0].props.style);
    expect(controls.marginBottom).toBe(spacing.md);
    expect(controls.marginBottom).toBeGreaterThan(frame.marginBottom as number);
  });

  it('List: the trailing ID is always there - also without a nickname, when the name itself falls back to the @ID', async () => {
    const renderer = await renderScreen();
    expect(byId(renderer, 'friend-7-id').props.children).toBe('K7MP-4Q8N');
    const fallback = byId(renderer, 'friend-8-id');
    expect(fallback.props.children).toBe('NNCK-2345');
    expect(fallback.props.numberOfLines).toBe(1);
    expect(texts(byId(renderer, 'friend-8'))[0]).toBe('@NNCK-2345');
  });

  it('List: a friend with no ID gets no fake trailing value', async () => {
    jest.mocked(getFriends).mockResolvedValue({ items: [{ ...pikachu, jupleId: '' }], nextCursor: null });
    const renderer = await renderScreen();
    expect(exists(renderer, `friend-${pikachu.friendshipId}`)).toBe(true);
    expect(exists(renderer, `friend-${pikachu.friendshipId}-id`)).toBe(false);
  });

  it('a friend without a memo still reserves the memo line, so every row has the same height', async () => {
    const renderer = await renderScreen();

    const withNote = byId(renderer, 'friend-7-note');
    const without = byId(renderer, 'friend-8-note');
    expect(without.props.children).toBe('');
    expect(without.props.numberOfLines).toBe(1);
    const reserved = (node: ReactTestRenderer.ReactTestInstance) => StyleSheet.flatten(node.props.style).minHeight;
    expect(reserved(without)).toBeGreaterThan(0);
    expect(reserved(without)).toBe(reserved(withNote));
  });

  it('List: a left swipe reveals 삭제 only (a friend has nothing to share), confirmed before deleting; no row is wider than the others', async () => {
    jest.mocked(removeFriend).mockResolvedValue(undefined);
    const renderer = await renderScreen();
    const swipe = renderer.root.findAllByType(SwipeableItemRow).find(row => row.props.testID === 'friend-7')!;

    expect(swipe.props.onDelete).toEqual(expect.any(Function));
    expect(swipe.props.onShare).toBeUndefined();
    await act(async () => {
      swipe.props.onDelete();
    });
    expect(removeFriend).not.toHaveBeenCalled();
    const confirm = renderer.root.findAllByType(ConfirmDialog).find(dialog => dialog.props.visible)!;
    expect(confirm.props.title).toBe('이 친구를 삭제할까요?');
    await act(async () => {
      await confirm.props.onConfirm();
    });

    expect(removeFriend).toHaveBeenCalledWith(expect.anything(), 7);
    expect(exists(renderer, 'friend-7')).toBe(false);
  });

  describe('long press: the compact action popup (the swipe and the tap stay as they are)', () => {
    const menu = (renderer: Renderer) => renderer.root.findAllByType(ActionMenuDialog).find(dialog => dialog.props.visible);
    afterEach(() => mockPrefs.clear());

    it('List: [copy icon] Juple ID 복사 and [trash icon] 친구 삭제; copying writes the ID as shown', async () => {
      const renderer = await renderScreen();
      expect(menu(renderer)).toBeUndefined();

      await act(async () => {
        byId(renderer, 'friend-7').props.onLongPress();
      });

      const open = menu(renderer)!;
      expect(open.props.actions.map((action: { label: string }) => action.label)).toEqual(['Juple ID 복사', '친구 삭제']);
      expect(open.props.actions[0].icon).toBe(CopyIcon);
      expect(open.props.actions[1].destructive).toBe(true);
      // A long press never opened the detail.
      expect(renderer.root.findAllByType(AppModal).some(modal => modal.props.testID === 'friend-detail')).toBe(false);

      await act(async () => {
        open.props.actions[0].onPress();
      });
      // (iOS waits for the menu to finish closing - its onDismiss - before acting; Android acts at once.)
      await act(async () => {
        renderer.root.findByType(ActionMenuDialog).props.onDismiss();
      });
      expect(Clipboard.setString).toHaveBeenCalledWith('@K7MP-4Q8N');
      expect(menu(renderer)).toBeUndefined();
    });

    it('삭제 from the popup asks first, then removes', async () => {
      jest.mocked(removeFriend).mockResolvedValue(undefined);
      const renderer = await renderScreen();
      await act(async () => {
        byId(renderer, 'friend-7').props.onLongPress();
      });

      await act(async () => {
        menu(renderer)!.props.actions[1].onPress();
      });
      await act(async () => {
        renderer.root.findByType(ActionMenuDialog).props.onDismiss();
      });
      expect(removeFriend).not.toHaveBeenCalled();
      const confirm = renderer.root.findAllByType(ConfirmDialog).find(dialog => dialog.props.visible)!;
      await act(async () => {
        await confirm.props.onConfirm();
      });

      expect(removeFriend).toHaveBeenCalledWith(expect.anything(), 7);
      expect(exists(renderer, 'friend-7')).toBe(false);
    });

    it('Grid: the same popup on a long press, and the tap still opens the friend', async () => {
      mockPrefs.set('juple.friendsViewMode', 'grid');
      const renderer = await renderScreen();

      await act(async () => {
        byId(renderer, 'friend-7').props.onLongPress();
      });
      expect(menu(renderer)!.props.actions.map((action: { label: string }) => action.label)).toEqual(['Juple ID 복사', '친구 삭제']);
      await act(async () => {
        menu(renderer)!.props.onCancel();
      });
      expect(menu(renderer)).toBeUndefined();

      await press(renderer, 'friend-7');
      expect(renderer.root.findAllByType(AppModal).some(modal => modal.props.testID === 'friend-detail')).toBe(true);
    });
  });

  it('the search field carries a (non-tappable) person icon at its start, and still searches', async () => {
    const renderer = await renderScreen();

    const icon = byId(renderer, 'friends-search-icon');
    expect(icon.findAllByType(UserIcon)).toHaveLength(1);
    expect(icon.props.pointerEvents).toBe('none');
    expect(icon.props.onPress).toBeUndefined();
    expect(byId(renderer, 'friends-search').props.accessibilityLabel).toBe(i18n.t('friends.search'));
  });

  it('without a photo, the nickname\'s first letter', async () => {
    jest.mocked(getFriends).mockResolvedValue({ items: [{ ...pikachu, profileImageUrl: null, profileImageVersion: null }], nextCursor: null });
    const renderer = await renderScreen();

    expect(texts(byId(renderer, 'friend-7'))).toContain('피');
  });

  it('a long nickname is cut to one line, never pushing the row out', async () => {
    jest.mocked(getFriends).mockResolvedValue({ items: [{ ...pikachu, displayName: '아주아주아주아주아주아주긴닉네임'.repeat(3) }], nextCursor: null });
    const renderer = await renderScreen();

    const name = byId(renderer, 'friend-7').findAllByType(Text)[0];
    expect(name.props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(name.parent!.props.style)).toEqual(expect.objectContaining({ flex: 1, minWidth: 0 }));
  });
});

describe('FriendsScreen - 받은 요청', () => {
  it('shows the requester\'s photo from the list itself (no lookup per person), with 거절 and 수락', async () => {
    const renderer = await renderScreen();
    await openTab(renderer, 'incoming');
    const row = byId(renderer, 'friends-incoming-1');

    expect(row.findByType(UserAvatar).props).toEqual(expect.objectContaining({ imageUrl: incomingCharmander.profileImageUrl, imageVersion: 'v3' }));
    expect(texts(row)).toEqual(expect.arrayContaining(['파이리', '@NCMN-G234', '거절', '수락']));
    expect(lookupJupleId).not.toHaveBeenCalled();
    expect(byId(renderer, 'friends-accept-1').props.accessibilityLabel).toBe('파이리 님의 친구 요청 수락');
    expect(byId(renderer, 'friends-decline-1').props.accessibilityLabel).toBe('파이리 님의 친구 요청 거절');
  });

  it('accepting busies only that row, ignores a second tap, then moves them to 친구 and lowers the count', async () => {
    const second: FriendRequest = { ...incomingCharmander, requestId: 3, jupleId: 'SCND2345', displayName: '꼬부기' };
    jest.mocked(getFriendRequests).mockResolvedValue([incomingCharmander, second, outgoingTogepi]);
    let answer!: (friend: Friend) => void;
    jest.mocked(acceptFriendRequest).mockImplementation(() => new Promise<Friend>(resolve => {
      answer = resolve;
    }));
    const renderer = await renderScreen();
    await openTab(renderer, 'incoming');
    expect(byId(renderer, 'friends-tab-incoming-count').props.children).toBe('2');

    act(() => {
      byId(renderer, 'friends-accept-1').props.onPress();
    });
    act(() => {
      byId(renderer, 'friends-accept-1').props.onPress();
    });
    expect(acceptFriendRequest).toHaveBeenCalledTimes(1);
    expect(byId(renderer, 'friends-accept-1').props.disabled).toBe(true);
    expect(exists(renderer, 'friends-request-busy-1')).toBe(true);
    // The other row - and the rest of the screen - stay usable.
    expect(byId(renderer, 'friends-accept-3').props.disabled).toBe(false);
    expect(exists(renderer, 'friends-loading')).toBe(false);

    const charmander: Friend = { friendshipId: 11, jupleId: 'NCMNG234', displayName: '파이리', myNote: null, friendsSinceUtc: '' };
    await act(async () => {
      answer(charmander);
    });

    expect(exists(renderer, 'friends-incoming-1')).toBe(false);
    expect(byId(renderer, 'friends-tab-incoming-count').props.children).toBe('1');
    await openTab(renderer, 'friends');
    expect(exists(renderer, 'friend-11')).toBe(true);
  });

  it('declining removes the row and the count', async () => {
    jest.mocked(declineFriendRequest).mockResolvedValue(undefined);
    const renderer = await renderScreen();
    await openTab(renderer, 'incoming');

    await press(renderer, 'friends-decline-1');

    expect(declineFriendRequest).toHaveBeenCalledWith(expect.anything(), 1);
    expect(exists(renderer, 'friends-incoming-1')).toBe(false);
    expect(exists(renderer, 'friends-tab-incoming-count')).toBe(false);
    expect(exists(renderer, 'friends-incoming-empty')).toBe(true);
  });

  it('a request the sender already cancelled shows a centered message, removes the stale row and refetches', async () => {
    jest.mocked(acceptFriendRequest).mockRejectedValue(new ApiError('notFound', 404, 'requestNoLongerPending'));
    const renderer = await renderScreen();
    await openTab(renderer, 'incoming');

    // The server no longer has the request when it is refetched.
    jest.mocked(getFriendRequests).mockResolvedValue([outgoingTogepi]);

    await press(renderer, 'friends-accept-1');

    const dialog = renderer.root.findAllByType(ConfirmDialog).find(candidate => candidate.props.visible)!;
    expect(dialog.props.title).toBe(i18n.t('friends.requestDialogTitle'));
    expect(dialog.props.message).toBe(i18n.t('friends.requestCancelledByRequester'));
    expect(exists(renderer, 'friends-action-error')).toBe(false);
    expect(exists(renderer, 'friends-incoming-1')).toBe(false);
  });

  it('puts the actions on their own line, each at least a touch target tall', async () => {
    const renderer = await renderScreen();
    await openTab(renderer, 'incoming');

    for (const testID of ['friends-accept-1', 'friends-decline-1']) {
      const style = StyleSheet.flatten(byId(renderer, testID).props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
      expect(style.flexGrow).toBe(1);
    }
    const row = byId(renderer, 'friends-incoming-1');
    expect(StyleSheet.flatten(row.props.style).flexDirection).not.toBe('row');
  });
});

describe('FriendsScreen - 보낸 요청', () => {
  it('shows who, 요청 대기 중 and 요청 취소 (supported by the API)', async () => {
    jest.mocked(cancelFriendRequest).mockResolvedValue(undefined);
    const renderer = await renderScreen();
    await openTab(renderer, 'outgoing');
    const row = byId(renderer, 'friends-outgoing-2');

    expect(texts(row)).toEqual(expect.arrayContaining(['@TGNG-2345', '요청 대기 중', '요청 취소']));
    expect(byId(renderer, 'friends-cancel-2').props.accessibilityLabel).toBe('@TGNG-2345 님에게 보낸 친구 요청 취소');

    await press(renderer, 'friends-cancel-2');
    expect(cancelFriendRequest).toHaveBeenCalledWith(expect.anything(), 2);
    expect(exists(renderer, 'friends-outgoing-2')).toBe(false);
  });

  it('a friend request arriving while the screen is open shows up without leaving it', async () => {
    const renderer = await renderScreen();
    const calls = jest.mocked(getFriendRequests).mock.calls.length;

    await act(async () => {
      emitSocialPushEvent({ type: 'friendRequest', collectionId: null });
    });

    expect(jest.mocked(getFriendRequests).mock.calls.length).toBeGreaterThan(calls);
    expect(exists(renderer, 'friend-7')).toBe(true);
  });

  it('a sent request being accepted leaves 보낸 요청 and joins 친구 at once (Push)', async () => {
    const renderer = await renderScreen();
    await openTab(renderer, 'outgoing');
    expect(exists(renderer, 'friends-outgoing-2')).toBe(true);

    const togepi: Friend = { friendshipId: 2, jupleId: 'TGNG2345', displayName: null, myNote: null, friendsSinceUtc: '' };
    jest.mocked(getFriendRequests).mockResolvedValue([incomingCharmander]);
    jest.mocked(getFriends).mockResolvedValue({ items: [togepi, pikachu], nextCursor: null });
    await act(async () => {
      emitSocialPushEvent({ type: 'friendRequestAnswered', collectionId: null });
    });

    expect(exists(renderer, 'friends-outgoing-2')).toBe(false);
    await openTab(renderer, 'friends');
    expect(exists(renderer, 'friend-2')).toBe(true);
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
      expect(exists(renderer, 'friend-2')).toBe(true);
      await openTab(renderer, 'outgoing');
      expect(exists(renderer, 'friends-outgoing-2')).toBe(false);

      // Nothing pending any more: polling stops.
      await tick(OUTGOING_POLL_INTERVAL_MS * 3);
      expect(jest.mocked(getFriendRequests).mock.calls.length).toBe(requestCalls + 1);
    });

    it('never polls without a sent request, and stops after OUTGOING_POLL_MAX_MS on screen', async () => {
      jest.mocked(getFriendRequests).mockResolvedValue([incomingCharmander]);
      await renderScreen();
      const onlyIncoming = jest.mocked(getFriendRequests).mock.calls.length;
      await tick(OUTGOING_POLL_INTERVAL_MS * 5);
      expect(jest.mocked(getFriendRequests).mock.calls.length).toBe(onlyIncoming);
      jest.clearAllMocks();

      jest.mocked(getFriends).mockResolvedValue({ items: [pikachu], nextCursor: null });
      jest.mocked(getFriendRequests).mockResolvedValue([outgoingTogepi]);
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

    it('polls whichever tab is showing - it follows the screen, not the tab', async () => {
      const renderer = await renderScreen();
      await openTab(renderer, 'incoming');
      const calls = jest.mocked(getFriendRequests).mock.calls.length;

      await tick(OUTGOING_POLL_INTERVAL_MS + 10);

      expect(jest.mocked(getFriendRequests).mock.calls.length).toBe(calls + 1);
    });
  });
});

describe('FriendsScreen - 친구 추가', () => {
  const lookupResult = (overrides: Partial<Awaited<ReturnType<typeof lookupJupleId>>> = {}) => ({
    jupleId: 'NEWF2345',
    isSelf: false,
    displayName: '이상해씨',
    profileImageUrl: 'https://blob.example.test/p/NEWF2345.jpg?sig=1',
    profileImageVersion: 'v9',
    ...overrides,
  });

  async function lookUp(renderer: Renderer, input: string) {
    await act(async () => {
      byId(renderer, 'friends-add-input').props.onChangeText(input);
    });
    await press(renderer, 'friends-add-lookup');
  }

  it('the header\'s [+] (labelled 친구 추가) opens it; a Juple ID - "@" and hyphen allowed - finds the person with their photo', async () => {
    jest.mocked(lookupJupleId).mockResolvedValue(lookupResult());
    const renderer = await renderScreen();
    await openAddFromHeader(renderer);
    expect(texts(renderer)).toContain('Juple ID로 친구를 찾아보세요.');

    await lookUp(renderer, '@newf-2345');

    expect(lookupJupleId).toHaveBeenCalledWith(expect.anything(), 'newf-2345');
    const result = byId(renderer, 'friends-add-result');
    expect(result.findByType(UserAvatar).props).toEqual(expect.objectContaining({ imageUrl: 'https://blob.example.test/p/NEWF2345.jpg?sig=1', imageVersion: 'v9' }));
    expect(texts(result)).toEqual(expect.arrayContaining(['이상해씨', '@NEWF-2345', '친구 요청 보내기']));
  });

  it('only drops a leading "@" - everything else is the server\'s to normalize', () => {
    expect(jupleIdForLookup(' @k7mp-4q8n ')).toBe('k7mp-4q8n');
    expect(jupleIdForLookup('K7MP 4Q8N')).toBe('K7MP 4Q8N');
  });

  it('shows the lookup in progress and blocks a second one', async () => {
    jest.mocked(lookupJupleId).mockReturnValue(new Promise(() => undefined));
    const renderer = await renderScreen();
    await openAddFromHeader(renderer);
    await act(async () => {
      byId(renderer, 'friends-add-input').props.onChangeText('NEWF2345');
    });

    act(() => {
      byId(renderer, 'friends-add-lookup').props.onPress();
    });
    act(() => {
      byId(renderer, 'friends-add-lookup').props.onPress();
    });

    expect(lookupJupleId).toHaveBeenCalledTimes(1);
    const lookup = renderer.root.findAll(node => node.props.testID === 'friends-add-lookup' && node.props.accessibilityState)[0];
    expect(lookup.props.accessibilityState).toEqual({ disabled: true, busy: true });
  });

  it('찾기 is a magnifying-glass icon button: still labelled 찾기, a full touch target, disabled until there is an ID', async () => {
    const renderer = await renderScreen();
    await openAddFromHeader(renderer);

    const lookup = renderer.root.findAll(node => node.props.testID === 'friends-add-lookup' && node.props.accessibilityState)[0];
    expect(lookup.findAllByType(SearchIcon)).toHaveLength(1);
    expect(lookup.findAllByType(Text)).toHaveLength(0);
    expect(lookup.props.accessibilityLabel).toBe('찾기');
    expect(lookup.props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(StyleSheet.flatten(lookup.props.style)).toEqual(expect.objectContaining({ height: 44, width: 44 }));

    await act(async () => {
      byId(renderer, 'friends-add-input').props.onChangeText('NEWF2345');
    });
    const ready = renderer.root.findAll(node => node.props.testID === 'friends-add-lookup' && node.props.accessibilityState)[0];
    expect(ready.props.accessibilityState).toEqual({ disabled: false, busy: false });
  });

  it.each([
    ['self', lookupResult({ isSelf: true }), '자기 자신은 추가할 수 없어요.'],
    ['friend', lookupResult({ jupleId: 'K7MP4Q8N', displayName: '피카츄' }), '이미 친구예요.'],
    ['pending', lookupResult({ jupleId: 'TGNG2345', displayName: null }), '요청 대기 중'],
    ['incoming', lookupResult({ jupleId: 'NCMNG234', displayName: '파이리' }), '이 사용자에게서 받은 친구 요청이 있어요.'],
  ] as const)('%s: says so instead of offering a request', async (relationship, found, message) => {
    jest.mocked(lookupJupleId).mockResolvedValue(found);
    const renderer = await renderScreen();
    await openAddFromHeader(renderer);

    await lookUp(renderer, found.jupleId);

    expect(exists(renderer, 'friends-add-send')).toBe(false);
    expect(texts(byId(renderer, `friends-add-status-${relationship}`))).toEqual([message]);
  });

  it('someone who already asked me: 받은 요청 보기 goes to that tab', async () => {
    jest.mocked(lookupJupleId).mockResolvedValue(lookupResult({ jupleId: 'NCMNG234', displayName: '파이리' }));
    const renderer = await renderScreen();
    await openAddFromHeader(renderer);
    await lookUp(renderer, 'NCMNG234');

    await press(renderer, 'friends-add-show-incoming');

    expect(byId(renderer, 'friends-tab-incoming').props.accessibilityState).toEqual({ selected: true });
    expect(exists(renderer, 'friends-incoming-1')).toBe(true);
  });

  it('sends once (a second tap is ignored), then shows 요청 대기 중 and the request in 보낸 요청', async () => {
    jest.mocked(lookupJupleId).mockResolvedValue(lookupResult());
    let answer!: (request: FriendRequest) => void;
    jest.mocked(sendFriendRequest).mockImplementation(() => new Promise<FriendRequest>(resolve => {
      answer = resolve;
    }));
    const renderer = await renderScreen();
    await openAddFromHeader(renderer);
    await lookUp(renderer, 'NEWF2345');

    act(() => {
      byId(renderer, 'friends-add-send').props.onPress();
    });
    act(() => {
      byId(renderer, 'friends-add-send').props.onPress();
    });
    expect(sendFriendRequest).toHaveBeenCalledTimes(1);
    expect(sendFriendRequest).toHaveBeenCalledWith(expect.anything(), 'NEWF2345');

    await act(async () => {
      answer({ requestId: 30, jupleId: 'NEWF2345', displayName: '이상해씨', direction: 'outgoing', createdAtUtc: '' });
    });

    // Only the relationship state remains - the redundant "친구 요청을 보냈어요." sentence is gone.
    expect(exists(renderer, 'friends-add-message')).toBe(false);
    expect(texts(byId(renderer, 'friends-add-status-pending'))).toEqual(['요청 대기 중']);
    expect(byId(renderer, 'friends-tab-outgoing-count').props.children).toBe('2');
    await act(async () => {
      renderer.root.findAllByType(AppModal).find(modal => modal.props.testID === 'friends-add-modal')!.props.onClose();
    });
    await openTab(renderer, 'outgoing');
    expect(exists(renderer, 'friends-outgoing-30')).toBe(true);
  });

  it('a rate limit reads as such - not a generic failure', async () => {
    jest.mocked(lookupJupleId).mockRejectedValue(new ApiError('tooManyRequests', 429));
    const renderer = await renderScreen();
    await openAddFromHeader(renderer);

    await lookUp(renderer, 'NEWF2345');

    expect(texts(byId(renderer, 'friends-add-message'))).toEqual([i18n.t('collaboration.tooManyRequests')]);
  });

  it('the server knowing better (already asked) is shown and the lists are reloaded', async () => {
    jest.mocked(lookupJupleId).mockResolvedValue(lookupResult());
    jest.mocked(sendFriendRequest).mockRejectedValue(new ApiError('conflict', 409, 'requestPending'));
    const renderer = await renderScreen();
    await openAddFromHeader(renderer);
    await lookUp(renderer, 'NEWF2345');
    const requestCalls = jest.mocked(getFriendRequests).mock.calls.length;

    await press(renderer, 'friends-add-send');

    expect(texts(byId(renderer, 'friends-add-message'))).toEqual([i18n.t('friends.requestAlreadyPending')]);
    expect(jest.mocked(getFriendRequests).mock.calls.length).toBe(requestCalls + 1);
  });
});

describe('FriendsScreen - a friend', () => {
  async function openPikachu() {
    const renderer = await renderScreen();
    await press(renderer, 'friend-7');
    return renderer;
  }
  const detail = (renderer: Renderer) => renderer.root.findAllByType(AppModal).find(modal => modal.props.testID === 'friend-detail')!;

  it('shows ONE identity section (photo 72, name, @Juple ID with a copy button) and 메모 beneath - nothing repeated, no 나에게만 보여요', async () => {
    const renderer = await openPikachu();
    const modal = detail(renderer);

    expect(modal.findByType(UserAvatar).props).toEqual(expect.objectContaining({ size: 72, imageUrl: pikachu.profileImageUrl }));
    expect(texts(modal)).toEqual(expect.arrayContaining(['피카츄', '@K7MP-4Q8N', '메모', '메모 저장', '친구 삭제']));
    expect(texts(modal)).not.toContain('내 메모');
    expect(texts(modal)).not.toContain('나에게만 보여요');
    expect(exists(renderer, 'friend-note-helper')).toBe(false);
    // The nickname appears once (the title is the generic 친구, not the friend's name again).
    expect(texts(modal).filter(text => text === '피카츄')).toHaveLength(1);
    expect(modal.props.title).toBe('친구');
    expect(byId(renderer, 'friend-note-input').props.value).toBe('회사 개발팀 김민수');
    expect(byId(renderer, 'friend-note-input').props.placeholder).toBeUndefined();
  });

  it('the Juple ID has a copy icon right beside it that writes the ID to the clipboard', async () => {
    const renderer = await openPikachu();

    const copy = byId(renderer, 'friend-detail-copy-id');
    expect(copy.props.accessibilityLabel).toBe('Juple ID 복사');
    expect(detail(renderer).findAllByType(CopyIcon)).toHaveLength(1);
    // Same row as the ID text: the nearest row-direction ancestor of the ID holds the copy button too.
    let row: ReactTestRenderer.ReactTestInstance | null = byId(renderer, 'friend-detail-juple-id');
    while (row && StyleSheet.flatten(row.props.style)?.flexDirection !== 'row') {
      row = row.parent;
    }
    expect(row).not.toBeNull();
    expect(row!.findAll(node => node.props.testID === 'friend-detail-copy-id').length).toBeGreaterThan(0);
    await act(async () => {
      copy.props.onPress();
    });
    expect(Clipboard.setString).toHaveBeenCalledWith('@K7MP-4Q8N');
  });

  it('saves the note only on 메모 저장 (once), and the list shows it at once', async () => {
    let answer!: (friend: Friend) => void;
    jest.mocked(setFriendNote).mockImplementation(() => new Promise<Friend>(resolve => {
      answer = resolve;
    }));
    const renderer = await openPikachu();
    await act(async () => {
      byId(renderer, 'friend-note-input').props.onChangeText('대학 동기');
    });
    expect(setFriendNote).not.toHaveBeenCalled();

    act(() => {
      byId(renderer, 'friend-note-save').props.onPress();
    });
    act(() => {
      byId(renderer, 'friend-note-save').props.onPress();
    });
    expect(setFriendNote).toHaveBeenCalledTimes(1);
    expect(setFriendNote).toHaveBeenCalledWith(expect.anything(), 7, '대학 동기');

    await act(async () => {
      answer({ ...pikachu, myNote: '대학 동기' });
    });
    await act(async () => {
      detail(renderer).props.onClose();
    });
    expect(texts(byId(renderer, 'friend-7'))).toContain('대학 동기');
  });

  it('a failed save keeps both what was typed and the note the list shows', async () => {
    jest.mocked(setFriendNote).mockRejectedValue(new Error('offline'));
    const renderer = await openPikachu();
    await act(async () => {
      byId(renderer, 'friend-note-input').props.onChangeText('대학 동기');
    });

    await press(renderer, 'friend-note-save');

    expect(texts(byId(renderer, 'friend-detail-error'))).toEqual([i18n.t('friends.actionFallback')]);
    expect(byId(renderer, 'friend-note-input').props.value).toBe('대학 동기');
    await act(async () => {
      detail(renderer).props.onClose();
    });
    expect(texts(byId(renderer, 'friend-7'))).toContain('회사 개발팀 김민수');
  });

  it('removes only after 이 친구를 삭제할까요? is confirmed, then closes and leaves the list', async () => {
    jest.mocked(removeFriend).mockResolvedValue(undefined);
    const renderer = await openPikachu();
    const removeButton = byId(renderer, 'friend-remove');
    expect(StyleSheet.flatten(removeButton.props.style).borderColor).toBeDefined();

    await press(renderer, 'friend-remove');
    expect(removeFriend).not.toHaveBeenCalled();
    const confirm = renderer.root.findAllByType(ConfirmDialog).find(dialog => dialog.props.visible)!;
    expect(confirm.props.title).toBe('이 친구를 삭제할까요?');
    // The modal cannot be dismissed while the confirmation is open.
    expect(detail(renderer).props.dismissible).toBe(false);

    await act(async () => {
      await confirm.props.onConfirm();
    });

    expect(removeFriend).toHaveBeenCalledWith(expect.anything(), 7);
    expect(renderer.root.findAllByType(AppModal).some(modal => modal.props.testID === 'friend-detail')).toBe(false);
    expect(exists(renderer, 'friend-7')).toBe(false);
  });
});

describe('FriendsScreen - narrow screens and accessibility', () => {
  it('tab labels may wrap to two lines rather than be cut, and each tab is a full touch target', async () => {
    const renderer = await renderScreen();

    for (const tab of ['friends', 'incoming', 'outgoing']) {
      const button = byId(renderer, `friends-tab-${tab}`);
      expect(StyleSheet.flatten(button.props.style)).toEqual(expect.objectContaining({ flex: 1, minHeight: 44, minWidth: 0 }));
      expect(button.findAllByType(Text)[0].props.numberOfLines).toBe(2);
    }
  });

  it('long notes stay on one line and the modal scrolls instead of overflowing', async () => {
    jest.mocked(getFriends).mockResolvedValue({ items: [{ ...pikachu, myNote: '긴 메모 '.repeat(60) }], nextCursor: null });
    const renderer = await renderScreen();

    expect(byId(renderer, 'friend-7-note').props.numberOfLines).toBe(1);
    await press(renderer, 'friend-7');
    expect(renderer.root.findAllByType(AppModal).find(modal => modal.props.testID === 'friend-detail')!.findAllByType(ScrollView).length).toBeGreaterThan(0);
  });

  it('never shows an email or any raw image URL as text', async () => {
    const renderer = await renderScreen();
    for (const tab of ['friends', 'incoming', 'outgoing'] as const) {
      await openTab(renderer, tab);
      expect(texts(renderer).some(text => text.includes('@example') || text.includes('https://'))).toBe(false);
    }
    expect(renderer.root.findAllByType(TextInput).every(input => input.props.accessibilityLabel)).toBe(true);
  });
});

describe('FriendsScreen - List / Grid', () => {
  beforeEach(() => mockPrefs.clear());

  it('shows the shared List/Grid switch on the far end of the search row; List is the default', async () => {
    const renderer = await renderScreen();

    const toggle = renderer.root.findByType(ViewModeToggle);
    const row = toggle.parent!;
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({ flexDirection: 'row' });
    const children = row.children as ReactTestRenderer.ReactTestInstance[];
    expect(children[children.length - 1]).toBe(toggle);
    expect(children[0].findByProps({ testID: 'friends-search' })).toBeDefined();
    expect(renderer.root.findByProps({ testID: 'friends-list' }).props.numColumns).toBe(1);
  });

  describe('Grid tile: avatar / name / @ID / memo', () => {
    const toGrid = async (renderer: Renderer) => {
      await act(async () => {
        renderer.root.findByType(ViewModeToggle).props.onChange('grid');
      });
    };

    it('without a nickname the name falls back to the @ID and the ID line STILL shows it', async () => {
      const renderer = await renderScreen();
      await toGrid(renderer);

      expect(texts(byId(renderer, 'friend-8'))).toEqual(['@NNCK-2345', '@NNCK-2345', '']);
    });

    it('a friend with no ID gets an empty reserved ID line - nothing is made up - and every tile has the same line structure', async () => {
      jest.mocked(getFriends).mockResolvedValue({ items: [pikachu, noNickname, { ...pikachu, friendshipId: 9, jupleId: '', displayName: '이름만', myNote: null }], nextCursor: null });
      const renderer = await renderScreen();
      await toGrid(renderer);

      expect(byId(renderer, 'friend-9-id').props.children).toBe('');
      expect(texts(byId(renderer, 'friend-9'))).toEqual(['이름만', '', '']);
      const structure = (id: number) => byId(renderer, `friend-${id}`).findAllByType(Text).map(node => `${node.props.numberOfLines}:${StyleSheet.flatten(node.props.style).minHeight ?? 0}`);
      expect(structure(7)).toHaveLength(3);
      expect(structure(8)).toEqual(structure(7));
      expect(structure(9)).toEqual(structure(7));
    });

    it('memo and ID together: the ID sits between the name and the memo, both on one line; tap and long press are unchanged', async () => {
      const renderer = await renderScreen();
      await toGrid(renderer);
      const lines = byId(renderer, 'friend-7').findAllByType(Text);

      expect(lines.map(node => node.props.children)).toEqual(['피카츄', '@K7MP-4Q8N', '회사 개발팀 김민수']);
      expect(lines.every(node => node.props.numberOfLines === 1)).toBe(true);
      await press(renderer, 'friend-7');
      expect(renderer.root.findAllByType(AppModal).some(modal => modal.props.testID === 'friend-detail')).toBe(true);
    });
  });

  it('Grid keeps every friend action (the tile opens the friend) with the same identity content, and persists', async () => {
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByType(ViewModeToggle).props.onChange('grid');
    });

    expect(renderer.root.findByProps({ testID: 'friends-list' }).props.numColumns).toBe(2);
    expect(mockPrefs.get('juple.friendsViewMode')).toBe('grid');
    const tileTexts = texts(renderer);
    // The tile shows avatar, name, the @Juple ID and the one-line memo - in that order.
    expect(tileTexts).toEqual(expect.arrayContaining(['피카츄', '@K7MP-4Q8N', '회사 개발팀 김민수']));
    expect(texts(byId(renderer, 'friend-7'))).toEqual(['피카츄', '@K7MP-4Q8N', '회사 개발팀 김민수']);
    expect(byId(renderer, 'friend-7-id').props.numberOfLines).toBe(1);
    const idStyle = StyleSheet.flatten(byId(renderer, 'friend-7-id').props.style);
    expect(idStyle.fontSize).toBeLessThan(StyleSheet.flatten(byId(renderer, 'friend-7').findAllByType(Text)[0].props.style).fontSize);
    expect(idStyle.color).toBe(colors.textSecondary);
    expect(byId(renderer, 'friend-7-note').props.numberOfLines).toBe(1);
    expect(exists(renderer, 'friend-8-note')).toBe(true);
    // Same avatar component as List (photo, else initial/glyph).
    expect(renderer.root.findAllByType(UserAvatar).length).toBeGreaterThanOrEqual(2);
    await press(renderer, 'friend-7');
    expect(renderer.root.findAllByType(AppModal).some(modal => modal.props.testID === 'friend-detail')).toBe(true);
  });

  it('restores a saved Grid preference, and switching back to List persists too', async () => {
    mockPrefs.set('juple.friendsViewMode', 'grid');
    const renderer = await renderScreen();
    expect(renderer.root.findByProps({ testID: 'friends-list' }).props.numColumns).toBe(2);

    await act(async () => {
      renderer.root.findByType(ViewModeToggle).props.onChange('list');
    });
    expect(renderer.root.findByProps({ testID: 'friends-list' }).props.numColumns).toBe(1);
    expect(mockPrefs.get('juple.friendsViewMode')).toBe('list');
  });
});
