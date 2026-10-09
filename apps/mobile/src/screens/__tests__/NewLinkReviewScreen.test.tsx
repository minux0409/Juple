import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image, TextInput } from 'react-native';
import i18n from '../../i18n';
import { NewLinkReviewScreen } from '../NewLinkReviewScreen';
import { createCollection, getCollection, getCollections } from '../../collections/api/collectionsApi';
import { saveInboxEntryToCollections } from '../../inbox/api/inboxApi';
import { setItemPreviewImage, updateItemDetails } from '../../items/api/itemsApi';
import { resolveUrlMetadata } from '../../urlMetadata/api/urlMetadataApi';
import { fetchInstagramOpenGraphCandidate } from '../../urlMetadata/instagramOpenGraphFetch';
import { CategoryEditorDialog } from '../../collections/CategoryEditorDialog';
import { CollectionChoiceGrid } from '../../collections/CollectionChoiceGrid';
import { CollectionUnlockDialog } from '../../collections/CollectionUnlockDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { KeyboardSafeView } from '../../components/KeyboardSafeView';
import { getActiveNewLinkReviewDraft } from '../../share/activeNewLinkReviewDraft';
import { ApiError } from '../../api/ApiError';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../config/publicWebConfig', () => ({ publicWebConfig: { host: 'dev.juple.co.kr' } }));
jest.mock('../../collections/api/collectionsApi', () => ({ getCollections: jest.fn(), getCollection: jest.fn(), createCollection: jest.fn() }));
jest.mock('../../inbox/api/inboxApi', () => ({ saveInboxEntryToCollections: jest.fn() }));
jest.mock('../../items/api/itemsApi', () => ({ updateItemDetails: jest.fn(), setItemPreviewImage: jest.fn() }));
jest.mock('../../urlMetadata/api/urlMetadataApi', () => ({ resolveUrlMetadata: jest.fn(), previewInstagramMetadataCandidate: jest.fn() }));
jest.mock('../../urlMetadata/instagramOpenGraphFetch', () => ({
  ...jest.requireActual('../../urlMetadata/instagramOpenGraphFetch'),
  fetchInstagramOpenGraphCandidate: jest.fn(async () => ({ outcome: 'noMetadata', candidate: null })),
}));
jest.mock('../../share/useIncomingShare', () => ({ useIncomingShare: () => ({ acknowledgePendingShare: jest.fn().mockResolvedValue(undefined) }) }));

const make = (id: number, name: string, extra: Record<string, unknown> = {}) =>
  ({ id, name, isFavorite: false, itemCount: 0, createdAtUtc: '', updatedAtUtc: '', icon: 'Folder', color: null, isLocked: false, ...extra });
const reading = make(3, 'Reading');
const games = make(4, 'Games');
const vault = make(5, 'Vault', { isLocked: true });
const routeParams: { url: string; initialTitle: string | null; preselectedCollectionId: number | null } = { url: 'https://example.com/shared?raw=1%2B2', initialTitle: 'Shared title', preselectedCollectionId: null };

async function render(overrides: Partial<typeof routeParams> = {}) {
  const navigation = { goBack: jest.fn(), replace: jest.fn() };
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<NewLinkReviewScreen route={{ params: { ...routeParams, ...overrides } } as never} navigation={navigation as never} />);
  });
  return { tree, navigation };
}

const node = (tree: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  tree.root.find(candidate => candidate.props.testID === testID && typeof candidate.props.onPress === 'function' || candidate.props.testID === testID && candidate.type === TextInput);
const exists = (tree: ReactTestRenderer.ReactTestRenderer, testID: string) => tree.root.findAll(candidate => candidate.props.testID === testID).length > 0;
const option = (tree: ReactTestRenderer.ReactTestRenderer, id: number) => node(tree, `category-picker-option-${id}`);
const isChecked = (tree: ReactTestRenderer.ReactTestRenderer, id: number) => option(tree, id).props.accessibilityState.selected === true;
const saveButton = (tree: ReactTestRenderer.ReactTestRenderer) => node(tree, 'new-link-review-save');
async function tap(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  await act(async () => {
    node(tree, testID).props.onPress();
    await Promise.resolve();
  });
}
async function save(tree: ReactTestRenderer.ReactTestRenderer) {
  await act(async () => {
    await saveButton(tree).props.onPress();
  });
}
const savedWith = () => jest.mocked(saveInboxEntryToCollections).mock.calls[0];

beforeAll(async () => { await i18n.changeLanguage('ko'); });
beforeEach(() => {
  jest.mocked(getCollections).mockImplementation(async (_request, options = {}) =>
    ((options as { scope?: string }).scope === 'shared' ? { items: [], nextCursor: null } : { items: [reading, games, vault], nextCursor: null }) as never);
  jest.mocked(getCollection).mockImplementation(async (_request, id) => ([reading, games, vault].find(entry => entry.id === id) ?? reading) as never);
  jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: null, source: null, previewImageUrl: null });
  jest.mocked(saveInboxEntryToCollections).mockResolvedValue({ id: 55, url: routeParams.url, savedAtUtc: '2026-01-01T00:00:00Z', addedCount: 0, submittedCount: 0, alreadyInCollectionCount: 0, alreadyPendingCount: 0 });
  jest.mocked(updateItemDetails).mockResolvedValue(undefined);
  jest.mocked(setItemPreviewImage).mockResolvedValue(undefined);
});
afterEach(() => { jest.clearAllMocks(); });

