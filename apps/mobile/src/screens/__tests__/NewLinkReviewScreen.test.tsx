import ReactTestRenderer, { act } from 'react-test-renderer';
import { ScrollView, Text, TextInput } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import i18n from '../../i18n';
import { NewLinkReviewScreen } from '../NewLinkReviewScreen';
import { addItemToCollection, createCollection, getCollections } from '../../collections/api/collectionsApi';
import { saveInboxEntry } from '../../inbox/api/inboxApi';
import { setItemCoverImage, setItemPreviewImage, updateItemDetails } from '../../items/api/itemsApi';
import { uploadItemImage, type ItemImage } from '../../images/api/imagesApi';
import { resolveUrlMetadata, type UrlMetadataSource } from '../../urlMetadata/api/urlMetadataApi';
import { checkUrlSafety } from '../../urlSafety/api/urlSafetyApi';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../collections/api/collectionsApi', () => ({
  getCollections: jest.fn(),
  addItemToCollection: jest.fn(),
  createCollection: jest.fn(),
}));

jest.mock('../../inbox/api/inboxApi', () => ({
  saveInboxEntry: jest.fn(),
}));

jest.mock('../../items/api/itemsApi', () => ({
  updateItemDetails: jest.fn(),
  setItemPreviewImage: jest.fn(),
  setItemCoverImage: jest.fn(),
}));

jest.mock('../../images/api/imagesApi', () => ({
  uploadItemImage: jest.fn(),
}));

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(),
}));

jest.mock('../../urlMetadata/api/urlMetadataApi', () => ({
  resolveUrlMetadata: jest.fn(),
}));

jest.mock('../../urlSafety/api/urlSafetyApi', () => ({
  checkUrlSafety: jest.fn(),
}));

function makeUploadedImage(overrides: Partial<ItemImage> = {}): ItemImage {
  return {
    id: 9,
    contentType: 'image/jpeg',
    byteLength: 1000,
    sortOrder: 0,
    createdAtUtc: new Date().toISOString(),
    readUrl: 'https://blob.example/9.jpg',
    ...overrides,
  };
}

const ROUTE_PARAMS: { url: string; initialTitle: string | null; preselectedCollectionId: number | null } = {
  url: 'https://example.com/shared',
  initialTitle: 'Shared title',
  preselectedCollectionId: null,
};

function makeProps(routeParamOverrides: Partial<typeof ROUTE_PARAMS> = {}) {
  return {
    route: { params: { ...ROUTE_PARAMS, ...routeParamOverrides }, key: 'r', name: 'NewLinkReview' as const },
    navigation: { goBack: jest.fn() },
  } as any;
}

async function renderScreen(routeParamOverrides: Partial<typeof ROUTE_PARAMS> = {}) {
  const props = makeProps(routeParamOverrides);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<NewLinkReviewScreen {...props} />);
  });
  return { renderer, navigation: props.navigation };
}

function findByAccessibilityLabel(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAll(node => node.props.accessibilityLabel === label)[0];
}

/** Opens the shared "카테고리 선택" picker modal (see CategoryField/CategoryPickerModal) - the same
 * component ItemDetailsScreen uses, reached by tapping the category summary row's own
 * accessibilityLabel (item.categoryEditA11y). Fetches the collection pool on open (no mount-time
 * fetch unless preselectedCollectionId is set - see this screen's own remarks), so callers must
 * flush a microtask afterward before the modal's option rows are queryable. */
async function openCategoryPicker(renderer: ReactTestRenderer.ReactTestRenderer): Promise<void> {
  await act(async () => {
    findByAccessibilityLabel(renderer, i18n.t('item.categoryEditA11y'))?.props.onPress();
    await Promise.resolve();
  });
}

/** The 2nd photo thumbnail's "첫 번째로 설정" accessibility action - see PhotoListEditor.tsx. With
 * MAX_EFFECTIVE_IMAGES capped at 2, this is the only possible non-trivial reorder in a 2-photo
 * list (index 1 -> index 0), so it exercises the exact same onReorder(1, 0) contract a real
 * drag-past-the-midpoint gesture would - see twoSlotDrag.test.ts for the drag geometry itself. */
