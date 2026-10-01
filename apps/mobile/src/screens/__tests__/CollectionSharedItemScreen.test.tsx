import ReactTestRenderer, { act } from 'react-test-renderer';
import { Linking, Text, TextInput } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { CollectionSharedItemScreen } from '../CollectionSharedItemScreen';
import { getSharedCollectionItem, removeItemReaction, setItemReaction } from '../../collections/api/collectionsApi';
import { ReactionChips } from '../../reactions/ReactionChips';
import { ReactionPickerDialog } from '../../reactions/ReactionPickerDialog';
import { clearCollectionUnlockGrants, rememberCollectionUnlock } from '../../collections/collectionUnlockGrants';
import { UserAvatar } from '../../components/UserAvatar';
import { CrownIcon } from '../../icons/CrownIcon';

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

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

afterEach(() => {
  jest.clearAllMocks();
  clearCollectionUnlockGrants();
});

const route = { key: 'CollectionSharedItem', name: 'CollectionSharedItem', params: { collectionId: 5, itemId: 7 } } as never;

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<CollectionSharedItemScreen navigation={{} as never} route={route} />);
  });
  return renderer;
}

describe('CollectionSharedItemScreen', () => {
  it('shows only the shared fields read-only (title, URL) and opens the link', async () => {
    jest.mocked(getSharedCollectionItem).mockResolvedValue({
      itemId: 7, url: 'https://example.com/a', title: 'Shared title', previewImageUrl: null, addedAtUtc: '2026-01-01T00:00:00Z', isMine: false,
    });
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const renderer = await renderScreen();

    const title = renderer.root.findAllByType(TextInput)[0];
    expect(title.props.value).toBe('Shared title');
    expect(title.props.editable).toBe(false);
    expect(renderer.root.findByProps({ testID: 'shared-item-url' }).props.children).toBe('https://example.com/a');
    // Who saved it, and nothing more - the old "보고 열 수는 있지만…" sentence is gone.
    const shown = renderer.root.findAllByType(Text).map(node => node.props.children);
    expect(shown).toContain('다른 참여자가 저장한 링크입니다.');
    expect(JSON.stringify(shown)).not.toContain('수정할 수는 없습니다');

    await act(async () => {
      await renderer.root.findByProps({ testID: 'shared-item-open' }).props.onPress();
    });
    expect(openSpy).toHaveBeenCalledWith('https://example.com/a');
    openSpy.mockRestore();
  });

  describe('who added it - the same avatar/crown as the List and Grid cards', () => {
    const base = { itemId: 7, url: 'https://example.com/a', title: 'Shared title', previewImageUrl: null, addedAtUtc: '2026-01-01T00:00:00Z', isMine: false };
    const adderBadge = (renderer: ReactTestRenderer.ReactTestRenderer) =>
      renderer.root.findAll(node => node.props.testID === 'shared-item-adder' && node.props.accessible)[0];
    const shownTexts = (renderer: ReactTestRenderer.ReactTestRenderer) =>
      JSON.stringify(renderer.root.findAllByType(Text).map(node => node.props.children));

    it('the Owner: their photo avatar and the crown - no nickname or 소유자 text, but both in the accessibility label', async () => {
      jest.mocked(getSharedCollectionItem).mockResolvedValue({
        ...base,
        addedBy: { kind: 'owner', jupleId: 'K7MP4Q8N', displayName: '피카츄', profileImageUrl: 'https://blob.example/owner.jpg', profileImageVersion: 'v1', isCollectionOwner: true },
      });
      const renderer = await renderScreen();

      const badge = adderBadge(renderer);
      expect(badge.findByType(UserAvatar).props).toEqual(expect.objectContaining({ jupleId: 'K7MP4Q8N', imageUrl: 'https://blob.example/owner.jpg', imageVersion: 'v1' }));
      expect(badge.findAllByType(CrownIcon)).toHaveLength(1);
      expect(badge.props.accessibilityLabel).toBe('컬렉션 소유자 피카츄님이 추가한 링크');
      expect(shownTexts(renderer)).not.toContain('피카츄');
      expect(shownTexts(renderer)).not.toContain(i18n.t('collections.roleOwner'));
      // The line's own heading stays.
      expect(shownTexts(renderer)).toContain(i18n.t('collections.addedByLabel'));
    });

    it('another member without a photo: the fallback avatar, no crown', async () => {
      jest.mocked(getSharedCollectionItem).mockResolvedValue({ ...base, addedBy: { kind: 'member', jupleId: 'CNTRC234', displayName: null } });
      const renderer = await renderScreen();

      const badge = adderBadge(renderer);
      expect(badge.findByType(UserAvatar).props).toEqual(expect.objectContaining({ jupleId: 'CNTRC234', imageUrl: null }));
      expect(badge.findAllByType(CrownIcon)).toHaveLength(0);
      expect(badge.props.accessibilityLabel).toBe('참여자 CNTR-C234님이 추가한 링크');
      expect(shownTexts(renderer)).not.toContain('CNTR-C234');
    });

    it('added through the public link: only that fact - no avatar, no crown, nobody named', async () => {
      jest.mocked(getSharedCollectionItem).mockResolvedValue({ ...base, addedBy: { kind: 'publicLink' } });
      const renderer = await renderScreen();

      const badge = adderBadge(renderer);
      expect(badge.findAllByType(UserAvatar)).toHaveLength(0);
      expect(badge.findAllByType(CrownIcon)).toHaveLength(0);
      expect(shownTexts(renderer)).toContain(i18n.t('collections.addedViaPublicLink'));
    });
  });

  it('sends the stored unlock grant for a locked Category, and explains when it is missing', async () => {
    rememberCollectionUnlock(5, 'grant-5', new Date(Date.now() + 600_000).toISOString());
    jest.mocked(getSharedCollectionItem).mockRejectedValue(new ApiError('forbidden', 403, 'collectionLocked'));

    const renderer = await renderScreen();

    expect(getSharedCollectionItem).toHaveBeenCalledWith(expect.anything(), 5, 7, 'grant-5');
    expect(renderer.root.findAllByType(Text).some(node => node.props.children === i18n.t('collections.lockedMessage'))).toBe(true);
  });
});