describe('링크 저장 - the existing 컬렉션 선택 chooser, many Collections or explicitly none', () => {
  it('reuses the shared Collection chooser (List/Grid, icons) led by [+ 새로 만들기] [선택 안 함]', async () => {
    const { tree } = await render();
    expect(tree.root.findAllByType(CollectionChoiceGrid)).toHaveLength(1);
    const data = tree.root.findAll(candidate => candidate.props.testID === 'category-picker-list')[0].props.data as readonly { kind?: string; id?: number }[];
    expect(data[0]).toEqual({ kind: 'create' });
    expect(data[1]).toEqual({ kind: 'none' });
    expect(data.slice(2).map(entry => entry.id)).toEqual([3, 4, 5]);
    expect(tree.root.findAll(candidate => candidate.props.children === i18n.t('quickSaveComposer.categoryNone')).length).toBeGreaterThan(0);
  });

  it('starts with nothing chosen: Save is disabled and no memo field yet', async () => {
    const { tree } = await render();
    expect(saveButton(tree).props.disabled).toBe(true);
    expect(node(tree, 'category-picker-none').props.accessibilityState.selected).toBe(false);
    expect([3, 4, 5].some(id => isChecked(tree, id))).toBe(false);
    expect(exists(tree, 'save-memo-composer')).toBe(false);
    expect(saveInboxEntryToCollections).not.toHaveBeenCalled();
  });

  it('checks several Collections (each read fresh from the server), and a second tap unchecks one', async () => {
    const { tree } = await render();
    await tap(tree, 'category-picker-option-3');
    await tap(tree, 'category-picker-option-4');
    expect(getCollection).toHaveBeenCalledWith(expect.any(Function), 3);
    expect(getCollection).toHaveBeenCalledWith(expect.any(Function), 4);
    expect(isChecked(tree, 3)).toBe(true);
    expect(isChecked(tree, 4)).toBe(true);
    expect(saveButton(tree).props.disabled).toBe(false);

    await tap(tree, 'category-picker-option-3');
    expect(isChecked(tree, 3)).toBe(false);
    expect(isChecked(tree, 4)).toBe(true);
    // Unchecking reads nothing: it changes nothing on the server yet.
    expect(jest.mocked(getCollection).mock.calls.filter(call => call[1] === 3)).toHaveLength(1);
  });

  it('선택 안 함 clears every checked Collection; checking a Collection clears 선택 안 함', async () => {
    const { tree } = await render();
    await tap(tree, 'category-picker-option-3');
    await tap(tree, 'category-picker-option-4');
    await tap(tree, 'category-picker-none');
    expect(node(tree, 'category-picker-none').props.accessibilityState.selected).toBe(true);
    expect(isChecked(tree, 3) || isChecked(tree, 4)).toBe(false);
    expect(saveButton(tree).props.disabled).toBe(false);

    await tap(tree, 'category-picker-option-4');
    expect(node(tree, 'category-picker-none').props.accessibilityState.selected).toBe(false);
    expect(isChecked(tree, 4)).toBe(true);
  });

  it('saves the link into every checked Collection in ONE request, with the memo', async () => {
    jest.mocked(saveInboxEntryToCollections).mockResolvedValueOnce({ id: 55, url: routeParams.url, savedAtUtc: '', addedCount: 2, submittedCount: 0, alreadyInCollectionCount: 0, alreadyPendingCount: 0 });
    const { tree, navigation } = await render();
    await tap(tree, 'category-picker-option-3');
    await tap(tree, 'category-picker-option-4');
    await act(async () => { node(tree, 'save-memo-composer').props.onChangeText('memo draft'); });
    await save(tree);

    expect(saveInboxEntryToCollections).toHaveBeenCalledTimes(1);
    const [, url, clientRequestId, collectionIds, unlockTokens] = savedWith();
    expect(url).toBe(routeParams.url);
    expect(typeof clientRequestId).toBe('string');
    expect([...collectionIds].sort()).toEqual([3, 4]);
    expect(unlockTokens).toEqual({});
    expect(updateItemDetails).toHaveBeenCalledWith(expect.any(Function), 55, { title: 'Shared title', memo: 'memo draft' });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('선택 안 함 saves with an explicit empty Collection list; the memo stays optional', async () => {
    const { tree, navigation } = await render();
    await tap(tree, 'category-picker-none');
    expect(exists(tree, 'save-memo-composer')).toBe(true);
    await save(tree);
    expect(savedWith()[3]).toEqual([]);
    expect(updateItemDetails).toHaveBeenCalledWith(expect.any(Function), 55, { title: 'Shared title', memo: '' });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('says what happened in 승인 후 추가 Collections in a dialog before leaving', async () => {
    jest.mocked(saveInboxEntryToCollections).mockResolvedValueOnce({ id: 55, url: routeParams.url, savedAtUtc: '', addedCount: 1, submittedCount: 1, alreadyInCollectionCount: 0, alreadyPendingCount: 0 });
    const { tree, navigation } = await render();
    await tap(tree, 'category-picker-option-3');
    await save(tree);
    const dialog = tree.root.findAllByType(ConfirmDialog).find(candidate => candidate.props.visible)!;
    expect(dialog.props.title).toBe(i18n.t('collections.saveOutcomeTitle'));
    expect(navigation.goBack).not.toHaveBeenCalled();
    await act(async () => { dialog.props.onConfirm(); });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('+ 새로 만들기: the new Collection comes back CHECKED next to the ones already checked; memo, link and preview stay', async () => {
    const created = make(9, 'New collection');
    jest.mocked(createCollection).mockResolvedValue(created as never);
    const { tree } = await render();
    await tap(tree, 'category-picker-option-3');
    await act(async () => { node(tree, 'save-memo-composer').props.onChangeText('keep me'); });
    await tap(tree, 'category-picker-create');
    const editor = tree.root.findByType(CategoryEditorDialog);
    await act(async () => { await editor.props.onSubmit('New collection', 'Folder', null, { kind: 'keep' }); });

    expect(isChecked(tree, 9)).toBe(true);
    expect(isChecked(tree, 3)).toBe(true);
    expect(node(tree, 'save-memo-composer').props.value).toBe('keep me');
    expect(exists(tree, 'save-link-preview')).toBe(true);
    await save(tree);
    expect([...savedWith()[3]].sort()).toEqual([3, 9]);
    expect(savedWith()[1]).toBe(routeParams.url);
  });

  it('+ 새로 만들기 after 선택 안 함 switches the choice to the new Collection', async () => {
    jest.mocked(createCollection).mockResolvedValue(make(9, 'New collection') as never);
    const { tree } = await render();
    await tap(tree, 'category-picker-none');
    await tap(tree, 'category-picker-create');
    await act(async () => { await tree.root.findByType(CategoryEditorDialog).props.onSubmit('New collection', 'Folder', null, { kind: 'keep' }); });
    expect(node(tree, 'category-picker-none').props.accessibilityState.selected).toBe(false);
    expect(isChecked(tree, 9)).toBe(true);
  });

  describe('locked destinations - the CURRENT state decides, never the list', () => {
    it('a locked Collection asks for its own password; its grant travels with the save', async () => {
      const { tree } = await render();
      await tap(tree, 'category-picker-option-5');
      const unlock = tree.root.findByType(CollectionUnlockDialog);
      expect(unlock.props.collection?.id).toBe(5);
      expect(isChecked(tree, 5)).toBe(false);
      await act(async () => { unlock.props.onGranted('grant-5'); });
      expect(isChecked(tree, 5)).toBe(true);

      await tap(tree, 'category-picker-option-3');
      await save(tree);
      expect([...savedWith()[3]].sort()).toEqual([3, 5]);
      expect(savedWith()[4]).toEqual({ 5: 'grant-5' });
    });

    it('unlocked elsewhere after the list loaded: checked at once, no stale password prompt', async () => {
      jest.mocked(getCollection).mockImplementation(async (_request, id) => (id === 5 ? { ...vault, isLocked: false } : reading) as never);
      const { tree } = await render();
      await tap(tree, 'category-picker-option-5');
      expect(tree.root.findAllByType(CollectionUnlockDialog)).toHaveLength(0);
      expect(isChecked(tree, 5)).toBe(true);
    });

    it('locked elsewhere after the list loaded: the password is asked for', async () => {
      jest.mocked(getCollection).mockImplementation(async (_request, id) => (id === 4 ? { ...games, isLocked: true } : reading) as never);
      const { tree } = await render();
      await tap(tree, 'category-picker-option-4');
      expect(tree.root.findByType(CollectionUnlockDialog).props.collection?.id).toBe(4);
      expect(isChecked(tree, 4)).toBe(false);
    });

    it('the current state cannot be read: nothing is checked and Save stays disabled', async () => {
      jest.mocked(getCollection).mockRejectedValueOnce(new Error('offline'));
      const { tree } = await render();
      await tap(tree, 'category-picker-option-3');
      expect(isChecked(tree, 3)).toBe(false);
      expect(saveButton(tree).props.disabled).toBe(true);
    });
  });

  it('a share aimed at one Collection starts with it checked - but never a locked one', async () => {
    const shared = await render({ preselectedCollectionId: 3 });
    expect(isChecked(shared.tree, 3)).toBe(true);
    expect(saveButton(shared.tree).props.disabled).toBe(false);

    const locked = await render({ preselectedCollectionId: 5 });
    expect(isChecked(locked.tree, 5)).toBe(false);
    expect(saveButton(locked.tree).props.disabled).toBe(true);
  });

  it('keyboard-safe layout: the chooser fills the room, the memo and Save are a sticky bar under it', async () => {
    const { tree } = await render();
    await tap(tree, 'category-picker-none');
    expect(tree.root.findAllByType(KeyboardSafeView)[0].props.testID).toBe('new-link-review');
    const memo = node(tree, 'save-memo-composer');
    expect(memo.props.multiline).toBe(true);
    expect(memo.props.scrollEnabled).toBe(true);
    expect(memo.props.style.minHeight).toBeGreaterThan(0);
    expect(memo.props.style.maxHeight).toBeLessThanOrEqual(140);
    // Only plain View/Text/TextInput primitives - nothing beyond what API 27 already supports.
    expect(memo.props.placeholder).toBe(i18n.t('item.memoPlaceholder'));
  });

  it('shows the resolved metadata in the compact preview (no title editor) and saves it with the link', async () => {
    jest.mocked(resolveUrlMetadata).mockResolvedValueOnce({ title: 'Resolved title', source: null, previewImageUrl: 'https://example.com/preview.jpg' });
    const { tree } = await render();
    expect(tree.root.findAllByType(Image).some(image => image.props.source?.uri === 'https://example.com/preview.jpg')).toBe(true);
    expect(tree.root.findAll(candidate => candidate.props.testID === 'save-link-title')[0].props.children).toBe('Resolved title');
    // The only text field on this screen is the memo (once a destination is chosen) - no title or URL editor.
    expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
    await tap(tree, 'category-picker-none');
    await save(tree);
    expect(updateItemDetails).toHaveBeenCalledWith(expect.any(Function), 55, { title: 'Resolved title', memo: '' });
    expect(setItemPreviewImage).toHaveBeenCalledWith(expect.any(Function), 55, 'https://example.com/preview.jpg');
  });

  it('keeps the Instagram device fallback: an Instagram link without metadata starts the device fetch once', async () => {
    await render({ url: 'https://www.instagram.com/p/AbCdEf123/', initialTitle: null });
    expect(fetchInstagramOpenGraphCandidate).toHaveBeenCalledTimes(1);
    expect(fetchInstagramOpenGraphCandidate).toHaveBeenCalledWith('https://www.instagram.com/p/AbCdEf123/');
  });

  it('permits saving when metadata resolution fails', async () => {
    jest.mocked(resolveUrlMetadata).mockRejectedValueOnce(new Error('metadata offline'));
    const { tree, navigation } = await render();
    await tap(tree, 'category-picker-none');
    expect(saveButton(tree).props.disabled).toBe(false);
    await save(tree);
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('a failed save shows the common centered dialog and keeps the whole draft', async () => {
    jest.mocked(saveInboxEntryToCollections).mockRejectedValueOnce(new Error('save offline'));
    const { tree, navigation } = await render();
    await tap(tree, 'category-picker-option-3');
    await act(async () => { node(tree, 'save-memo-composer').props.onChangeText('draft'); });
    await save(tree);
    expect(tree.root.findAllByType(ConfirmDialog).some(dialog => dialog.props.visible && dialog.props.message === i18n.t('inbox.errorSaveFallback'))).toBe(true);
    expect(node(tree, 'save-memo-composer').props.value).toBe('draft');
    expect(isChecked(tree, 3)).toBe(true);
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('a Collection share URL opens the Collection and never creates a SavedLink', async () => {
    const { tree, navigation } = await render({ url: 'https://dev.juple.co.kr/c/AbCdEfGh_ijkLMNOpqrSTUV-wxyz0123' });
    await tap(tree, 'category-picker-none');
    await save(tree);
    expect(saveInboxEntryToCollections).not.toHaveBeenCalled();
    expect(navigation.replace).toHaveBeenCalledWith('SharedCollection', expect.any(Object));
  });

  describe('open-draft conflict hand-off re-validates the Collection the next share names', () => {
    const conflicting = (draftCollectionId: number | null, preselectedCollectionId: number | null = null) => ({
      id: 'next', text: 'https://youtu.be/abc?si=xyz', receivedAtEpochMs: Date.now(), initialTitle: 'Next title', preselectedCollectionId, draftTitle: null, draftCollectionId,
    });
    async function handOff(share: ReturnType<typeof conflicting>) {
      const { tree, navigation } = await render();
      await act(async () => { getActiveNewLinkReviewDraft()!.onConflictingShare(share); });
      const dialog = tree.root.findAllByType(ConfirmDialog).find(item => item.props.visible && item.props.title === i18n.t('item.activeDraftConflictTitle'))!;
      await act(async () => { dialog.props.onConfirm(); });
      return navigation.replace;
    }

    it('a usable target is carried into the new review', async () => {
      const replace = await handOff(conflicting(null, 3));

      expect(jest.mocked(getCollection)).toHaveBeenCalledWith(expect.anything(), 3);
      expect(replace).toHaveBeenCalledWith('NewLinkReview', { url: 'https://youtu.be/abc?si=xyz', initialTitle: 'Next title', preselectedCollectionId: 3 });
    });

    it.each([
      ['now locked', async () => { jest.mocked(getCollection).mockResolvedValue(make(5, 'Vault', { isLocked: true }) as never); }],
      ['view-only now', async () => { jest.mocked(getCollection).mockResolvedValue(make(6, 'RO', { accessRole: 'viewer' }) as never); }],
      ['deleted / no access', async () => { jest.mocked(getCollection).mockRejectedValue(new ApiError('notFound', 404)); }],
    ])('a target that is %s is dropped - the URL and title are kept, no other Collection is chosen, and the new review says so', async (_name, arrange) => {
      await arrange();

      const replace = await handOff(conflicting(7));

      expect(replace).toHaveBeenCalledWith('NewLinkReview', {
        url: 'https://youtu.be/abc?si=xyz',
        initialTitle: 'Next title',
        preselectedCollectionId: null,
        destinationUnavailable: true,
      });
    });

    it('a share without a Collection never asks the backend about one', async () => {
      jest.mocked(getCollection).mockClear();

      const replace = await handOff(conflicting(null, null));

      expect(getCollection).not.toHaveBeenCalled();
      expect(replace).toHaveBeenCalledWith('NewLinkReview', expect.objectContaining({ preselectedCollectionId: null }));
    });

    it('the new review shows the destination-unavailable notice once, over the kept draft', async () => {
      const { tree } = await render({ destinationUnavailable: true } as never);

      const notice = tree.root.findAllByType(ConfirmDialog).find(item => item.props.visible && item.props.message === i18n.t('collections.shortcutUnavailable'));
      expect(notice).toBeDefined();
    });
  });

  it('keeps an incoming share conflict visible when Save is not possible yet, and can discard the draft', async () => {
    const { tree, navigation } = await render();
    await act(async () => { getActiveNewLinkReviewDraft()!.onConflictingShare({ id: 'next', text: 'https://example.com/next', receivedAtEpochMs: Date.now(), initialTitle: null, preselectedCollectionId: null, draftTitle: null, draftCollectionId: null }); });
    const dialog = tree.root.findAllByType(ConfirmDialog).find(item => item.props.visible && item.props.title === i18n.t('item.activeDraftConflictTitle'))!;
    await act(async () => { dialog.props.onCancel(); });
    expect(saveInboxEntryToCollections).not.toHaveBeenCalled();
    expect(dialog.props.visible).toBe(true);
    await act(async () => { dialog.props.onConfirm(); });
    expect(navigation.replace).toHaveBeenCalledWith('NewLinkReview', expect.objectContaining({ url: 'https://example.com/next' }));
  });
});
