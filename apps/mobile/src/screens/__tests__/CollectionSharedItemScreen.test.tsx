import ReactTestRenderer, { act } from 'react-test-renderer';
import { Linking, Text, TextInput } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { CollectionSharedItemScreen } from '../CollectionSharedItemScreen';
import { getSharedCollectionItem, removeItemReaction, setItemReaction } from '../../collections/api/collectionsApi';
import { ReactionChips } from '../../reactions/ReactionChips';
import { CommentComposer } from '../../comments/CommentComposer';
import { addItemComment, deleteItemComment, getItemComments, type ItemComment } from '../../comments/commentsApi';
import { ReactionPickerDialog } from '../../reactions/ReactionPickerDialog';
import { clearCollectionUnlockGrants, rememberCollectionUnlock } from '../../collections/collectionUnlockGrants';
import { UserAvatar } from '../../components/UserAvatar';
import { ActionMenuDialog } from '../../components/ActionMenuDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CrownIcon } from '../../icons/CrownIcon';
import { getFriendRequests, getFriends, sendFriendRequest } from '../../friends/api/friendsApi';

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
  addItemComment: jest.fn(),
  deleteItemComment: jest.fn(),
}));

beforeEach(() => {
  jest.mocked(getItemComments).mockResolvedValue({ items: [], previousCursor: null, totalCount: 0 });
});

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

    describe('tapping the adder avatar is never a dead element', () => {
      const exists = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID).length > 0;
      const tapAdder = async (renderer: ReactTestRenderer.ReactTestRenderer) => {
        await act(async () => {
          renderer.root.findAll(node => node.props.testID === 'shared-item-adder' && typeof node.props.onPress === 'function')[0].props.onPress();
        });
      };
      beforeEach(() => {
        jest.mocked(getFriendRequests).mockResolvedValue([]);
        jest.mocked(getFriends).mockResolvedValue({ items: [], nextCursor: null });
      });

      it('not my friend: user info with a friend-request button (and nothing that removes anyone)', async () => {
        jest.mocked(getSharedCollectionItem).mockResolvedValue({ ...base, addedBy: { kind: 'member', jupleId: 'CNTRC234', displayName: '꼬부기' } });
        jest.mocked(sendFriendRequest).mockResolvedValue({ requestId: 1 } as never);
        const renderer = await renderScreen();
        await tapAdder(renderer);

        expect(exists(renderer, 'person-profile')).toBe(true);
        expect(renderer.root.findAll(node => node.props.testID === 'person-profile-name')[0].props.children).toBe('꼬부기');
        await act(async () => {
          renderer.root.findAll(node => node.props.testID === 'person-profile-send' && typeof node.props.onPress === 'function')[0].props.onPress();
        });
        expect(sendFriendRequest).toHaveBeenCalledWith(expect.anything(), 'CNTRC234');
        expect(JSON.stringify(renderer.root.findAllByType(Text).map(node => node.props.children))).not.toContain(i18n.t('collaboration.remove'));
      });

      it('already my friend: own friend detail instead, no request button', async () => {
        jest.mocked(getFriends).mockResolvedValue({ items: [{ friendshipId: 3, jupleId: 'CNTRC234', displayName: '꼬부기', myNote: null, friendsSinceUtc: '' }], nextCursor: null });
        jest.mocked(getSharedCollectionItem).mockResolvedValue({ ...base, addedBy: { kind: 'member', jupleId: 'CNTRC234', displayName: '꼬부기' } });
        const renderer = await renderScreen();
        await tapAdder(renderer);

        expect(exists(renderer, 'friend-detail')).toBe(true);
        expect(exists(renderer, 'person-profile-send')).toBe(false);
      });

      it('my own link: my identity only, no request, and no friend lookup', async () => {
        jest.mocked(getSharedCollectionItem).mockResolvedValue({ ...base, isMine: true, addedBy: { kind: 'me', jupleId: 'MEEE2345', displayName: '나' } });
        const renderer = await renderScreen();
        await tapAdder(renderer);

        expect(exists(renderer, 'person-profile-status-self')).toBe(true);
        expect(exists(renderer, 'person-profile-send')).toBe(false);
        expect(getFriends).not.toHaveBeenCalled();
      });

      it('an anonymous public-link adder has nobody to open', async () => {
        jest.mocked(getSharedCollectionItem).mockResolvedValue({ ...base, addedBy: { kind: 'publicLink' } });
        const renderer = await renderScreen();
        expect(renderer.root.findAll(node => node.props.testID === 'shared-item-adder' && typeof node.props.onPress === 'function')).toHaveLength(0);
      });
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

describe('CollectionSharedItemScreen - comments', () => {
  const author = (overrides = {}) => ({ jupleId: 'ABCD2345', displayName: '민욱', profileImageUrl: null, profileImageVersion: null, isCollectionOwner: false, isMe: false, ...overrides });
  const comment = (id: number, authorOverrides = {}, body = `comment ${id}`): ItemComment => ({ id, body, createdAtUtc: new Date().toISOString(), author: author(authorOverrides) });
  const link = { itemId: 7, url: 'https://example.com/a', title: 'Shared title', previewImageUrl: null, addedAtUtc: '2026-01-01T00:00:00Z', isMine: false };
  const press = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
    renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];
  const shown = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));
  async function renderWith(params: { isCollectionOwner?: boolean } = {}) {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    const withParams = { key: 'CollectionSharedItem', name: 'CollectionSharedItem', params: { collectionId: 5, itemId: 7, ...params } } as never;
    await act(async () => {
      renderer = ReactTestRenderer.create(<CollectionSharedItemScreen navigation={{} as never} route={withParams} />);
    });
    return renderer;
  }
  const type = async (renderer: ReactTestRenderer.ReactTestRenderer, value: string) =>
    act(async () => composerInput(renderer).props.onChangeText(value));
  const composerInput = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root.findAll(node => node.props.testID === 'comment-input' && node.type === TextInput)[0];

  it('shows the conversation under the link: 댓글 N, the comments oldest first, and the composer', async () => {
    jest.mocked(getSharedCollectionItem).mockResolvedValue(link);
    jest.mocked(getItemComments).mockResolvedValue({ items: [comment(1), comment(2)], previousCursor: null, totalCount: 2 });
    const renderer = await renderWith();

    expect(getItemComments).toHaveBeenCalledWith(expect.anything(), 5, 7, { unlockToken: null });
    expect(shown(renderer)).toContain('댓글 2');
    const order = renderer.root.findAll(node => typeof node.type === 'string' && /^comment-\d+$/.test(String(node.props.testID))).map(node => node.props.testID);
    expect(order).toEqual(['comment-1', 'comment-2']);
    expect(renderer.root.findAllByType(CommentComposer)).toHaveLength(1);
  });

  it('the reaction chips stay above the comments (and the comments are below the link\'s own content)', async () => {
    jest.mocked(getSharedCollectionItem).mockResolvedValue(link);
    const renderer = await renderWith();

    const ids = renderer.root
      .findAll(node => typeof node.type === 'string' && ['shared-item-url', 'shared-item-reactions', 'comments-section', 'comment-composer'].includes(node.props.testID))
      .map(node => node.props.testID);
    expect(ids).toEqual(['shared-item-url', 'shared-item-reactions', 'comments-section', 'comment-composer']);
  });

  it('an empty conversation: the small message, and the composer is still there', async () => {
    jest.mocked(getSharedCollectionItem).mockResolvedValue(link);
    const renderer = await renderWith();

    expect(shown(renderer)).toContain('아직 댓글이 없습니다.');
    expect(shown(renderer)).toContain('댓글 0');
    expect(composerInput(renderer)).toBeDefined();
  });

  it('while the comments load only that section shows a spinner - the link is already on screen', async () => {
    jest.mocked(getSharedCollectionItem).mockResolvedValue(link);
    jest.mocked(getItemComments).mockReturnValue(new Promise(() => undefined));
    const renderer = await renderWith();

    expect(renderer.root.findAll(node => node.props.testID === 'comments-loading').length).toBeGreaterThan(0);
    expect(renderer.root.findByProps({ testID: 'shared-item-url' }).props.children).toBe('https://example.com/a');
  });

  it('sending: the server\'s comment is appended, the count goes up, the field clears - and the link is not loaded again', async () => {
    jest.mocked(getSharedCollectionItem).mockResolvedValue(link);
    jest.mocked(addItemComment).mockResolvedValue(comment(9, { isMe: true }, '이거 괜찮아 보이네'));
    const renderer = await renderWith();
    await type(renderer, '  이거 괜찮아 보이네  ');

    await act(async () => press(renderer, 'comment-send').props.onPress());

    expect(addItemComment).toHaveBeenCalledWith(expect.anything(), 5, 7, '이거 괜찮아 보이네', null);
    expect(shown(renderer)).toContain('이거 괜찮아 보이네');
    expect(shown(renderer)).toContain('댓글 1');
    expect(composerInput(renderer).props.value).toBe('');
    expect(getSharedCollectionItem).toHaveBeenCalledTimes(1);
    expect(getItemComments).toHaveBeenCalledTimes(1);
  });

  it('a failed send keeps the text and can be sent again', async () => {
    jest.mocked(getSharedCollectionItem).mockResolvedValue(link);
    jest.mocked(addItemComment).mockRejectedValueOnce(new ApiError('unavailable', 503)).mockResolvedValueOnce(comment(9, { isMe: true }, 'try'));
    const renderer = await renderWith();
    await type(renderer, 'try');

    await act(async () => press(renderer, 'comment-send').props.onPress());
    expect(composerInput(renderer).props.value).toBe('try');
    expect(shown(renderer)).toContain('댓글 0');

    await act(async () => press(renderer, 'comment-send').props.onPress());
    expect(shown(renderer)).toContain('댓글 1');
    expect(composerInput(renderer).props.value).toBe('');
  });

  it('whitespace-only text cannot be sent', async () => {
    jest.mocked(getSharedCollectionItem).mockResolvedValue(link);
    const renderer = await renderWith();
    await type(renderer, '    ');

    expect(press(renderer, 'comment-send').props.disabled).toBe(true);
    expect(addItemComment).not.toHaveBeenCalled();
  });

  it('deleting my own comment: ... → 댓글 삭제 → confirm; the row leaves and the count drops', async () => {
    jest.mocked(getSharedCollectionItem).mockResolvedValue(link);
    jest.mocked(getItemComments).mockResolvedValue({ items: [comment(1), comment(2, { isMe: true })], previousCursor: null, totalCount: 2 });
    jest.mocked(deleteItemComment).mockResolvedValue(undefined);
    const renderer = await renderWith();
    expect(press(renderer, 'comment-more-1')).toBeUndefined();

    await act(async () => press(renderer, 'comment-more-2').props.onPress());
    await act(async () => renderer.root.findAllByType(ActionMenuDialog).find(dialog => dialog.props.visible)!.props.actions[0].onPress());
    const dialog = renderer.root.findAllByType(ConfirmDialog).find(node => node.props.visible && node.props.title === '댓글을 삭제할까요?')!;
    await act(async () => dialog.props.onConfirm());

    expect(deleteItemComment).toHaveBeenCalledWith(expect.anything(), 5, 7, 2, null);
    expect(renderer.root.findAll(node => node.props.testID === 'comment-2' && typeof node.type === 'string')).toHaveLength(0);
    expect(shown(renderer)).toContain('댓글 1');
    expect(getSharedCollectionItem).toHaveBeenCalledTimes(1);
  });

  it('the Collection\'s Owner may delete someone else\'s comment; a member may not', async () => {
    jest.mocked(getSharedCollectionItem).mockResolvedValue(link);
    jest.mocked(getItemComments).mockResolvedValue({ items: [comment(1), comment(2)], previousCursor: null, totalCount: 2 });

    const asMember = await renderWith();
    expect(press(asMember, 'comment-more-1')).toBeUndefined();
    expect(press(asMember, 'comment-more-2')).toBeUndefined();

    const asOwner = await renderWith({ isCollectionOwner: true });
    expect(press(asOwner, 'comment-more-1')).toBeDefined();
    expect(press(asOwner, 'comment-more-2')).toBeDefined();
  });

  it('older comments: the newest page first, then "이전 댓글 보기" prepends the earlier page without duplicates', async () => {
    jest.mocked(getSharedCollectionItem).mockResolvedValue(link);
    jest.mocked(getItemComments)
      .mockResolvedValueOnce({ items: [comment(8), comment(9)], previousCursor: 8, totalCount: 9 })
      .mockResolvedValueOnce({ items: [comment(6), comment(7), comment(8)], previousCursor: null, totalCount: 9 });
    const renderer = await renderWith();
    expect(shown(renderer)).toContain('이전 댓글 보기');

    await act(async () => press(renderer, 'comments-load-previous').props.onPress());

    expect(getItemComments).toHaveBeenLastCalledWith(expect.anything(), 5, 7, { before: 8, unlockToken: null });
    const order = renderer.root.findAll(node => typeof node.type === 'string' && /^comment-\d+$/.test(String(node.props.testID))).map(node => node.props.testID);
    expect(order).toEqual(['comment-6', 'comment-7', 'comment-8', 'comment-9']);
    expect(shown(renderer)).not.toContain('이전 댓글 보기');
  });

  it('a reaction does not reload the comments or the link; a comment does not reload the reactions', async () => {
    jest.mocked(getSharedCollectionItem).mockResolvedValue({ ...link, reactions: [{ key: 'heart', count: 1 }], myReaction: null });
    jest.mocked(setItemReaction).mockResolvedValue({ reactions: [{ key: 'heart', count: 2 }], myReaction: 'heart' });
    jest.mocked(addItemComment).mockResolvedValue(comment(1, { isMe: true }, 'hi'));
    const renderer = await renderWith();

    await act(async () => press(renderer, 'shared-item-reactions-heart').props.onPress());
    expect(setItemReaction).toHaveBeenCalledTimes(1);
    expect(getItemComments).toHaveBeenCalledTimes(1);
    expect(getSharedCollectionItem).toHaveBeenCalledTimes(1);

    await type(renderer, 'hi');
    await act(async () => press(renderer, 'comment-send').props.onPress());
    expect(setItemReaction).toHaveBeenCalledTimes(1);
    expect(press(renderer, 'shared-item-reactions-heart').props.accessibilityLabel).toBe('❤️ 반응 2개');
    expect(getSharedCollectionItem).toHaveBeenCalledTimes(1);
  });

  it('a lock or an access failure shows the screen\'s own message and no comments UI', async () => {
    jest.mocked(getSharedCollectionItem).mockRejectedValue(new ApiError('forbidden', 403, 'collectionLocked'));
    const renderer = await renderWith();

    expect(renderer.root.findAll(node => node.props.testID === 'comments-section')).toHaveLength(0);
    expect(renderer.root.findAllByType(CommentComposer)).toHaveLength(0);
  });

  it('comments exist only on this member screen: the public Collection screen and its API carry none', () => {
    const read = (relative: string) => require('fs').readFileSync(require('path').resolve(__dirname, relative), 'utf8') as string;

    expect(read('../SharedCollectionScreen.tsx')).not.toMatch(/comment/i);
    expect(read('../../collections/api/publicCollectionsApi.ts')).not.toMatch(/comment/i);
    expect(read('../../collections/usePublicCollectionItems.ts')).not.toMatch(/comment/i);
  });
});
