import { BrokenLinkIcon } from '../../icons/BrokenLinkIcon';
import { InfoIcon } from '../../icons/InfoIcon';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppState, FlatList, Image, Platform, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { FriendsScreen, OUTGOING_POLL_INTERVAL_MS, OUTGOING_POLL_MAX_MS } from '../FriendsScreen';
import { lookupJupleId } from '../../collections/api/collaborationApi';
import { AppModal } from '../../components/AppModal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ImportantState } from '../../components/ImportantState';
import { RefreshFailureNotice } from '../../components/RefreshFailureNotice';
import { UserAvatar } from '../../components/UserAvatar';
import { ChevronIcon } from '../../icons/ChevronIcon';
import { ViewModeToggle } from '../../components/ViewModeToggle';
import { CheckIcon } from '../../icons/CheckIcon';
import { CloseIcon } from '../../icons/CloseIcon';
import { TrashIcon } from '../../icons/TrashIcon';
import { LockIcon } from '../../icons/LockIcon';
import { BlockIcon } from '../../icons/BlockIcon';
import { EditIcon } from '../../icons/EditIcon';
import { FlagIcon } from '../../icons/FlagIcon';
import { UserMinusIcon } from '../../icons/UserMinusIcon';
import { UserIcon } from '../../icons/UserIcon';
import { SearchIcon } from '../../icons/SearchIcon';
import { CopyIcon } from '../../icons/CopyIcon';
import { ActionMenuDialog } from '../../components/ActionMenuDialog';
import { SwipeableItemRow } from '../../components/SwipeableItemRow';
import { colors, radii, spacing, getActiveColorScheme, setActiveColorScheme } from '../../theme/tokens';
import Clipboard from '@react-native-clipboard/clipboard';
import { emitSocialPushEvent } from '../../push/pushEvents';
import { listBlockedUsers } from '../../safety/safetyApi';
import { jupleIdForLookup } from '../../friends/friendIdentity';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  getFriendRequests,
  getFriendSharedCollections,
  getFriends,
  removeFriend,
  sendFriendRequest,
  setFriendNote,
  type Friend,
  type FriendRequest,
} from '../../friends/api/friendsApi';

