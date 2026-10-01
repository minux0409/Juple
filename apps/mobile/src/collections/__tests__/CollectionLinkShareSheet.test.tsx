import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { FriendPickerModal } from '../../friends/FriendPickerModal';
import { CollectionLinkShareSheet } from '../CollectionLinkShareSheet';
import { lookupJupleId } from '../api/collaborationApi';
import { sendCollectionShareLink } from '../api/collectionsApi';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../api/collaborationApi', () => ({
  ...jest.requireActual('../api/collaborationApi'),
  lookupJupleId: jest.fn(),
}));
jest.mock('../api/collectionsApi', () => ({
  sendCollectionShareLink: jest.fn(),
  MAX_LINK_SHARE_RECIPIENTS: 3,
}));
jest.mock('../../friends/api/friendsApi', () => ({
  getFriends: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

afterEach(() => jest.clearAllMocks());

const handlers = () => ({ onClose: jest.fn(), onShareExternally: jest.fn(), onSent: jest.fn(), onLinkInactive: jest.fn() });

async function renderSheet(callbacks = handlers()) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <CollectionLinkShareSheet authenticatedRequest={jest.fn() as never} collectionId={5} visible {...callbacks} />,
    );
  });
  return { renderer, callbacks };
}

const byId = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID && (typeof node.props.onPress === 'function' || typeof node.props.onChangeText === 'function'))[0];
const exists = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID).length > 0;
const textOf = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.type === Text && node.props.testID === testID)[0]?.props.children;

async function addId(renderer: ReactTestRenderer.ReactTestRenderer, value: string) {
  await act(async () => byId(renderer, 'link-share-mode-id').props.onPress());
  await act(async () => byId(renderer, 'link-share-id-input').props.onChangeText(value));
  await act(async () => byId(renderer, 'link-share-id-add').props.onPress());
}

