import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, KeyboardAvoidingView, Modal, Text } from 'react-native';
import i18n from '../../i18n';
import { AppModal, APP_MODAL_BACKDROP } from '../AppModal';
import { FriendPickerModal } from '../../friends/FriendPickerModal';
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
    const frame = renderer.root.findByType(KeyboardAvoidingView);

    expect(frame.props.behavior).toBe('padding');
    const style = Object.assign({}, ...[frame.props.style].flat(2));
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
