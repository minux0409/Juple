import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { FriendPickerModal } from '../../friends/FriendPickerModal';
import { CollectionLinkShareSheet } from '../CollectionLinkShareSheet';
import { lookupJupleId } from '../api/collaborationApi';
import { sendCollectionShareLink } from '../api/collectionsApi';
import { dragSheet, settleSheet } from '../../testing/sheetGestureDriver';
import { StyleSheet } from 'react-native';

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
    // No explanatory paragraph under the title - just the title, the tabs and the actions.
    expect(shown).not.toContain(i18n.t('linkShare.description'));
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

  it('opens at once - no slide-up animation dragging the dim backdrop up from the bottom', async () => {
    const { renderer } = await renderSheet();
    const { Modal } = require('react-native');
    const sheetModal = renderer.root.findAllByType(Modal).find(modal => modal.findAll(node => node.props.testID === 'link-share-sheet').length > 0)!;

    expect(sheetModal.props.visible).toBe(true);
    expect(sheetModal.props.animationType).toBe('none');
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


const sheetDragArea = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onMoveShouldSetResponder === 'function')[0].props;
const hasHandle = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(node => node.props.testID === 'sheet-handle' && typeof node.type === 'string').length > 0;

describe('CollectionLinkShareSheet - the shared handle', () => {
  it('handle shown above the title and X; a downward drag closes like X (onClose)', async () => {
    const { renderer, callbacks } = await renderSheet();
    expect(hasHandle(renderer)).toBe(true);
    const dragArea = renderer.root.findAll(node => node.props.testID === 'link-share-drag-area' && typeof node.type === 'string')[0];
    expect(dragArea.props.collapsable).toBe(false);
    expect(dragArea.findAll(node => node.props.testID === 'link-share-close').length).toBeGreaterThan(0);
    expect(dragArea.findAll(node => typeof node.type === 'string' && node.props.children === i18n.t('shareSheet.shareLink')).length).toBeGreaterThan(0);
    dragSheet(sheetDragArea(renderer, 'link-share-drag-area'), { dy: 160, durationMs: 600 });
    await settleSheet();
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });
});

/** The shared SheetHeader as rendered in this sheet: the responder view, its title area and its actions. */
function renderedSheetHeader(renderer: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const area = renderer.root.findAll(node => node.props.testID === testID && typeof node.type === 'string')[0];
  const titleArea = area.findAll(node => node.props.testID === 'sheet-header-title' && typeof node.type === 'string')[0];
  const actions = area.findAll(node => node.props.testID === 'sheet-header-actions' && typeof node.type === 'string')[0];
  return { area, titleArea, actions };
}
function expectOneDragSurface(header: ReturnType<typeof renderedSheetHeader>, title: string) {
  // ONE native responder view (never flattened, full width) owns the drag...
  expect(header.area.props.collapsable).toBe(false);
  expect(typeof header.area.props.onStartShouldSetResponder).toBe('function');
  expect(typeof header.area.props.onMoveShouldSetResponderCapture).toBe('function');
  expect(StyleSheet.flatten(header.area.props.style).alignSelf).toBe('stretch');
  // ...and its title area holds the title AND takes the free width (the empty space up to the actions is inside it).
  expect(StyleSheet.flatten(header.titleArea.props.style)).toMatchObject({ flex: 1 });
  expect(header.titleArea.findAll(node => typeof node.type === 'string' && node.props.children === title).length).toBeGreaterThan(0);
  // Nothing inside has handlers of its own: the drag is the outer header's.
  expect(header.titleArea.props.onStartShouldSetResponder).toBeUndefined();
}

describe('CollectionLinkShareSheet - the shared drag header', () => {
  it('title and X in the header; a drag from the title closes it; from X too; X still taps', async () => {
    const { renderer, callbacks } = await renderSheet();
    const header = renderedSheetHeader(renderer, 'link-share-drag-area');
    expectOneDragSurface(header, i18n.t('shareSheet.shareLink'));
    expect(header.actions.findAll(node => node.props.testID === 'link-share-close').length).toBeGreaterThan(0);
    await act(async () => byId(renderer, 'link-share-close').props.onPress());
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);

    expect(dragSheet(header.area.props, { from: 'control', dy: 160, durationMs: 600 })).toBe(true);
    await settleSheet();
    expect(callbacks.onClose).toHaveBeenCalledTimes(2);
    act(() => renderer.unmount());
  });
});