describe('CollectionLinkShareSheet', () => {
  it('offers 친구 / ID / 외부 공유 - wording of passing on a link, never of inviting', async () => {
    const { renderer, callbacks } = await renderSheet();

    const shown = JSON.stringify(renderer.root.findAllByType(Text).map(node => node.props.children));
    expect(shown).toContain('친구');
    expect(shown).toContain('ID');
    expect(shown).toContain('외부 공유');
    expect(shown).toContain(i18n.t('linkShare.description'));
    expect(shown).not.toMatch(/초대/);

    await act(async () => byId(renderer, 'link-share-external').props.onPress());
    expect(callbacks.onShareExternally).toHaveBeenCalledTimes(1);
    // Nothing to send yet.
    expect(byId(renderer, 'link-share-send').props.disabled).toBe(true);
  });

  it('ID: checks each Juple ID, lists it once, refuses oneself, and says when nobody has it', async () => {
    jest.mocked(lookupJupleId)
      .mockResolvedValueOnce({ jupleId: 'AAAA2345', isSelf: false, displayName: '피카츄' })
      .mockResolvedValueOnce({ jupleId: 'MEEE2345', isSelf: true })
      .mockRejectedValueOnce(new ApiError('notFound', 404));
    const { renderer } = await renderSheet();

    await addId(renderer, 'aaaa-2345');
    expect(exists(renderer, 'link-share-recipient-AAAA2345')).toBe(true);
    expect(byId(renderer, 'link-share-id-input').props.value).toBe('');

    // The same person again: not looked up, not listed twice.
    await addId(renderer, 'AAAA2345');
    expect(textOf(renderer, 'link-share-id-error')).toBe(i18n.t('shareSheet.duplicateInvitee'));
    expect(lookupJupleId).toHaveBeenCalledTimes(1);

    await addId(renderer, 'MEEE2345');
    expect(textOf(renderer, 'link-share-id-error')).toBe(i18n.t('linkShare.cannotSendSelf'));

    await addId(renderer, 'ZZZZ2345');
    expect(textOf(renderer, 'link-share-id-error')).toBe(i18n.t('collaboration.lookupNotFound'));
    expect(renderer.root.findAll(node => typeof node.props.testID === 'string' && node.props.testID.startsWith('link-share-recipient-') && !node.props.testID.includes('error'))
      .map(node => node.props.testID).filter((id, index, all) => all.indexOf(id) === index)).toEqual(['link-share-recipient-AAAA2345']);
  });

  it('friends: the picker takes the sheet\'s place while open, and the picked friends join the list', async () => {
    const { renderer } = await renderSheet();
    const { Modal } = require('react-native');
    const sheetModal = () => renderer.root.findAllByType(Modal).find(modal => modal.findAll(node => node.props.testID === 'link-share-sheet').length > 0)
      ?? renderer.root.findAllByType(Modal)[0];

    await act(async () => byId(renderer, 'link-share-choose-friends').props.onPress());
    expect(renderer.root.findByType(FriendPickerModal).props.visible).toBe(true);
    expect(sheetModal().props.visible).toBe(false);

    await act(async () => renderer.root.findByType(FriendPickerModal).props.onConfirm([
      { jupleId: 'BBBB2345', displayName: '꼬부기', friendshipId: 1, myNote: null, friendsSinceUtc: '' },
    ]));
    expect(renderer.root.findByType(FriendPickerModal).props.visible).toBe(false);
    expect(exists(renderer, 'link-share-recipient-BBBB2345')).toBe(true);
    // Someone already listed cannot be picked again.
    expect(renderer.root.findByType(FriendPickerModal).props.unavailable.get('BBBB2345')).toBe('added');
  });

  it('sends everyone in one request; a person nobody has any more stays listed with the reason', async () => {
    jest.mocked(lookupJupleId)
      .mockResolvedValueOnce({ jupleId: 'AAAA2345', isSelf: false })
      .mockResolvedValueOnce({ jupleId: 'CCCC2345', isSelf: false });
    jest.mocked(sendCollectionShareLink).mockResolvedValue({ sent: ['AAAA2345'], notFound: ['CCCC2345'] });
    const { renderer, callbacks } = await renderSheet();
    await addId(renderer, 'AAAA2345');
    await addId(renderer, 'CCCC2345');

    await act(async () => byId(renderer, 'link-share-send').props.onPress());

    expect(sendCollectionShareLink).toHaveBeenCalledWith(expect.anything(), 5, ['AAAA2345', 'CCCC2345']);
    expect(callbacks.onSent).not.toHaveBeenCalled();
    expect(exists(renderer, 'link-share-recipient-AAAA2345')).toBe(false);
    expect(textOf(renderer, 'link-share-recipient-error-CCCC2345')).toBe(i18n.t('collaboration.lookupNotFound'));
  });

  it('all sent: reports how many; the link turned off meanwhile: reports that instead - nothing was sent', async () => {
    jest.mocked(lookupJupleId).mockResolvedValue({ jupleId: 'AAAA2345', isSelf: false });
    jest.mocked(sendCollectionShareLink)
      .mockResolvedValueOnce({ sent: ['AAAA2345'], notFound: [] })
      .mockRejectedValueOnce(new ApiError('conflict', 409, 'publicLinkInactive'));
    const { renderer, callbacks } = await renderSheet();
    await addId(renderer, 'AAAA2345');

    await act(async () => byId(renderer, 'link-share-send').props.onPress());
    expect(callbacks.onSent).toHaveBeenCalledWith(1);

    await act(async () => byId(renderer, 'link-share-send').props.onPress());
    expect(callbacks.onLinkInactive).toHaveBeenCalledTimes(1);
  });

  it('never more than the limit at once', async () => {
    jest.mocked(lookupJupleId).mockImplementation(async (_request, jupleId) => ({ jupleId, isSelf: false }));
    const { renderer } = await renderSheet();
    for (const id of ['AAAA2345', 'BBBB2345', 'CCCC2345']) {
      await addId(renderer, id);
    }

    await addId(renderer, 'DDDD2345');

    expect(exists(renderer, 'link-share-recipient-DDDD2345')).toBe(false);
    expect(textOf(renderer, 'link-share-error')).toBe(i18n.t('linkShare.limit', { max: 3 }));
  });
});