jest.mock('@react-native-clipboard/clipboard', () => ({ __esModule: true, default: { setString: jest.fn() } }));
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
const mockRoute: { params?: { openRequests?: true; refreshToken?: number } } = {};
const mockNavigation = { setOptions: jest.fn(), navigate: jest.fn(), setParams: jest.fn(params => { mockRoute.params = { ...mockRoute.params, ...params }; }) };
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
  useNavigation: () => mockNavigation,
  useRoute: () => mockRoute,
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../collections/api/collaborationApi', () => ({
  ...jest.requireActual('../../collections/api/collaborationApi'),
  lookupJupleId: jest.fn(),
}));
jest.mock('../../safety/safetyApi', () => ({
  ...jest.requireActual('../../safety/safetyApi'),
  listBlockedUsers: jest.fn(),
  unblockUser: jest.fn(),
}));
jest.mock('../../friends/api/friendsApi', () => ({
  ...jest.requireActual('../../friends/api/friendsApi'),
  getFriends: jest.fn(),
  getFriendSharedCollections: jest.fn(),
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
  mockRoute.params = undefined;
  jest.useFakeTimers();
  jest.mocked(getFriends).mockResolvedValue({ items: [pikachu, noNickname], nextCursor: null });
  jest.mocked(getFriendRequests).mockResolvedValue([incomingCharmander, outgoingTogepi]);
  jest.mocked(getFriendSharedCollections).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(listBlockedUsers).mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

type Renderer = ReactTestRenderer.ReactTestRenderer;
const texts = (renderer: Renderer | ReactTestRenderer.ReactTestInstance) =>
  ('root' in renderer ? renderer.root : renderer).findAllByType(Text).map(node => String(node.props.children));
const exists = (renderer: Renderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID).length > 0;
/** Renders a list's footer/header element on its own. */
function renderPart(element: React.ReactElement) {
  let part!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    part = ReactTestRenderer.create(element);
  });
  return part;
}

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
  it('opens on 친구 with three tabs (친구 · 받은 요청 · 보낸 요청), and 받은 요청 carries its count', async () => {
    const renderer = await renderScreen();

    const tabs = renderer.root.findAll(node => typeof node.type === 'string' && node.props.accessibilityRole === 'tab');
    expect(tabs.map(tab => tab.props.testID)).toEqual(['friends-tab-friends', 'friends-tab-incoming', 'friends-tab-outgoing']);
    expect(byId(renderer, 'friends-tab-friends').props.accessibilityState).toEqual({ selected: true });
    expect(texts(byId(renderer, 'friends-tabs'))).toEqual(expect.arrayContaining([i18n.t('friends.title'), '받은 요청', '보낸 요청']));
    expect(texts(byId(renderer, 'friends-tabs'))).not.toContain(i18n.t('safety.blockedUsers'));
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
    expect(texts(byId(renderer, 'friends-error'))).toEqual(expect.arrayContaining([i18n.t('importantState.loadFailedTitle'), i18n.t('importantState.loadFailedMessage')]));
    expect(byId(renderer, 'friends-error').findAllByType(BrokenLinkIcon)).toHaveLength(1);
    expect(byId(renderer, 'friends-error').findAllByType(InfoIcon)).toHaveLength(0);

    await press(renderer, 'friends-error-retry');
    expect(exists(renderer, 'friend-7')).toBe(true);

    // Loaded once: a failing refresh never blanks the list.
    jest.mocked(getFriends).mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await renderer.root.findByType(FlatList).props.refreshControl.props.onRefresh();
    });
    expect(exists(renderer, 'friend-7')).toBe(true);
    expect(exists(renderer, 'friends-stale')).toBe(true);
    // A compact, non-blocking retry row over the kept list - not a full failure state, not a red line.
    expect(renderer.root.findAllByType(RefreshFailureNotice).map(node => node.props.testID)).toContain('friends-stale');
    expect(renderer.root.findAllByType(ImportantState)).toHaveLength(0);
    expect(exists(renderer, 'friends-action-error')).toBe(false);
    await press(renderer, 'friends-stale-retry');
    expect(exists(renderer, 'friends-stale')).toBe(false);
    expect(exists(renderer, 'friend-7')).toBe(true);
  });

  it('a next page that fails keeps what is listed and offers a compact retry under it', async () => {
    jest.mocked(getFriends).mockResolvedValueOnce({ items: [pikachu], nextCursor: '7' });
    const renderer = await renderScreen();
    jest.mocked(getFriends).mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      renderer.root.findByType(FlatList).props.onEndReached();
    });

    expect(exists(renderer, 'friend-7')).toBe(true);
    const footer = renderPart(renderer.root.findByType(FlatList).props.ListFooterComponent);
    expect(footer.root.findAllByType(RefreshFailureNotice)).toHaveLength(1);
    expect(renderer.root.findAllByType(ImportantState)).toHaveLength(0);
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
    expect(texts(row)).toEqual(['피카츄', '회사 개발팀 김민수', 'K7MP4Q8N']);
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

    expect(texts(row)[0]).toBe('@NNCK2345');
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
    expect(byId(renderer, 'friend-7-id').props.children).toBe('K7MP4Q8N');
    const fallback = byId(renderer, 'friend-8-id');
    expect(fallback.props.children).toBe('NNCK2345');
    expect(fallback.props.numberOfLines).toBe(1);
    expect(texts(byId(renderer, 'friend-8'))[0]).toBe('@NNCK2345');
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
      expect(Clipboard.setString).toHaveBeenCalledWith('@K7MP4Q8N');
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
    // Icon-only actions: the words live in the accessibility labels, not as big text buttons.
    expect(texts(row)).toEqual(expect.arrayContaining(['파이리', '@NCMNG234', '받은 요청']));
    expect(texts(row)).not.toEqual(expect.arrayContaining(['거절']));
    expect(byId(renderer, 'friends-accept-1').findAllByType(CheckIcon)).toHaveLength(1);
    expect(byId(renderer, 'friends-decline-1').findAllByType(CloseIcon)).toHaveLength(1);
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

  const declineDialog = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root.findAllByType(ConfirmDialog).find(candidate => candidate.props.title === i18n.t('friends.declineConfirmTitle'))!;

  it('X asks first (the common centered confirmation) - 취소 leaves the request exactly as it was', async () => {
    const renderer = await renderScreen();
    await openTab(renderer, 'incoming');

    await press(renderer, 'friends-decline-1');

    const dialog = declineDialog(renderer);
    expect(dialog.props.visible).toBe(true);
    expect(dialog.props.message).toBe(i18n.t('friends.declineConfirmMessage'));
    expect(dialog.props.confirmLabel).toBe(i18n.t('collaboration.decline'));
    expect(dialog.props.cancelLabel).toBe(i18n.t('common.cancel'));
    expect(dialog.props.destructive).toBe(true);
    expect(declineFriendRequest).not.toHaveBeenCalled();

    await act(async () => {
      declineDialog(renderer).props.onCancel();
    });
    expect(declineDialog(renderer).props.visible).toBe(false);
    expect(declineFriendRequest).not.toHaveBeenCalled();
    expect(exists(renderer, 'friends-incoming-1')).toBe(true);
    expect(byId(renderer, 'friends-tab-incoming-count').props.children).toBe('1');
  });

  it('declining (after 거절 in the confirmation) removes the row and the count', async () => {
    jest.mocked(declineFriendRequest).mockResolvedValue(undefined);
    const renderer = await renderScreen();
    await openTab(renderer, 'incoming');

    await press(renderer, 'friends-decline-1');
    expect(declineFriendRequest).not.toHaveBeenCalled();
    await act(async () => {
      declineDialog(renderer).props.onConfirm();
    });

    expect(declineFriendRequest).toHaveBeenCalledWith(expect.anything(), 1);
    expect(exists(renderer, 'friends-incoming-1')).toBe(false);
    expect(exists(renderer, 'friends-tab-incoming-count')).toBe(false);
    expect(exists(renderer, 'friends-incoming-empty')).toBe(true);
  });

  it('declining (after the confirmation) a request the sender already cancelled: the stale-request message, the row goes', async () => {
    jest.mocked(declineFriendRequest).mockRejectedValue(new ApiError('notFound', 404, 'requestNoLongerPending'));
    const renderer = await renderScreen();
    await openTab(renderer, 'incoming');
    jest.mocked(getFriendRequests).mockResolvedValue([outgoingTogepi]);

    await press(renderer, 'friends-decline-1');
    await act(async () => {
      declineDialog(renderer).props.onConfirm();
    });

    const dialog = renderer.root.findAllByType(ConfirmDialog).find(candidate => candidate.props.visible)!;
    expect(dialog.props.message).toBe(i18n.t('friends.requestCancelledByRequester'));
    expect(exists(renderer, 'friends-incoming-1')).toBe(false);
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

  it('is one card: the person and compact 44dp icon actions on the same row, no divider line', async () => {
    const renderer = await renderScreen();
    await openTab(renderer, 'incoming');

    for (const testID of ['friends-accept-1', 'friends-decline-1']) {
      const style = StyleSheet.flatten(byId(renderer, testID).props.style);
      expect(style.width).toBeGreaterThanOrEqual(44);
      expect(style.height).toBeGreaterThanOrEqual(44);
    }
    const card = StyleSheet.flatten(byId(renderer, 'friends-incoming-1').props.style);
    expect(card).toMatchObject({ flexDirection: 'row', overflow: 'hidden', marginBottom: 8 });
    expect(card.borderRadius).toBeGreaterThan(0);
    expect(card.borderBottomWidth).toBeUndefined();
    // The person area still opens their profile.
    expect(typeof byId(renderer, 'friends-incoming-person-1').props.onPress).toBe('function');
  });
});