describe('CollectionSharedItemScreen - reactions', () => {
  const shared = (overrides = {}) => ({
    itemId: 7, url: 'https://example.com/a', title: 'Shared title', previewImageUrl: null, addedAtUtc: '2026-01-01T00:00:00Z', isMine: false, ...overrides,
  });
  const press = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
    renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];

  it('shows the same reaction chips as the cards, and always the smiley-plus to add one', async () => {
    jest.mocked(getSharedCollectionItem).mockResolvedValue(shared({ reactions: [{ key: 'heart', count: 3 }, { key: 'laugh', count: 1 }], myReaction: 'laugh' }));
    const renderer = await renderScreen();

    expect(renderer.root.findAllByType(ReactionChips)).toHaveLength(1);
    expect(press(renderer, 'shared-item-reactions-heart').props.accessibilityLabel).toBe('❤️ 반응 3개');
    expect(press(renderer, 'shared-item-reactions-laugh').props.accessibilityState).toEqual({ selected: true });
    expect(press(renderer, 'shared-item-reactions-add')).toBeDefined();
  });

  it('with no reactions yet it still offers adding one (the card would stay clean, this screen invites)', async () => {
    jest.mocked(getSharedCollectionItem).mockResolvedValue(shared());
    const renderer = await renderScreen();

    expect(press(renderer, 'shared-item-reactions-add')).toBeDefined();
    expect(renderer.root.findAll(node => String(node.props.testID).startsWith('shared-item-reactions-heart'))).toHaveLength(0);
  });

  it('tapping a chip sets or takes back my reaction on this link', async () => {
    jest.mocked(getSharedCollectionItem).mockResolvedValue(shared({ reactions: [{ key: 'heart', count: 3 }], myReaction: null }));
    jest.mocked(setItemReaction).mockResolvedValue({ reactions: [{ key: 'heart', count: 4 }], myReaction: 'heart' });
    jest.mocked(removeItemReaction).mockResolvedValue({ reactions: [{ key: 'heart', count: 3 }], myReaction: null });
    const renderer = await renderScreen();

    await act(async () => press(renderer, 'shared-item-reactions-heart').props.onPress());
    expect(setItemReaction).toHaveBeenCalledWith(expect.anything(), 5, 7, 'heart', null);
    expect(press(renderer, 'shared-item-reactions-heart').props.accessibilityLabel).toBe('❤️ 반응 4개');

    await act(async () => press(renderer, 'shared-item-reactions-heart').props.onPress());
    expect(removeItemReaction).toHaveBeenCalledWith(expect.anything(), 5, 7, null);
    expect(press(renderer, 'shared-item-reactions-heart').props.accessibilityLabel).toBe('❤️ 반응 3개');
  });

  it('the smiley-plus opens the picker; choosing there sets the reaction and closes it', async () => {
    jest.mocked(getSharedCollectionItem).mockResolvedValue(shared());
    jest.mocked(setItemReaction).mockResolvedValue({ reactions: [{ key: 'fire', count: 1 }], myReaction: 'fire' });
    const renderer = await renderScreen();
    expect(renderer.root.findByType(ReactionPickerDialog).props.visible).toBe(false);

    await act(async () => press(renderer, 'shared-item-reactions-add').props.onPress());
    expect(renderer.root.findByType(ReactionPickerDialog).props.visible).toBe(true);
    await act(async () => press(renderer, 'reaction-option-fire').props.onPress());

    expect(setItemReaction).toHaveBeenCalledWith(expect.anything(), 5, 7, 'fire', null);
    expect(renderer.root.findByType(ReactionPickerDialog).props.visible).toBe(false);
    expect(press(renderer, 'shared-item-reactions-fire')).toBeDefined();
  });

  it('a failure puts the chip back as it was', async () => {
    jest.mocked(getSharedCollectionItem).mockResolvedValue(shared({ reactions: [{ key: 'heart', count: 3 }], myReaction: null }));
    jest.mocked(setItemReaction).mockRejectedValue(new ApiError('unavailable', 503));
    const renderer = await renderScreen();

    await act(async () => press(renderer, 'shared-item-reactions-heart').props.onPress());

    expect(press(renderer, 'shared-item-reactions-heart').props.accessibilityLabel).toBe('❤️ 반응 3개');
    expect(press(renderer, 'shared-item-reactions-heart').props.accessibilityState).toEqual({ selected: false });
  });
});