function findReorderToFrontAction(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(
    node => Array.isArray(node.props.accessibilityActions) && node.props.accessibilityActions.length > 0,
  )[0];
}

/** The Save button doesn't set accessibilityLabel, so it's found by its label Text, walking up to
 * the nearest onPress-bearing ancestor. Returns onPress()'s own result so a caller whose save()
 * does real async work (e.g. a staged photo upload) can await full completion; existing callers
 * that don't await it are unaffected. */
function pressSaveButton(renderer: ReactTestRenderer.ReactTestRenderer) {
  let node: ReactTestRenderer.ReactTestInstance | null = renderer.root.findAll(
    n => n.props.children === i18n.t('common.save'),
  )[0];
  while (node && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  return node!.props.onPress();
}

describe('NewLinkReviewScreen', () => {
  beforeEach(() => {
    jest.mocked(getCollections).mockResolvedValue({ items: [], nextCursor: null });
    jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: null, source: null, previewImageUrl: null });
    jest.mocked(checkUrlSafety).mockResolvedValue({ status: 'noKnownThreat', threats: [] });
    // Both are fire-and-forget (.catch()'d, never awaited) in save() - a bare jest.fn() (no
    // resolved value) would make that .catch() itself throw synchronously on undefined, so every
    // test needs a real resolved Promise here even when it never asserts on these calls directly.
    jest.mocked(setItemPreviewImage).mockResolvedValue(undefined);
    jest.mocked(setItemCoverImage).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('prefills the title, and shows the compact source row (not the raw URL) by default', async () => {
    const { renderer } = await renderScreen();

    const [titleInput] = renderer.root.findAllByType(TextInput);
    expect(titleInput.props.value).toBe('Shared title');
    // Compact source row shows the hostname for a generic (unrecognized) site, never the raw URL.
    expect(renderer.root.findByProps({ children: 'example.com' })).toBeTruthy();
    expect(renderer.root.findAll(node => node.props.children === 'https://example.com/shared')).toHaveLength(0);
  });

  it('tapping edit on the source row reveals an editable URL field prefilled with the current value', async () => {
    const { renderer } = await renderScreen();

    await act(async () => {
      findByAccessibilityLabel(renderer, i18n.t('common.edit')).props.onPress();
    });

    const urlInput = renderer.root
      .findAllByType(TextInput)
      .find(input => input.props.value === 'https://example.com/shared');
    expect(urlInput).toBeTruthy();
  });

  it('never calls any Item API before Save is tapped', async () => {
    await renderScreen();

    expect(saveInboxEntry).not.toHaveBeenCalled();
    expect(updateItemDetails).not.toHaveBeenCalled();
    expect(addItemToCollection).not.toHaveBeenCalled();
  });

  it('saves the url/title/memo and links the selected category, in order, then goes back', async () => {
    jest.mocked(getCollections).mockResolvedValue({
      items: [{ id: 3, name: '영화', isFavorite: false, itemCount: 0, createdAtUtc: '', updatedAtUtc: '' }],
      nextCursor: null,
    });
    jest.mocked(saveInboxEntry).mockResolvedValue({
      id: 55,
      url: 'https://example.com/shared',
      savedAtUtc: '2026-01-01T00:00:00Z',
    });
    jest.mocked(updateItemDetails).mockResolvedValue(undefined);
    jest.mocked(addItemToCollection).mockResolvedValue(undefined);

    const { renderer, navigation } = await renderScreen();
    await openCategoryPicker(renderer);

    await act(async () => {
      findByAccessibilityLabel(renderer, '영화').props.onPress();
    });

    await act(async () => {
      pressSaveButton(renderer);
    });

    // A generated clientRequestId (uuid) is now always passed - see clientRequestIdRef's own
    // remarks on why (idempotent retry-safety) - so this only pins the first two args.
    expect(saveInboxEntry).toHaveBeenCalledWith(
      expect.anything(), 'https://example.com/shared', expect.any(String),
    );
    expect(updateItemDetails).toHaveBeenCalledWith(expect.anything(), 55, { title: 'Shared title', memo: '' });
    expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), 3, 55);
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('skips updateItemDetails and addItemToCollection when title/memo are empty and no category is selected', async () => {
    jest.mocked(saveInboxEntry).mockResolvedValue({
      id: 56,
      url: 'https://example.com/shared',
      savedAtUtc: '2026-01-01T00:00:00Z',
    });

    const { renderer, navigation } = await renderScreen({ initialTitle: null });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      pressSaveButton(renderer);
    });

    expect(saveInboxEntry).toHaveBeenCalled();
    expect(updateItemDetails).not.toHaveBeenCalled();
    expect(addItemToCollection).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('still resolves metadata (for the preview image) even when an incoming title is already present, without overwriting the title', async () => {
    // Regression test: this used to skip the whole metadata fetch whenever an incoming title
    // existed, which silently meant most real shares (which usually do carry a title) never got
    // a preview image at all - see the metadata-resolution effect's own remarks.
    jest.mocked(resolveUrlMetadata).mockResolvedValue({
      title: 'A Different Metadata Title', source: 'openGraph', previewImageUrl: 'https://cdn.example.com/preview.jpg',
    });

    const { renderer } = await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });

    expect(resolveUrlMetadata).toHaveBeenCalledWith(expect.anything(), 'https://example.com/shared');
    const [titleInput] = renderer.root.findAllByType(TextInput);
    expect(titleInput.props.value).toBe('Shared title');
    const previewImages = renderer.root
      .findAllByType(require('react-native').Image)
      .filter(node => node.props.source?.uri === 'https://cdn.example.com/preview.jpg');
    expect(previewImages).toHaveLength(1);
  });

  it('fetches URL metadata and fills the empty title field when there is no incoming title', async () => {
    jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: 'Metadata Title', source: 'openGraph', previewImageUrl: null });

    const { renderer } = await renderScreen({ initialTitle: null });
    await act(async () => {
      await Promise.resolve();
    });

    expect(resolveUrlMetadata).toHaveBeenCalledWith(expect.anything(), 'https://example.com/shared');
    const [titleInput] = renderer.root.findAllByType(TextInput);
    expect(titleInput.props.value).toBe('Metadata Title');
  });

  it('does not overwrite a title the user already started typing once URL metadata resolves', async () => {
    let resolveMetadata!: (value: {
      title: string | null;
      source: UrlMetadataSource | null;
      previewImageUrl: string | null;
    }) => void;
    jest.mocked(resolveUrlMetadata).mockReturnValue(
      new Promise(resolve => {
        resolveMetadata = resolve;
      }),
    );

    const { renderer } = await renderScreen({ initialTitle: null });
    await act(async () => {
      await Promise.resolve();
    });

    const [titleInput] = renderer.root.findAllByType(TextInput);
    await act(async () => {
      titleInput.props.onChangeText('User typed title');
    });

    await act(async () => {
      resolveMetadata({ title: 'Metadata Title', source: 'openGraph', previewImageUrl: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    const [titleInputAfter] = renderer.root.findAllByType(TextInput);
    expect(titleInputAfter.props.value).toBe('User typed title');
  });

  it('metadata resolution failure leaves the title blank and Save still works', async () => {
    jest.mocked(resolveUrlMetadata).mockRejectedValue(new Error('network down'));
    jest.mocked(saveInboxEntry).mockResolvedValue({
      id: 70,
      url: 'https://example.com/shared',
      savedAtUtc: '2026-01-01T00:00:00Z',
    });

    const { renderer, navigation } = await renderScreen({ initialTitle: null });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const [titleInput] = renderer.root.findAllByType(TextInput);
    expect(titleInput.props.value).toBe('');

    await act(async () => {
      pressSaveButton(renderer);
    });

    expect(saveInboxEntry).toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  describe('preview image shown before Save (Quick Save OFF)', () => {
    it('shows the auto-resolved preview image in the photo list before Save is even pressed', async () => {
      jest.mocked(resolveUrlMetadata).mockResolvedValue({
        title: null, source: null, previewImageUrl: 'https://cdn.example.com/preview.jpg',
      });

      const { renderer } = await renderScreen({ initialTitle: null });
      await act(async () => {
        await Promise.resolve();
      });

      expect(renderer.root.findByProps({ children: '사진 (1/2)' })).toBeTruthy();
      const previewImages = renderer.root
        .findAllByType(require('react-native').Image)
        .filter(node => node.props.source?.uri === 'https://cdn.example.com/preview.jpg');
      expect(previewImages).toHaveLength(1);
    });

    it('staging a new photo appends it alongside the auto preview, up to the 2-image cap', async () => {
      jest.mocked(resolveUrlMetadata).mockResolvedValue({
        title: null, source: null, previewImageUrl: 'https://cdn.example.com/preview.jpg',
      });
      jest.mocked(launchImageLibrary).mockResolvedValue({
        didCancel: false,
        assets: [{ uri: 'file://staged.jpg', type: 'image/jpeg', fileName: 'staged.jpg' }],
      } as never);

      const { renderer } = await renderScreen({ initialTitle: null });
      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        await findByAccessibilityLabel(renderer, '사진 추가')?.props.onPress();
      });

      expect(renderer.root.findByProps({ children: '사진 (2/2)' })).toBeTruthy();
      const addButton = findByAccessibilityLabel(renderer, '사진 추가');
      expect(addButton?.props.accessibilityState.disabled).toBe(true);
    });

    it('save: uploads the staged photo only after the Item exists, in natural (auto-first) order with no cover override', async () => {
      jest.mocked(resolveUrlMetadata).mockResolvedValue({
        title: null, source: null, previewImageUrl: 'https://cdn.example.com/preview.jpg',
      });
      jest.mocked(launchImageLibrary).mockResolvedValue({
        didCancel: false,
        assets: [{ uri: 'file://staged.jpg', type: 'image/jpeg', fileName: 'staged.jpg' }],
      } as never);
      jest.mocked(saveInboxEntry).mockResolvedValue({
        id: 88, url: 'https://example.com/shared', savedAtUtc: '2026-01-01T00:00:00Z',
      });
      jest.mocked(uploadItemImage).mockResolvedValue(makeUploadedImage({ id: 9 }));

      const { renderer, navigation } = await renderScreen({ initialTitle: null });
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        await findByAccessibilityLabel(renderer, '사진 추가')?.props.onPress();
      });

      await act(async () => {
        await pressSaveButton(renderer);
      });

      expect(uploadItemImage).toHaveBeenCalledWith(
        expect.anything(), 88, expect.objectContaining({ uri: 'file://staged.jpg' }),
      );
      expect(setItemCoverImage).not.toHaveBeenCalled();
      expect(setItemPreviewImage).toHaveBeenCalledWith(expect.anything(), 88, 'https://cdn.example.com/preview.jpg');
      expect(navigation.goBack).toHaveBeenCalledTimes(1);
    });

    it('save: dragging the staged photo ahead of the auto preview persists it as the cover', async () => {
      jest.mocked(resolveUrlMetadata).mockResolvedValue({
        title: null, source: null, previewImageUrl: 'https://cdn.example.com/preview.jpg',
      });
      jest.mocked(launchImageLibrary).mockResolvedValue({
        didCancel: false,
        assets: [{ uri: 'file://staged.jpg', type: 'image/jpeg', fileName: 'staged.jpg' }],
      } as never);
      jest.mocked(saveInboxEntry).mockResolvedValue({
        id: 88, url: 'https://example.com/shared', savedAtUtc: '2026-01-01T00:00:00Z',
      });
      jest.mocked(uploadItemImage).mockResolvedValue(makeUploadedImage({ id: 9 }));

      const { renderer, navigation } = await renderScreen({ initialTitle: null });
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        await findByAccessibilityLabel(renderer, '사진 추가')?.props.onPress();
      });
      // [auto, staged] -> reordering index 1 to index 0.
      await act(async () => {
        await findReorderToFrontAction(renderer)?.props.onAccessibilityAction();
      });

      await act(async () => {
        await pressSaveButton(renderer);
      });

      expect(setItemCoverImage).toHaveBeenCalledWith(expect.anything(), 88, 9);
      expect(navigation.goBack).toHaveBeenCalledTimes(1);
    });

    it('a staged-photo upload failure surfaces an error but never creates a duplicate Item on retry', async () => {
      jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: null, source: null, previewImageUrl: null });
      jest.mocked(launchImageLibrary).mockResolvedValue({
        didCancel: false,
        assets: [{ uri: 'file://staged.jpg', type: 'image/jpeg', fileName: 'staged.jpg' }],
      } as never);
      jest.mocked(saveInboxEntry).mockResolvedValue({
        id: 88, url: 'https://example.com/shared', savedAtUtc: '2026-01-01T00:00:00Z',
      });
      jest.mocked(uploadItemImage).mockRejectedValue(new Error('network error'));

      const { renderer, navigation } = await renderScreen({ initialTitle: null });
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        await findByAccessibilityLabel(renderer, '사진 추가')?.props.onPress();
      });

      await act(async () => {
        await pressSaveButton(renderer);
      });

      expect(renderer.root.findByProps({ children: '사진을 업로드할 수 없습니다.' })).toBeTruthy();
      // Never navigated away - the failure is surfaced, not silently swallowed.
      expect(navigation.goBack).not.toHaveBeenCalled();

      // Retrying Save replays the SAME clientRequestId/Item (never a second saveInboxEntry create
      // with a different id) - see clientRequestIdRef's own remarks.
      jest.mocked(uploadItemImage).mockResolvedValue(makeUploadedImage({ id: 9 }));
      await act(async () => {
        await pressSaveButton(renderer);
      });

      expect(saveInboxEntry).toHaveBeenCalledTimes(2);
      const [firstCallArgs, secondCallArgs] = jest.mocked(saveInboxEntry).mock.calls;
      expect(secondCallArgs[2]).toBe(firstCallArgs[2]);
      expect(navigation.goBack).toHaveBeenCalledTimes(1);
    });
  });

  it('shows an error and does not navigate back when saving fails', async () => {
    jest.mocked(saveInboxEntry).mockRejectedValue(new Error('network down'));

    const { renderer, navigation } = await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      pressSaveButton(renderer);
    });

    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ children: i18n.t('inbox.errorSaveFallback') })).toBeTruthy();
  });

  it('uses the same shared category picker row ItemDetailsScreen uses - not the old horizontal chip list', async () => {
    const { renderer } = await renderScreen();

    // The shared CategoryField summary row (see collections/CategoryField.tsx) - a single
    // Pressable found by its accessibilityLabel, exactly like ItemDetailsScreen's own category row.
    expect(findByAccessibilityLabel(renderer, i18n.t('item.categoryEditA11y'))).toBeTruthy();
    // The old per-screen horizontal chip ScrollView this replaced no longer exists at all.
    expect(renderer.root.findAllByType(ScrollView).some(node => node.props.horizontal === true)).toBe(false);
  });

  it('the category summary row stays present and untouched whether or not an async preview image has arrived - never disturbed by the photo section', async () => {
    let resolveMetadata!: (value: {
      title: string | null;
      source: UrlMetadataSource | null;
      previewImageUrl: string | null;
    }) => void;
    jest.mocked(resolveUrlMetadata).mockReturnValue(
      new Promise(resolve => {
        resolveMetadata = resolve;
      }),
    );

    const { renderer } = await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });

    // Before the preview image resolves (0 photos yet).
    expect(findByAccessibilityLabel(renderer, i18n.t('item.categoryEditA11y'))).toBeTruthy();
    expect(renderer.root.findByProps({ children: '사진 (0/2)' })).toBeTruthy();

    await act(async () => {
      resolveMetadata({ title: null, source: null, previewImageUrl: 'https://cdn.example.com/preview.jpg' });
      await Promise.resolve();
    });

    // After the preview image has arrived (now 1 photo, PhotoListEditor renders it below) - the
    // category row is still there, completely unaffected (the originally-reported bug: the photo
    // appearing made the category section disappear/get pushed off-screen).
    expect(findByAccessibilityLabel(renderer, i18n.t('item.categoryEditA11y'))).toBeTruthy();
    expect(renderer.root.findByProps({ children: '사진 (1/2)' })).toBeTruthy();
  });

  it('creating a new category adds it to the list and auto-selects it', async () => {
    jest.mocked(createCollection).mockResolvedValue({
      id: 9,
      name: '캠핑',
      isFavorite: false,
      itemCount: 0,
      createdAtUtc: '',
      updatedAtUtc: '',
    });
    jest.mocked(saveInboxEntry).mockResolvedValue({
      id: 60,
      url: 'https://example.com/shared',
      savedAtUtc: '2026-01-01T00:00:00Z',
    });
    jest.mocked(addItemToCollection).mockResolvedValue(undefined);

    const { renderer } = await renderScreen();
    await openCategoryPicker(renderer);

    const nameInput = renderer.root.findAllByType(TextInput).find(input => input.props.placeholder === i18n.t('collections.namePlaceholder'))!;
    await act(async () => {
      nameInput.props.onChangeText('캠핑');
    });

    await act(async () => {
      const createButton = renderer.root.findAll(
        node => typeof node.props.onPress === 'function' && node.findAllByType(Text).some(t => t.props.children === i18n.t('collections.create')),
      )[0];
      await createButton.props.onPress();
    });

    expect(createCollection).toHaveBeenCalledWith(expect.anything(), '캠핑');
    expect(findByAccessibilityLabel(renderer, '캠핑')).toBeTruthy();

    await act(async () => {
      pressSaveButton(renderer);
    });

    expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), 9, 60);
  });

  it('shows a checking indicator, then the no-known-threat text once the safety check resolves', async () => {
    let resolveSafety!: (value: { status: 'noKnownThreat'; threats: [] }) => void;
    jest.mocked(checkUrlSafety).mockReturnValue(
      new Promise(resolve => {
        resolveSafety = resolve;
      }),
    );

    const { renderer } = await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });

    expect(renderer.root.findAll(node => node.props.children === i18n.t('urlSafety.checking')).length).toBeGreaterThan(0);

    await act(async () => {
      resolveSafety({ status: 'noKnownThreat', threats: [] });
      await Promise.resolve();
    });

    expect(renderer.root.findAll(node => node.props.children === i18n.t('urlSafety.noKnownThreat')).length).toBeGreaterThan(0);
  });

  it('shows the threat-detected warning text when the safety check finds a known threat', async () => {
    jest.mocked(checkUrlSafety).mockResolvedValue({ status: 'threatDetected', threats: ['malware'] });

    const { renderer } = await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });

    expect(renderer.root.findAll(node => node.props.children === i18n.t('urlSafety.threatDetected')).length).toBeGreaterThan(0);
  });

  it('shows check-unavailable text on safety check failure and still allows Save', async () => {
    jest.mocked(checkUrlSafety).mockRejectedValue(new Error('network down'));
    jest.mocked(saveInboxEntry).mockResolvedValue({
      id: 61,
      url: 'https://example.com/shared',
      savedAtUtc: '2026-01-01T00:00:00Z',
    });

    const { renderer, navigation } = await renderScreen();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderer.root.findAll(node => node.props.children === i18n.t('urlSafety.checkUnavailable')).length).toBeGreaterThan(0);

    await act(async () => {
      pressSaveButton(renderer);
    });

    expect(saveInboxEntry).toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