describe('FriendsScreen - 보낸 요청', () => {
  it('one compact row: who and 요청 대기 중, with an icon-only trash at the end that cancels (요청 취소 for screen readers)', async () => {
    jest.mocked(cancelFriendRequest).mockResolvedValue(undefined);
    const renderer = await renderScreen();
    await openTab(renderer, 'outgoing');
    const row = byId(renderer, 'friends-outgoing-2');

    expect(texts(row)).toEqual(expect.arrayContaining(['@TGNG2345', '요청 대기 중']));
    // No big text button under the row - the trash icon is the action, beside the person on the same line.
    expect(texts(row)).not.toContain('요청 취소');
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({ flexDirection: 'row', overflow: 'hidden', marginBottom: 8 });
    const cancel = byId(renderer, 'friends-cancel-2');
    expect(cancel.props.accessibilityLabel).toBe('@TGNG2345 님에게 보낸 친구 요청 취소');
    expect(cancel.findAllByType(TrashIcon)).toHaveLength(1);
    const cancelStyle = StyleSheet.flatten(cancel.props.style);
    expect(cancelStyle.width).toBeGreaterThanOrEqual(44);
    expect(cancelStyle.height).toBeGreaterThanOrEqual(44);

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
    expect(texts(result)).toEqual(expect.arrayContaining(['이상해씨', '@NEWF2345', '친구 요청 보내기']));
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
    const lookupStyle = typeof lookup.props.style === 'function' ? lookup.props.style({ pressed: false }) : lookup.props.style;
    expect(StyleSheet.flatten(lookupStyle)).toEqual(expect.objectContaining({ height: 44, width: 44 }));

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
    expect(texts(modal)).toEqual(expect.arrayContaining(['피카츄', '@K7MP4Q8N', '메모', '메모 저장', '친구 삭제']));
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
    expect(Clipboard.setString).toHaveBeenCalledWith('@K7MP4Q8N');
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

  it('메모 저장 has a save (check) icon like 친구 삭제 has its person-minus - the same button shape, only the color differs', async () => {
    const renderer = await openPikachu();
    const save = byId(renderer, 'friend-note-save');
    const remove = byId(renderer, 'friend-remove');

    expect(save.findAllByType(CheckIcon)).toHaveLength(1);
    expect(texts(save)).toEqual(['메모 저장']);
    expect(remove.findAllByType(UserMinusIcon)).toHaveLength(1);
    expect(texts(remove)).toEqual(['친구 삭제']);
    expect(save.findByType(CheckIcon).props.size).toBe(remove.findByType(UserMinusIcon).props.size);

    const shape = (node: ReactTestRenderer.ReactTestInstance) => {
      const { flexDirection, alignItems, justifyContent, gap, minHeight, borderRadius, borderWidth, paddingHorizontal } = StyleSheet.flatten(node.props.style);
      return { flexDirection, alignItems, justifyContent, gap, minHeight, borderRadius, borderWidth, paddingHorizontal };
    };
    expect(shape(save)).toEqual(shape(remove));
    expect(shape(save).flexDirection).toBe('row');
    expect(shape(save).minHeight).toBeGreaterThanOrEqual(44);
    // Blue default action vs red destructive outline.
    expect(StyleSheet.flatten(save.props.style).backgroundColor).toBe(colors.brand);
    expect(StyleSheet.flatten(remove.props.style).borderColor).toBe(colors.destructiveText);
  });

  it('메모 / 친구 삭제 each carry a meaningful icon AND keep their word - and 신고 / 차단 are no longer friend actions', async () => {
    const renderer = await openPikachu();
    const remove = byId(renderer, 'friend-remove');

    // 메모: a neutral pencil beside the section title (the save button keeps its check).
    expect(renderer.root.findAllByType(EditIcon)).toHaveLength(1);
    expect(renderer.root.findByType(EditIcon).props.color).toBe(colors.textPrimary);
    expect(texts(renderer.root.findByType(EditIcon).parent!)).toEqual(['메모']);
    expect(remove.findByType(UserMinusIcon).props.color).toBe(colors.destructiveText);
    expect(texts(remove)).toEqual(['친구 삭제']);
    expect(StyleSheet.flatten(remove.props.style)).toMatchObject({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' });
    expect(remove.findAllByType(Text)[0].props.numberOfLines).toBe(2);

    // No report / block entry point in a friend's detail (the screen's one BlockIcon is the row that opens 차단한 사용자).
    expect(exists(renderer, 'friend-report')).toBe(false);
    expect(exists(renderer, 'friend-block')).toBe(false);
    expect(renderer.root.findAllByType(FlagIcon)).toHaveLength(0);
    expect(detail(renderer).findAllByType(BlockIcon)).toHaveLength(0);
    const detailTexts = texts(detail(renderer));
    expect(detailTexts).not.toContain(i18n.t('safety.report'));
    expect(detailTexts).not.toContain(i18n.t('safety.block'));
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

      expect(texts(byId(renderer, 'friend-8'))).toEqual(['@NNCK2345', '@NNCK2345', '']);
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

      expect(lines.map(node => node.props.children)).toEqual(['피카츄', '@K7MP4Q8N', '회사 개발팀 김민수']);
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
    expect(tileTexts).toEqual(expect.arrayContaining(['피카츄', '@K7MP4Q8N', '회사 개발팀 김민수']));
    expect(texts(byId(renderer, 'friend-7'))).toEqual(['피카츄', '@K7MP4Q8N', '회사 개발팀 김민수']);
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

describe('FriendsScreen - 차단한 사용자 is a row, not a tab', () => {
  it('Friends has no blocked tab and does not read the blocked list; the row opens the screen that does', async () => {
    const renderer = await renderScreen();
    expect(exists(renderer, 'friends-tab-blocked')).toBe(false);
    await press(renderer, 'friends-tab-incoming');
    await press(renderer, 'friends-tab-outgoing');
    expect(listBlockedUsers).not.toHaveBeenCalled();
    expect(exists(renderer, 'blocked-users-empty')).toBe(false);
    expect(texts(renderer)).toContain(i18n.t('safety.blockedUsers'));
    expect(exists(renderer, 'friends-blocked-users')).toBe(true);
  });
});

describe('FriendsScreen - 함께 공유 중인 컬렉션', () => {
  const mine = { id: 11, name: '여행', icon: 'Folder', color: null, itemCount: 3, isFavorite: false, accessRole: 'owner', hasCollaborators: true } as never;
  const theirs = { id: 12, name: '맛집', icon: 'Folder', color: null, itemCount: 1, isFavorite: false, accessRole: 'contributor', isLocked: true } as never;
  const detail = (renderer: Renderer) => renderer.root.findAllByType(AppModal).find(modal => modal.props.testID === 'friend-detail')!;

  it('is read once for the OPENED friend only - never for the list cards', async () => {
    jest.mocked(getFriendSharedCollections).mockResolvedValue({ items: [mine, theirs], nextCursor: null });
    const renderer = await renderScreen();
    expect(getFriendSharedCollections).not.toHaveBeenCalled();

    await press(renderer, 'friend-7');
    expect(getFriendSharedCollections).toHaveBeenCalledTimes(1);
    expect(getFriendSharedCollections).toHaveBeenCalledWith(expect.any(Function), 7);
    expect(texts(detail(renderer))).toEqual(expect.arrayContaining(['함께 공유 중인 컬렉션 2', '여행', '맛집']));
  });

  it('a Collection opens its Collection Details (and closes the modal); a locked one shows only its lock', async () => {
    jest.mocked(getFriendSharedCollections).mockResolvedValue({ items: [mine, theirs], nextCursor: null });
    const renderer = await renderScreen();
    await press(renderer, 'friend-7');
    expect(byId(renderer, 'friend-shared-12').findAllByType(LockIcon)).toHaveLength(1);
    expect(byId(renderer, 'friend-shared-11').findAllByType(LockIcon)).toHaveLength(0);

    await press(renderer, 'friend-shared-12');
    expect(mockNavigation.navigate).toHaveBeenCalledWith('CollectionDetails', { collectionId: 12 });
    expect(renderer.root.findAllByType(AppModal).some(modal => modal.props.testID === 'friend-detail')).toBe(false);
  });

  it('says so when nothing is shared, and when the list cannot be read - the rest of the friend stays usable', async () => {
    const empty = await renderScreen();
    await press(empty, 'friend-7');
    expect(exists(empty, 'friend-shared-empty')).toBe(true);

    jest.mocked(getFriendSharedCollections).mockRejectedValue(new Error('down'));
    const failed = await renderScreen();
    await press(failed, 'friend-7');
    expect(exists(failed, 'friend-shared-error')).toBe(true);
    expect(exists(failed, 'friend-note-save')).toBe(true);
  });

  it('more than one page is marked with +', async () => {
    jest.mocked(getFriendSharedCollections).mockResolvedValue({ items: [mine], nextCursor: 'next' });
    const renderer = await renderScreen();
    await press(renderer, 'friend-7');
    expect(texts(detail(renderer))).toContain('함께 공유 중인 컬렉션 1+');
  });

  it('더 보기 reads the next page with the server cursor, appends it, and disappears on the last page', async () => {
    const third = { id: 13, name: '독서', icon: 'Folder', color: null, itemCount: 0, isFavorite: false, accessRole: 'viewer' } as never;
    jest.mocked(getFriendSharedCollections)
      .mockResolvedValueOnce({ items: [mine], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [mine, theirs], nextCursor: 'c2' })
      .mockResolvedValueOnce({ items: [third], nextCursor: null });
    const renderer = await renderScreen();
    await press(renderer, 'friend-7');
    expect(exists(renderer, 'friend-shared-more')).toBe(true);

    await press(renderer, 'friend-shared-more');
    expect(getFriendSharedCollections).toHaveBeenLastCalledWith(expect.any(Function), 7, { cursor: 'c1' });
    // a repeated row of the page boundary is not shown twice
    expect(renderer.root.findAll(node => typeof node.props.testID === 'string' && node.props.testID.startsWith('friend-shared-1') && typeof node.props.onPress === 'function' && node.props.testID !== 'friend-shared-more').map(node => node.props.testID)).toEqual(['friend-shared-11', 'friend-shared-12']);
    expect(texts(detail(renderer))).toContain('함께 공유 중인 컬렉션 2+');

    await press(renderer, 'friend-shared-more');
    expect(getFriendSharedCollections).toHaveBeenLastCalledWith(expect.any(Function), 7, { cursor: 'c2' });
    expect(exists(renderer, 'friend-shared-13')).toBe(true);
    expect(exists(renderer, 'friend-shared-more')).toBe(false);
    expect(texts(detail(renderer))).toContain('함께 공유 중인 컬렉션 3');
    expect(getFriendSharedCollections).toHaveBeenCalledTimes(3);
  });

  it('a failed next page keeps the rows and offers a retry; a press while loading sends nothing twice', async () => {
    let finish!: (page: { items: never[]; nextCursor: string | null }) => void;
    jest.mocked(getFriendSharedCollections)
      .mockResolvedValueOnce({ items: [mine], nextCursor: 'c1' })
      .mockRejectedValueOnce(new Error('down'))
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve as never; }));
    const renderer = await renderScreen();
    await press(renderer, 'friend-7');

    await press(renderer, 'friend-shared-more');
    expect(exists(renderer, 'friend-shared-11')).toBe(true);
    expect(exists(renderer, 'friend-shared-more')).toBe(true);
    expect(texts(byId(renderer, 'friend-shared-more'))[0]).toContain(i18n.t('friends.sharedCollectionsFailed'));

    await press(renderer, 'friend-shared-more');
    await press(renderer, 'friend-shared-more');
    expect(getFriendSharedCollections).toHaveBeenCalledTimes(3);
    await act(async () => finish({ items: [], nextCursor: null }));
    expect(exists(renderer, 'friend-shared-more')).toBe(false);
  });

});

describe('FriendsScreen - shared Collections as compact tiles', () => {
  it('each Collection is a vertical tile (icon above, name below, at most two lines) in one horizontal row; lock, label and tap are kept', async () => {
    const items = [
      { id: 21, name: '아주 아주 긴 컬렉션 이름이 두 줄을 넘어가는 경우', icon: 'Folder', color: null, itemCount: 1, isFavorite: false, accessRole: 'owner' },
      { id: 22, name: '잠김', icon: 'Folder', color: null, itemCount: 1, isFavorite: false, accessRole: 'contributor', isLocked: true },
    ] as never;
    jest.mocked(getFriendSharedCollections).mockResolvedValue({ items, nextCursor: null });
    const renderer = await renderScreen();
    await press(renderer, 'friend-7');

    const list = renderer.root.findAll(node => node.props.testID === 'friend-shared-list')[0];
    expect(list.props.horizontal).toBe(true);
    const tile = byId(renderer, 'friend-shared-21');
    expect(StyleSheet.flatten(tile.props.style)).toMatchObject({ alignItems: 'center', width: 84 });
    expect(StyleSheet.flatten(tile.props.style).flexDirection).toBeUndefined();
    expect(tile.findByType(Text).props.numberOfLines).toBe(2);
    expect(StyleSheet.flatten(tile.findByType(Text).props.style).textAlign).toBe('center');
    expect(tile.props.accessibilityLabel).toBe('아주 아주 긴 컬렉션 이름이 두 줄을 넘어가는 경우');
    expect(byId(renderer, 'friend-shared-22').findAllByType(LockIcon)).toHaveLength(1);
  });
});


describe('friend shared collection title spacing on both platforms and themes', () => {
  it.each([
    ['android', 'light'], ['android', 'dark'], ['ios', 'light'], ['ios', 'dark'],
  ] as const)('%s / %s keeps a 16dp title-to-list inset and the existing scroll and tile layout', async (os, scheme) => {
    const previousOS = Platform.OS;
    const previousScheme = getActiveColorScheme();
    let renderer: Renderer | undefined;
    try {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
      setActiveColorScheme(scheme);
      jest.mocked(getFriendSharedCollections).mockResolvedValue({ items: [
        { id: 21, name: 'Shared', icon: 'Folder', color: null, itemCount: 1, isFavorite: false, accessRole: 'owner' },
      ] as never, nextCursor: null });
      renderer = await renderScreen();
      await press(renderer, 'friend-7');
      const list = renderer.root.findAllByType(ScrollView).find(node => node.props.testID === 'friend-shared-list')!;
      expect(list.props.horizontal).toBe(true);
      expect(StyleSheet.flatten(list.props.contentContainerStyle)).toMatchObject({
        paddingTop: 16, paddingBottom: spacing.xs, columnGap: spacing.sm,
      });
      expect(StyleSheet.flatten(byId(renderer, 'friend-shared-21').props.style)).toMatchObject({
        width: 84, paddingHorizontal: spacing.xs, rowGap: spacing.xs,
      });
      expect(renderer.root.findAllByType(ScrollView).some(node =>
        node.props.keyboardShouldPersistTaps === 'handled' && !node.props.horizontal,
      )).toBe(true);
    } finally {
      if (renderer) act(() => renderer!.unmount());
      Object.defineProperty(Platform, 'OS', { configurable: true, value: previousOS });
      setActiveColorScheme(previousScheme);
    }
  });
});

describe('FriendsScreen - the empty state follows the loaded data, not the text field', () => {
  const searchText = '검색 결과가 없어요.';
  const emptyTitle = () => i18n.t('friends.empty');
  const type = async (renderer: Renderer, value: string) => {
    await act(async () => {
      byId(renderer, 'friends-search').props.onChangeText(value);
    });
  };
  const settle = async () => {
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
  };
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
      resolve = done;
    });
    return { promise, resolve };
  };

  it('no results -> text cleared: never says "no friends" while the full list is coming back', async () => {
    const all = deferred<{ items: Friend[]; nextCursor: null }>();
    jest.mocked(getFriends).mockImplementation(async (_request, params) => {
      if (params?.query === '없는사람') {
        return { items: [], nextCursor: null };
      }
      return params?.query === undefined && jest.mocked(getFriends).mock.calls.length >= 3 ? all.promise : { items: [pikachu, noNickname], nextCursor: null };
    });
    const renderer = await renderScreen();
    await type(renderer, '없는사람');
    await settle();
    expect(texts(renderer)).toContain(searchText);

    await type(renderer, '');
    // Before the reload even starts, and while it is in flight: neither empty message.
    expect(texts(renderer)).not.toContain(emptyTitle());
    expect(texts(renderer)).not.toContain(searchText);
    await settle();
    expect(texts(renderer)).not.toContain(emptyTitle());
    expect(exists(renderer, 'friends-loading')).toBe(true);

    await act(async () => {
      all.resolve({ items: [pikachu, noNickname], nextCursor: null });
    });
    expect(exists(renderer, 'friends-empty')).toBe(false);
    expect(texts(renderer)).toContain('피카츄');
  });

  it('keeps showing the friends while a new search is loading', async () => {
    const pending = deferred<{ items: Friend[]; nextCursor: null }>();
    const renderer = await renderScreen();
    jest.mocked(getFriends).mockReturnValueOnce(pending.promise);
    await type(renderer, '피');
    await settle();
    expect(texts(renderer)).toContain('피카츄');
    expect(exists(renderer, 'friends-empty')).toBe(false);
  });

  it('a real friendless account still gets the empty state (and a search with no match says no results)', async () => {
    jest.mocked(getFriends).mockResolvedValue({ items: [], nextCursor: null });
    const renderer = await renderScreen();
    expect(exists(renderer, 'friends-empty')).toBe(true);

    await type(renderer, 'x');
    await settle();
    expect(texts(renderer)).toContain(searchText);
    expect(exists(renderer, 'friends-empty')).toBe(false);

    await type(renderer, '');
    await settle();
    expect(exists(renderer, 'friends-empty')).toBe(true);
  });

  it('an older response arriving after a newer one does not overwrite it', async () => {
    const slow = deferred<{ items: Friend[]; nextCursor: null }>();
    const renderer = await renderScreen();
    jest.mocked(getFriends).mockReturnValueOnce(slow.promise).mockResolvedValueOnce({ items: [noNickname], nextCursor: null });
    await type(renderer, 'a');
    await settle();
    await type(renderer, 'ab');
    await settle();
    await act(async () => {
      slow.resolve({ items: [pikachu], nextCursor: null });
    });
    expect(texts(renderer)).not.toContain('피카츄');
  });
});


describe('received friend request notification entry', () => {
  const noRequestsPopup = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root.findAllByType(AppModal).some(node => node.props.testID === 'received-friend-requests-modal');

  it('selects the 받은 요청 tab (no popup), consumes the intent and can be used again', async () => {
    mockRoute.params = { openRequests: true, refreshToken: 1 };
    const renderer = await renderScreen();
    expect(noRequestsPopup(renderer)).toBe(false);
    expect(renderer.root.findByProps({ testID: 'friends-tab-incoming' }).props.accessibilityState).toMatchObject({ selected: true });
    expect(renderer.root.findAll(node => node.props.testID === 'friends-incoming-list').length).toBeGreaterThan(0);
    expect(mockNavigation.setParams).toHaveBeenCalledWith({ openRequests: undefined, refreshToken: undefined });
    await act(async () => renderer.root.findByProps({ testID: 'friends-tab-friends' }).props.onPress());
    mockRoute.params = { openRequests: true, refreshToken: 2 };
    await act(async () => renderer.update(<FriendsScreen />));
    expect(renderer.root.findByProps({ testID: 'friends-tab-incoming' }).props.accessibilityState).toMatchObject({ selected: true });
    expect(noRequestsPopup(renderer)).toBe(false);
  });

  it('an already answered request entry shows the empty 받은 요청 tab and answers nothing', async () => {
    jest.mocked(getFriendRequests).mockResolvedValue([]);
    mockRoute.params = { openRequests: true, refreshToken: 1 };
    const renderer = await renderScreen();
    expect(noRequestsPopup(renderer)).toBe(false);
    expect(renderer.root.findAll(node => node.props.testID === 'friends-incoming-empty').length).toBeGreaterThan(0);
    expect(acceptFriendRequest).not.toHaveBeenCalled();
    expect(declineFriendRequest).not.toHaveBeenCalled();
  });

  it('a received request offers only 수락 / 거절: its person is not a button (no 신고 / 차단 sheet)', async () => {
    mockRoute.params = { openRequests: true, refreshToken: 1 };
    const renderer = await renderScreen();
    const person = renderer.root.findAll(node => typeof node.props.testID === 'string' && node.props.testID.startsWith('friends-incoming-person-') && typeof node.type !== 'string')[0];
    expect(person.props.disabled).toBe(true);
    expect(renderer.root.findAll(node => typeof node.props.testID === 'string' && node.props.testID.startsWith('friends-accept-')).length).toBeGreaterThan(0);
    expect(renderer.root.findAll(node => typeof node.props.testID === 'string' && node.props.testID.startsWith('friends-decline-')).length).toBeGreaterThan(0);
  });
});
