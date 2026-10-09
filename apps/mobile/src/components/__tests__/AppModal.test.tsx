import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, KeyboardAvoidingView, Modal, StyleSheet, Text } from 'react-native';
import i18n from '../../i18n';
import { AppModal, APP_MODAL_BACKDROP } from '../AppModal';
import { UserAvatar } from '../UserAvatar';
import { FriendPickerModal } from '../../friends/FriendPickerModal';
import { SelectionIndicator } from '../SelectionIndicator';
import { getFriends, type Friend } from '../../friends/api/friendsApi';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 48, left: 0 }),
}));
jest.mock('../../friends/api/friendsApi', () => ({
  ...jest.requireActual('../../friends/api/friendsApi'),
  getFriends: jest.fn(),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

afterEach(() => jest.clearAllMocks());

type Renderer = ReactTestRenderer.ReactTestRenderer;

async function renderModal(props: Partial<Parameters<typeof AppModal>[0]> = {}) {
  const onClose = jest.fn();
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <AppModal onClose={onClose} testID="sample" title="림부기미누기" visible {...props}>
        <Text>body</Text>
      </AppModal>,
    );
  });
  return { renderer, onClose };
}

describe('AppModal - the standard centered modal', () => {
  it('fades in over the whole viewport (status and navigation bars included) - never a sliding sheet', async () => {
    const { renderer } = await renderModal();
    const modal = renderer.root.findByType(Modal);

    expect(modal.props.animationType).toBe('fade');
    expect(modal.props.statusBarTranslucent).toBe(true);
    expect(modal.props.navigationBarTranslucent).toBe(true);
    const backdrop = renderer.root.findByProps({ testID: 'sample-backdrop' });
    expect(backdrop.props.style).toEqual(expect.objectContaining({ backgroundColor: APP_MODAL_BACKDROP, flex: 1 }));
  });

  it('keeps the card inside the real safe-area insets and above the keyboard', async () => {
    const { renderer } = await renderModal();
    // The shared keyboard-safe container: padding avoidance on the outer view, the safe-area padding on the
    // inner one (KeyboardAvoidingView's own padding would replace it).
    const avoiding = renderer.root.findByType(KeyboardAvoidingView);
    expect(avoiding.props.behavior).toBe('padding');
    // The inner view (the second box-none host) carries the frame's padding.
    const inner = avoiding.findAll(node => typeof node.type === 'string' && node.props.pointerEvents === 'box-none' && StyleSheet.flatten(node.props.style)?.paddingTop !== undefined)[0];
    const style = Object.assign({}, ...[inner.props.style].flat(2));
    expect(style.paddingTop).toBeGreaterThanOrEqual(24);
    expect(style.paddingBottom).toBeGreaterThanOrEqual(48);
  });

  it('closes with X, Android back and a backdrop tap - unless it must not be interrupted', async () => {
    const { renderer, onClose } = await renderModal();
    act(() => renderer.root.findByProps({ testID: 'sample-close' }).props.onPress());
    act(() => renderer.root.findByType(Modal).props.onRequestClose());
    act(() => renderer.root.findByProps({ testID: 'sample-backdrop-press' }).props.onPress());
    expect(onClose).toHaveBeenCalledTimes(3);

    const locked = await renderModal({ dismissible: false });
    act(() => locked.renderer.root.findByType(Modal).props.onRequestClose());
    act(() => locked.renderer.root.findByProps({ testID: 'sample-backdrop-press' }).props.onPress());
    expect(locked.onClose).not.toHaveBeenCalled();
  });
});

describe('FriendPickerModal (Share › 친구 선택)', () => {
  const friends: Friend[] = Array.from({ length: 30 }, (_, index) => ({
    friendshipId: index + 1,
    jupleId: `F${String(index).padStart(3, '0')}2345`,
    displayName: `친구 ${index}`,
    myNote: index === 0 ? '회사 개발팀' : null,
    friendsSinceUtc: '',
  }));

  async function renderPicker(onConfirm = jest.fn()) {
    jest.mocked(getFriends).mockResolvedValue({ items: friends, nextCursor: null });
    let renderer!: Renderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <FriendPickerModal
          authenticatedRequest={jest.fn() as never}
          onClose={jest.fn()}
          onConfirm={onConfirm}
          unavailable={new Map([['F0012345', 'member' as const]])}
          visible
        />,
      );
    });
    return renderer;
  }

  it('marks friends with the shared SelectionIndicator: ring, check once chosen, ring when unavailable', async () => {
    const renderer = await renderPicker();
    const indicator = (jupleId: string) => renderer.root.findByProps({ testID: `friend-picker-indicator-${jupleId}` });

    expect(renderer.root.findAllByType(SelectionIndicator).length).toBeGreaterThan(0);
    expect(indicator('F0002345').props.selected).toBe(false);

    act(() => renderer.root.findByProps({ testID: 'friend-picker-F0002345' }).props.onPress());
    expect(indicator('F0002345').props.selected).toBe(true);
    expect(renderer.root.findByProps({ testID: 'friend-picker-F0002345' }).props.accessibilityState).toEqual({ checked: true, disabled: false });

    const unavailable = renderer.root.findByProps({ testID: 'friend-picker-F0012345' });
    expect(unavailable.props.accessibilityState).toEqual({ checked: false, disabled: true });
    expect(indicator('F0012345').props.selected).toBe(false);
  });

  it('is the large centered modal with a searchable, virtualized list', async () => {
    const renderer = await renderPicker();

    expect(renderer.root.findByType(AppModal).props.size).toBe('large');
    expect(renderer.root.findByType(Modal).props.animationType).toBe('fade');
    expect(renderer.root.findByType(FlatList).props.data).toHaveLength(30);

    jest.useFakeTimers();
    act(() => renderer.root.findByProps({ testID: 'friend-picker-search' }).props.onChangeText('개발'));
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    jest.useRealTimers();
    expect(getFriends).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ query: '개발' }));
  });

  it('shows each friend avatar between the checkbox and the name, from the friend list itself (no extra request)', async () => {
    friends[1] = { ...friends[1], profileImageUrl: 'https://img.example/f1.png', profileImageVersion: 'v3' } as Friend;
    const renderer = await renderPicker();

    const row = renderer.root.findByProps({ testID: `friend-picker-${friends[1].jupleId}` });
    const avatar = row.findByType(UserAvatar);
    expect(avatar.props).toEqual(expect.objectContaining({ imageUrl: 'https://img.example/f1.png', imageVersion: 'v3', jupleId: friends[1].jupleId }));
    expect(avatar.props.size).toBeGreaterThanOrEqual(36);
    expect(avatar.props.size).toBeLessThanOrEqual(44);
    expect(getFriends).toHaveBeenCalledTimes(1);
    // Disabled (already a member) rows keep their avatar, and the row is the dimmed one.
    const disabled = renderer.root.findByProps({ testID: 'friend-picker-F0012345' });
    expect(disabled.props.disabled).toBe(true);
    expect(disabled.findAllByType(UserAvatar)).toHaveLength(1);
  });

  describe('empty list message - the same rule as My Page > Friends', () => {
    const typeSearch = async (renderer: Renderer, text: string) => {
      jest.useFakeTimers();
      act(() => renderer.root.findByProps({ testID: 'friend-picker-search' }).props.onChangeText(text));
      await act(async () => {
        jest.advanceTimersByTime(400);
      });
      jest.useRealTimers();
    };
    const emptyText = (renderer: Renderer) => renderer.root.findAllByProps({ testID: 'friend-picker-empty' })[0]?.props.children;

    it('no query and no friends -> 아직 친구가 없어요.', async () => {
      const renderer = await renderPicker();
      jest.mocked(getFriends).mockResolvedValue({ items: [], nextCursor: null });
      await typeSearch(renderer, '');
      await typeSearch(renderer, ' ');
      expect(emptyText(renderer)).toBe(i18n.t('friends.empty'));
    });

    it('a real query with zero matches -> 검색 결과가 없어요. - never the no-friends message, even though I have friends', async () => {
      const renderer = await renderPicker();
      jest.mocked(getFriends).mockResolvedValue({ items: [], nextCursor: null });
      await typeSearch(renderer, '없는이름');
      expect(emptyText(renderer)).toBe(i18n.t('friends.searchEmpty'));
      expect(emptyText(renderer)).not.toBe(i18n.t('friends.empty'));
    });

    it('whitespace only is no query; a matching query lists the match and shows no message', async () => {
      const renderer = await renderPicker();
      jest.mocked(getFriends).mockResolvedValue({ items: [], nextCursor: null });
      await typeSearch(renderer, '   ');
      expect(emptyText(renderer)).toBe(i18n.t('friends.empty'));
      expect(getFriends).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ query: undefined }));

      jest.mocked(getFriends).mockResolvedValue({ items: [friends[0]], nextCursor: null });
      await typeSearch(renderer, '개발');
      expect(emptyText(renderer)).toBeUndefined();
      expect(renderer.root.findAllByProps({ testID: 'friend-picker-F0002345' }).length).toBeGreaterThan(0);
    });
  });

  it('selects any number of friends (never someone already in), shows the count and hands back only ID and name', async () => {
    const onConfirm = jest.fn();
    const renderer = await renderPicker(onConfirm);
    const tap = (jupleId: string) => {
      const row = renderer.root.findByProps({ testID: `friend-picker-${jupleId}` });
      if (!row.props.disabled) {
        act(() => row.props.onPress());
      }
    };

    for (let index = 0; index < 15; index++) {
      tap(`F${String(index).padStart(3, '0')}2345`);
    }
    expect(renderer.root.findByProps({ testID: `friend-picker-F0012345` }).props.disabled).toBe(true);
    expect(renderer.root.findByProps({ testID: 'friend-picker-selected-count' }).props.children).toBe(i18n.t('shareSheet.selectedCount', { count: 14 }));

    act(() => renderer.root.findByProps({ testID: 'friend-picker-confirm' }).props.onPress());
    const picked = onConfirm.mock.calls[0][0] as Friend[];
    expect(picked).toHaveLength(14);
  });
});
