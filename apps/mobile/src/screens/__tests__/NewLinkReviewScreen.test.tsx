import ReactTestRenderer, { act } from 'react-test-renderer';
import { ScrollView, Text, TextInput } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import i18n from '../../i18n';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ContentPreviewCard } from '../../components/ContentPreviewCard';
import { NewLinkReviewScreen } from '../NewLinkReviewScreen';
import { addItemToCollection, createCollection, getCollections } from '../../collections/api/collectionsApi';
import { saveInboxEntry } from '../../inbox/api/inboxApi';
import { setItemCoverImage, setItemPreviewImage, submitInstagramMetadataCandidate, updateItemDetails } from '../../items/api/itemsApi';
import { fetchInstagramOpenGraphCandidate } from '../../urlMetadata/instagramOpenGraphFetch';
import { uploadItemImage, type ItemImage } from '../../images/api/imagesApi';
import { getActiveNewLinkReviewDraft } from '../../share/activeNewLinkReviewDraft';
import type { PendingShare } from '../../share/specs/NativeIncomingShare';
import { ApiError } from '../../api/ApiError';
import {
  previewInstagramMetadataCandidate,
  resolveUrlMetadata,
  type UrlMetadataSource,
} from '../../urlMetadata/api/urlMetadataApi';

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
  submitInstagramMetadataCandidate: jest.fn(),
}));

// The Instagram device fetch is never a real network request in tests.
jest.mock('../../urlMetadata/instagramOpenGraphFetch', () => ({
  ...jest.requireActual('../../urlMetadata/instagramOpenGraphFetch'),
  fetchInstagramOpenGraphCandidate: jest.fn(async () => ({ outcome: 'noMetadata', candidate: null })),
}));

jest.mock('../../images/api/imagesApi', () => ({
  uploadItemImage: jest.fn(),
}));

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(),
}));

jest.mock('../../urlMetadata/api/urlMetadataApi', () => ({
  resolveUrlMetadata: jest.fn(),
  previewInstagramMetadataCandidate: jest.fn(),
}));

// Declared with a "mock" prefix so babel-plugin-jest-hoist allows referencing it from the
// hoisted jest.mock factory below - kept as the SAME stable jest.fn() instance across every
// useIncomingShare() call (including NewLinkReviewScreen's own internal one) so tests can assert
// on it directly, rather than each call returning an unrelated new mock function.
const mockAcknowledgePendingShare = jest.fn().mockResolvedValue(undefined);

jest.mock('../../share/useIncomingShare', () => ({
  useIncomingShare: jest.fn(() => ({
    pendingShare: null,
    acknowledgePendingShare: mockAcknowledgePendingShare,
  })),
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
    navigation: { goBack: jest.fn(), replace: jest.fn() },
  } as any;
}

function makePendingShare(overrides: Partial<PendingShare> = {}): PendingShare {
  return {
    id: 'incoming-1',
    text: 'https://example.com/incoming',
    receivedAtEpochMs: Date.now(),
    initialTitle: null,
    preselectedCollectionId: null,
    draftTitle: null,
    draftCollectionId: null,
    ...overrides,
  };
}

/** Simulates exactly what IncomingShareRouter does once it detects a conflicting share while this
 * screen's draft is registered (see activeNewLinkReviewDraft.ts) - calls the registered draft's
 * own onConflictingShare directly, rather than re-rendering a whole separate IncomingShareRouter
 * tree, since that hand-off call is the entire surface this screen needs to react to. */
async function triggerConflictingShare(share: PendingShare): Promise<void> {
  await act(async () => {
    getActiveNewLinkReviewDraft()!.onConflictingShare(share);
  });
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

/** Taps the 2nd (non-representative) photo thumbnail - see PhotoListEditor.tsx's tap+confirm UX.
 * With MAX_EFFECTIVE_IMAGES capped at 2, this is the only possible photo tap in a 2-photo list,
 * always index 1 -> index 0. Does not by itself change anything - see confirmSetRepresentative. */
function tapSecondPhoto(renderer: ReactTestRenderer.ReactTestRenderer) {
  findByAccessibilityLabel(renderer, i18n.t('item.setAsFirstPhotoA11y'))?.props.onPress();
}

function findVisibleConfirmDialog(renderer: ReactTestRenderer.ReactTestRenderer, title: string) {
  return renderer.root.findAll(
    node => node.type === ConfirmDialog && node.props.visible === true && node.props.title === title,
  )[0];
}

/** Confirms the currently-visible "set as representative" ConfirmDialog. */
function confirmSetRepresentative(renderer: ReactTestRenderer.ReactTestRenderer) {
  findVisibleConfirmDialog(renderer, i18n.t('item.setRepresentativeConfirmTitle'))?.props.onConfirm();
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
    // Both are fire-and-forget (.catch()'d, never awaited) in save() - a bare jest.fn() (no
    // resolved value) would make that .catch() itself throw synchronously on undefined, so every
    // test needs a real resolved Promise here even when it never asserts on these calls directly.
    jest.mocked(setItemPreviewImage).mockResolvedValue(undefined);
    jest.mocked(setItemCoverImage).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders the title/source using the shared ContentPreviewCard component (also used by ItemDetailsScreen)', async () => {
    const { renderer } = await renderScreen();

    expect(renderer.root.findAllByType(ContentPreviewCard)).toHaveLength(1);
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
      items: [{ id: 3, name: '영화', isFavorite: false, itemCount: 0, createdAtUtc: '', updatedAtUtc: '', icon: 'Folder', color: null }],
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

  it('still resolves metadata (for the preview image) even when an incoming title is already present', async () => {
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
    // 2, not 1: this round's visual redesign shows the same resolved preview image both at the top
    // of the content preview card and in the photo list below it - the same single resolved URL,
    // rendered twice for two different purposes (preview vs. the editable/reorderable photo list).
    const previewImages = renderer.root
      .findAllByType(require('react-native').Image)
      .filter(node => node.props.source?.uri === 'https://cdn.example.com/preview.jpg');
    expect(previewImages).toHaveLength(2);
  });

  it('replaces a share-provided initial title with the resolved Backend title, and applies the image too (both independent, both applied)', async () => {
    // Title precedence: user edit > resolved Backend metadata title > share-provided initialTitle
    // > empty. A non-empty initialTitle here is the sharing app's own EXTRA_SUBJECT (e.g. raw
    // shared text or a caption, exactly what a YouTube share provides) - never something the user
    // actually typed - so the real, Backend-resolved title must still be trusted to replace it.
    // The image assertion here is the same shape as a real YouTube-share-with-image-missing
    // report: title arrives via a *different* path (initialTitle) than the image (always only
    // resolveUrlMetadata) - proving one being present/overwritten never blocks the other, since
    // they're applied by two completely independent branches of the same effect.
    jest.mocked(resolveUrlMetadata).mockResolvedValue({
      title: 'A Different Metadata Title', source: 'openGraph', previewImageUrl: 'https://cdn.example.com/preview.jpg',
    });

    const { renderer } = await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });

    const [titleInput] = renderer.root.findAllByType(TextInput);
    expect(titleInput.props.value).toBe('A Different Metadata Title');
    const previewImages = renderer.root
      .findAllByType(require('react-native').Image)
      .filter(node => node.props.source?.uri === 'https://cdn.example.com/preview.jpg');
    expect(previewImages).toHaveLength(2);
  });

  it('keeps the share-provided initial title when Backend metadata resolves with no title, but still applies a resolved image', async () => {
    // Title and image are independent signals - a missing title must never suppress an image
    // that did resolve (this is also the shape of the real "YouTube share: title fine, no
    // thumbnail" style report, just with title/image roles swapped).
    jest.mocked(resolveUrlMetadata).mockResolvedValue({
      title: null, source: null, previewImageUrl: 'https://cdn.example.com/preview.jpg',
    });

    const { renderer } = await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });

    const [titleInput] = renderer.root.findAllByType(TextInput);
    expect(titleInput.props.value).toBe('Shared title');
    const previewImages = renderer.root
      .findAllByType(require('react-native').Image)
      .filter(node => node.props.source?.uri === 'https://cdn.example.com/preview.jpg');
    expect(previewImages).toHaveLength(2);
  });

  it('fetches URL metadata and fills the empty title field (and image) when there is no incoming title - the Home direct-URL-entry shape', async () => {
    jest.mocked(resolveUrlMetadata).mockResolvedValue({
      title: 'Metadata Title', source: 'openGraph', previewImageUrl: 'https://cdn.example.com/preview.jpg',
    });

    const { renderer } = await renderScreen({ initialTitle: null });
    await act(async () => {
      await Promise.resolve();
    });

    expect(resolveUrlMetadata).toHaveBeenCalledWith(expect.anything(), 'https://example.com/shared');
    const [titleInput] = renderer.root.findAllByType(TextInput);
    expect(titleInput.props.value).toBe('Metadata Title');
    const previewImages = renderer.root
      .findAllByType(require('react-native').Image)
      .filter(node => node.props.source?.uri === 'https://cdn.example.com/preview.jpg');
    expect(previewImages).toHaveLength(2);
  });

  it('Quick Save OFF: applies real Instagram post metadata (normalized title + real image) for a URL-only Instagram share', async () => {
    const instagramUrl = 'https://www.instagram.com/reel/ABC123xyz/?igsh=abc';
    const realImage = 'https://scontent.cdninstagram.com/v/t51/real-post.jpg';
    jest.mocked(resolveUrlMetadata).mockResolvedValue({
      title: 'kkikki_ent on Instagram: "caption"', source: 'openGraph', previewImageUrl: realImage,
    });

    const { renderer } = await renderScreen({ url: instagramUrl, initialTitle: null });
    await act(async () => {
      await Promise.resolve();
    });

    expect(resolveUrlMetadata).toHaveBeenCalledWith(expect.anything(), instagramUrl);
    const [titleInput] = renderer.root.findAllByType(TextInput);
    expect(titleInput.props.value).toBe('kkikki_ent on Instagram: "caption"');
    const previewImages = renderer.root
      .findAllByType(require('react-native').Image)
      .filter(node => node.props.source?.uri === realImage);
    expect(previewImages.length).toBeGreaterThan(0);
  });

  it('Quick Save OFF: an Instagram login-wall result (Backend returns nothing) never replaces a share-provided title', async () => {
    jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: null, source: null, previewImageUrl: null });

    const { renderer } = await renderScreen({ url: 'https://www.instagram.com/p/ABC123xyz/', initialTitle: '공유 제목' });
    await act(async () => {
      await Promise.resolve();
    });

    const [titleInput] = renderer.root.findAllByType(TextInput);
    expect(titleInput.props.value).toBe('공유 제목');
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

  describe('YouTube placeholder title defense (while DEV Backend may still return one)', () => {
    const YOUTUBE_URL = 'https://www.youtube.com/watch?v=abc123';

    it.each(['- YouTube', 'YouTube', '  youtube  '])(
      'keeps the share-provided initial title when Backend metadata title is the known placeholder %j',
      async placeholderTitle => {
        jest.mocked(resolveUrlMetadata).mockResolvedValue({
          title: placeholderTitle, source: 'openGraph', previewImageUrl: null,
        });

        const { renderer } = await renderScreen({
          url: YOUTUBE_URL, initialTitle: '충격적이었던 FPX의 몰락과정 총정리',
        });
        await act(async () => {
          await Promise.resolve();
        });

        const [titleInput] = renderer.root.findAllByType(TextInput);
        expect(titleInput.props.value).toBe('충격적이었던 FPX의 몰락과정 총정리');
      },
    );

    it('leaves the title empty (never the placeholder) when there is no initial title either', async () => {
      jest.mocked(resolveUrlMetadata).mockResolvedValue({
        title: '- YouTube', source: 'openGraph', previewImageUrl: null,
      });

      const { renderer } = await renderScreen({ url: YOUTUBE_URL, initialTitle: null });
      await act(async () => {
        await Promise.resolve();
      });

      const [titleInput] = renderer.root.findAllByType(TextInput);
      expect(titleInput.props.value).toBe('');
    });

    it('still applies a real (non-placeholder) YouTube video title over the share-provided initial title', async () => {
      jest.mocked(resolveUrlMetadata).mockResolvedValue({
        title: '실제 영상 제목 - YouTube', source: 'openGraph', previewImageUrl: null,
      });

      const { renderer } = await renderScreen({ url: YOUTUBE_URL, initialTitle: '공유 제목' });
      await act(async () => {
        await Promise.resolve();
      });

      const [titleInput] = renderer.root.findAllByType(TextInput);
      expect(titleInput.props.value).toBe('실제 영상 제목 - YouTube');
    });

    it('never lets a real YouTube title overwrite a title the user already edited', async () => {
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

      const { renderer } = await renderScreen({ url: YOUTUBE_URL, initialTitle: null });
      await act(async () => {
        await Promise.resolve();
      });

      const [titleInput] = renderer.root.findAllByType(TextInput);
      await act(async () => {
        titleInput.props.onChangeText('사용자가 직접 입력한 제목');
      });

      await act(async () => {
        resolveMetadata({ title: '실제 영상 제목', source: 'openGraph', previewImageUrl: null });
        await Promise.resolve();
        await Promise.resolve();
      });

      const [titleInputAfter] = renderer.root.findAllByType(TextInput);
      expect(titleInputAfter.props.value).toBe('사용자가 직접 입력한 제목');
    });

    it('does not filter a literal "YouTube"/"- YouTube" title on a non-YouTube host - only youtube.com is gated', async () => {
      jest.mocked(resolveUrlMetadata).mockResolvedValue({
        title: '- YouTube', source: 'openGraph', previewImageUrl: null,
      });

      const { renderer } = await renderScreen({
        url: 'https://www.instagram.com/p/xyz/', initialTitle: '공유 제목',
      });
      await act(async () => {
        await Promise.resolve();
      });

      const [titleInput] = renderer.root.findAllByType(TextInput);
      expect(titleInput.props.value).toBe('- YouTube');
    });
  });

  describe('Instagram device fallback (Quick Save OFF / Home direct input)', () => {
    const instagramUrl = 'https://www.instagram.com/p/ABC123xyz/?igsh=abc';
    const candidate = { ogTitle: 'someone on Instagram: "x"', ogImage: 'https://scontent.cdninstagram.com/v/a.jpg', ogUrl: null, ogDescription: null };

    async function settle() {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    beforeEach(() => {
      jest.mocked(saveInboxEntry).mockResolvedValue({ id: 91, url: instagramUrl, savedAtUtc: '2026-01-01T00:00:00Z' });
      jest.mocked(previewInstagramMetadataCandidate).mockResolvedValue({ title: null, previewImageUrl: null });
    });

    it('when the Backend resolve came back empty, fetches once during review and submits it for the saved Item before leaving', async () => {
      jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: null, source: null, previewImageUrl: null });
      jest.mocked(fetchInstagramOpenGraphCandidate).mockResolvedValueOnce({ outcome: 'candidate', candidate });
      jest.mocked(submitInstagramMetadataCandidate).mockResolvedValueOnce({ title: 't', previewImageUrl: candidate.ogImage, applied: true });

      const { renderer, navigation } = await renderScreen({ url: instagramUrl, initialTitle: null });
      await settle();
      expect(fetchInstagramOpenGraphCandidate).toHaveBeenCalledTimes(1);
      // Raw client values are never shown on the review screen itself - only a Backend-normalized
      // preview is (none usable here).
      expect(renderer.root.findAllByType(TextInput)[0].props.value).toBe('');

      await act(async () => {
        pressSaveButton(renderer);
      });

      expect(fetchInstagramOpenGraphCandidate).toHaveBeenCalledTimes(1);
      expect(submitInstagramMetadataCandidate).toHaveBeenCalledWith(expect.anything(), 91, candidate);
      expect(updateItemDetails).not.toHaveBeenCalled();
      expect(jest.mocked(submitInstagramMetadataCandidate).mock.invocationCallOrder[0])
        .toBeLessThan(jest.mocked(navigation.goBack).mock.invocationCallOrder[0]);
    });

    it('never fetches on the device when the Backend already returned a real title and image', async () => {
      jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: 'real title', source: 'openGraph', previewImageUrl: 'https://scontent.cdninstagram.com/v/b.jpg' });

      const { renderer } = await renderScreen({ url: instagramUrl, initialTitle: null });
      await settle();
      await act(async () => {
        pressSaveButton(renderer);
      });

      expect(fetchInstagramOpenGraphCandidate).not.toHaveBeenCalled();
      expect(submitInstagramMetadataCandidate).not.toHaveBeenCalled();
    });

    it('a failed device fetch is silent - Save still completes normally', async () => {
      jest.mocked(resolveUrlMetadata).mockRejectedValue(new Error('network down'));
      jest.mocked(fetchInstagramOpenGraphCandidate).mockResolvedValueOnce({ outcome: 'loginRedirect', candidate: null });

      const { renderer, navigation } = await renderScreen({ url: instagramUrl, initialTitle: null });
      await settle();
      await act(async () => {
        pressSaveButton(renderer);
      });

      expect(fetchInstagramOpenGraphCandidate).toHaveBeenCalledTimes(1);
      expect(submitInstagramMetadataCandidate).not.toHaveBeenCalled();
      expect(navigation.goBack).toHaveBeenCalledTimes(1);
    });

    it('never runs for a non-Instagram link', async () => {
      jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: null, source: null, previewImageUrl: null });

      await renderScreen({ initialTitle: null });
      await settle();

      expect(fetchInstagramOpenGraphCandidate).not.toHaveBeenCalled();
      expect(previewInstagramMetadataCandidate).not.toHaveBeenCalled();
    });

    describe('pre-save preview (Backend-normalized, shown before Save)', () => {
      const normalized = { title: 'real_handle on Instagram: "x"', previewImageUrl: 'https://scontent.cdninstagram.com/v/a.jpg' };
      type CandidateFetch = { outcome: 'candidate'; candidate: typeof candidate };

      function deferred<T>() {
        let resolve!: (value: T) => void;
        const promise = new Promise<T>(r => {
          resolve = r;
        });
        return { promise, resolve };
      }

      function shownImageCount(renderer: ReactTestRenderer.ReactTestRenderer, uri: string) {
        return renderer.root
          .findAllByType(require('react-native').Image)
          .filter(node => node.props.source?.uri === uri).length;
      }

      function titleValue(renderer: ReactTestRenderer.ReactTestRenderer) {
        return renderer.root.findAllByType(TextInput)[0].props.value;
      }

      beforeEach(() => {
        jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: null, source: null, previewImageUrl: null });
        jest.mocked(submitInstagramMetadataCandidate).mockResolvedValue({ ...normalized, applied: true });
        jest.mocked(updateItemDetails).mockResolvedValue(undefined);
      });

      it('normalizes the device candidate through the preview endpoint and shows the normalized title and image before Save', async () => {
        jest.mocked(fetchInstagramOpenGraphCandidate).mockResolvedValueOnce({ outcome: 'candidate', candidate });
        jest.mocked(previewInstagramMetadataCandidate).mockResolvedValueOnce(normalized);

        const { renderer } = await renderScreen({ url: instagramUrl, initialTitle: null });
        await settle();

        expect(fetchInstagramOpenGraphCandidate).toHaveBeenCalledTimes(1);
        expect(previewInstagramMetadataCandidate).toHaveBeenCalledWith(expect.anything(), instagramUrl, candidate);
        expect(titleValue(renderer)).toBe(normalized.title);
        expect(shownImageCount(renderer, normalized.previewImageUrl)).toBeGreaterThan(0);
        expect(saveInboxEntry).not.toHaveBeenCalled();
        expect(submitInstagramMetadataCandidate).not.toHaveBeenCalled();
      });

      it('replaces a share-provided initial title, like a Backend title would', async () => {
        jest.mocked(fetchInstagramOpenGraphCandidate).mockResolvedValueOnce({ outcome: 'candidate', candidate });
        jest.mocked(previewInstagramMetadataCandidate).mockResolvedValueOnce(normalized);

        const { renderer } = await renderScreen({ url: instagramUrl, initialTitle: 'Instagram share text' });
        await settle();

        expect(titleValue(renderer)).toBe(normalized.title);
      });

      it('never replaces a real Backend title - only fills the missing Backend image', async () => {
        jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: 'backend title', source: 'openGraph', previewImageUrl: null });
        jest.mocked(fetchInstagramOpenGraphCandidate).mockResolvedValueOnce({ outcome: 'candidate', candidate });
        jest.mocked(previewInstagramMetadataCandidate).mockResolvedValueOnce(normalized);

        const { renderer } = await renderScreen({ url: instagramUrl, initialTitle: null });
        await settle();

        expect(titleValue(renderer)).toBe('backend title');
        expect(shownImageCount(renderer, normalized.previewImageUrl)).toBeGreaterThan(0);
      });

      it('never overwrites a title the user typed before the preview arrived', async () => {
        const fetch = deferred<CandidateFetch>();
        jest.mocked(fetchInstagramOpenGraphCandidate).mockReturnValueOnce(fetch.promise);
        jest.mocked(previewInstagramMetadataCandidate).mockResolvedValueOnce(normalized);

        const { renderer } = await renderScreen({ url: instagramUrl, initialTitle: null });
        await settle();
        await act(async () => {
          renderer.root.findAllByType(TextInput)[0].props.onChangeText('user typed title');
        });
        await act(async () => {
          fetch.resolve({ outcome: 'candidate', candidate });
        });
        await settle();

        expect(titleValue(renderer)).toBe('user typed title');
        // The image is independent of the title edit.
        expect(shownImageCount(renderer, normalized.previewImageUrl)).toBeGreaterThan(0);
      });

      it('never adds the preview image once the user staged their own photo', async () => {
        const fetch = deferred<CandidateFetch>();
        jest.mocked(fetchInstagramOpenGraphCandidate).mockReturnValueOnce(fetch.promise);
        jest.mocked(previewInstagramMetadataCandidate).mockResolvedValueOnce(normalized);
        jest.mocked(launchImageLibrary).mockResolvedValue({
          didCancel: false,
          assets: [{ uri: 'file://staged.jpg', type: 'image/jpeg', fileName: 'staged.jpg' }],
        } as never);

        const { renderer } = await renderScreen({ url: instagramUrl, initialTitle: null });
        await settle();
        await act(async () => {
          await findByAccessibilityLabel(renderer, '사진 추가')?.props.onPress();
        });
        await act(async () => {
          fetch.resolve({ outcome: 'candidate', candidate });
        });
        await settle();

        expect(renderer.root.findByProps({ children: '사진 (1/2)' })).toBeTruthy();
        expect(shownImageCount(renderer, normalized.previewImageUrl)).toBe(0);
      });

      it('ignores a late preview once the URL was edited, and never submits the candidate for the other URL', async () => {
        const fetch = deferred<CandidateFetch>();
        jest.mocked(fetchInstagramOpenGraphCandidate).mockReturnValueOnce(fetch.promise);
        jest.mocked(previewInstagramMetadataCandidate).mockResolvedValueOnce(normalized);

        const { renderer } = await renderScreen({ url: instagramUrl, initialTitle: null });
        await settle();
        await act(async () => {
          findByAccessibilityLabel(renderer, i18n.t('common.edit')).props.onPress();
        });
        const urlInput = renderer.root.findAllByType(TextInput).find(input => input.props.value === instagramUrl)!;
        await act(async () => {
          urlInput.props.onChangeText('https://www.instagram.com/p/OTHER999/');
        });
        await act(async () => {
          fetch.resolve({ outcome: 'candidate', candidate });
        });
        await settle();

        expect(titleValue(renderer)).toBe('');
        expect(shownImageCount(renderer, normalized.previewImageUrl)).toBe(0);

        await act(async () => {
          await pressSaveButton(renderer);
        });
        expect(submitInstagramMetadataCandidate).not.toHaveBeenCalled();
      });

      it('Save reuses the same fetched candidate (no second fetch/preview) and leaves the device image to the candidate endpoint', async () => {
        jest.mocked(fetchInstagramOpenGraphCandidate).mockResolvedValueOnce({ outcome: 'candidate', candidate });
        jest.mocked(previewInstagramMetadataCandidate).mockResolvedValueOnce(normalized);

        const { renderer, navigation } = await renderScreen({ url: instagramUrl, initialTitle: null });
        await settle();
        await act(async () => {
          await pressSaveButton(renderer);
        });

        expect(fetchInstagramOpenGraphCandidate).toHaveBeenCalledTimes(1);
        expect(previewInstagramMetadataCandidate).toHaveBeenCalledTimes(1);
        expect(updateItemDetails).toHaveBeenCalledWith(expect.anything(), 91, { title: normalized.title, memo: '' });
        expect(submitInstagramMetadataCandidate).toHaveBeenCalledTimes(1);
        expect(submitInstagramMetadataCandidate).toHaveBeenCalledWith(expect.anything(), 91, candidate);
        expect(setItemPreviewImage).not.toHaveBeenCalled();
        expect(navigation.goBack).toHaveBeenCalledTimes(1);
      });

      it.each([
        ['a 400 rejection', () => Promise.reject(new ApiError('badRequest', 400))],
        ['a network error', () => Promise.reject(new Error('network down'))],
      ])('%s from the preview endpoint is silent - the screen stays as-is and Save still works', async (_label, failure) => {
        jest.mocked(fetchInstagramOpenGraphCandidate).mockResolvedValueOnce({ outcome: 'candidate', candidate });
        jest.mocked(previewInstagramMetadataCandidate).mockImplementationOnce(failure);

        const { renderer, navigation } = await renderScreen({ url: instagramUrl, initialTitle: null });
        await settle();

        expect(titleValue(renderer)).toBe('');
        expect(shownImageCount(renderer, normalized.previewImageUrl)).toBe(0);

        await act(async () => {
          await pressSaveButton(renderer);
        });
        expect(submitInstagramMetadataCandidate).toHaveBeenCalledWith(expect.anything(), 91, candidate);
        expect(navigation.goBack).toHaveBeenCalledTimes(1);
      });

      it('never calls the preview endpoint when the Backend already returned a real title and image', async () => {
        jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: 'real title', source: 'openGraph', previewImageUrl: 'https://scontent.cdninstagram.com/v/b.jpg' });

        await renderScreen({ url: instagramUrl, initialTitle: null });
        await settle();

        expect(fetchInstagramOpenGraphCandidate).not.toHaveBeenCalled();
        expect(previewInstagramMetadataCandidate).not.toHaveBeenCalled();
      });
    });
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

  describe('metadata loading overlay', () => {
    function findSaveButton(renderer: ReactTestRenderer.ReactTestRenderer) {
      let node: ReactTestRenderer.ReactTestInstance | null = renderer.root.findAll(
        n => n.props.children === i18n.t('common.save'),
      )[0];
      while (node && typeof node.props.disabled === 'undefined') {
        node = node.parent;
      }
      return node!;
    }

    it('shows the centered loading overlay and disables Save while metadata is resolving, never the old small inline spinner', async () => {
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

      expect(renderer.root.findAll(node => node.props.children === i18n.t('item.resolvingMetadataOverlay')).length).toBeGreaterThan(0);
      expect(findSaveButton(renderer).props.disabled).toBe(true);
      // The old per-field small spinner (react-native's own ActivityIndicator directly beside the
      // title label, size="small") is gone - only the overlay's large one remains.
      const smallIndicators = renderer.root
        .findAllByType(require('react-native').ActivityIndicator)
        .filter(node => node.props.size === 'small');
      expect(smallIndicators).toHaveLength(0);

      await act(async () => {
        resolveMetadata({ title: 'Metadata Title', source: 'openGraph', previewImageUrl: 'https://cdn.example.com/preview.jpg' });
        await Promise.resolve();
      });

      expect(renderer.root.findAll(node => node.props.children === i18n.t('item.resolvingMetadataOverlay')).length).toBe(0);
      expect(findSaveButton(renderer).props.disabled).toBe(false);
      const [titleInput] = renderer.root.findAllByType(TextInput);
      expect(titleInput.props.value).toBe('Metadata Title');
      const previewImages = renderer.root
        .findAllByType(require('react-native').Image)
        .filter(node => node.props.source?.uri === 'https://cdn.example.com/preview.jpg');
      expect(previewImages).toHaveLength(2);
    });

    it('hides the overlay, re-enables Save, and shows the small failure hint when metadata resolution fails - manual save still works', async () => {
      jest.mocked(resolveUrlMetadata).mockRejectedValue(new Error('network down'));
      jest.mocked(saveInboxEntry).mockResolvedValue({
        id: 71,
        url: 'https://example.com/shared',
        savedAtUtc: '2026-01-01T00:00:00Z',
      });

      const { renderer, navigation } = await renderScreen({ initialTitle: null });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(renderer.root.findAll(node => node.props.children === i18n.t('item.resolvingMetadataOverlay')).length).toBe(0);
      expect(findSaveButton(renderer).props.disabled).toBe(false);
      expect(renderer.root.findByProps({ children: i18n.t('item.metadataResolutionFailedHint') })).toBeTruthy();

      await act(async () => {
        pressSaveButton(renderer);
      });

      expect(saveInboxEntry).toHaveBeenCalled();
      expect(navigation.goBack).toHaveBeenCalledTimes(1);
    });
  });

  it('never navigates back until the preview-image/cover-image persistence calls settle - the fix for the intermittent missing Home thumbnail (a race between an un-awaited persistence call and Home refetching on focus)', async () => {
    jest.mocked(resolveUrlMetadata).mockResolvedValue({
      title: null, source: null, previewImageUrl: 'https://cdn.example.com/preview.jpg',
    });
    jest.mocked(saveInboxEntry).mockResolvedValue({
      id: 90, url: 'https://example.com/shared', savedAtUtc: '2026-01-01T00:00:00Z',
    });

    let resolveSetPreviewImage!: () => void;
    jest.mocked(setItemPreviewImage).mockReturnValue(
      new Promise(resolve => {
        resolveSetPreviewImage = () => resolve(undefined);
      }),
    );

    const { renderer, navigation } = await renderScreen({ initialTitle: null });
    await act(async () => {
      await Promise.resolve();
    });

    let savePromise!: Promise<void>;
    await act(async () => {
      savePromise = pressSaveButton(renderer);
      // Let every already-queued microtask (saveInboxEntry, etc.) run - setItemPreviewImage is
      // still deliberately unresolved at this point.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setItemPreviewImage).toHaveBeenCalledWith(expect.anything(), 90, 'https://cdn.example.com/preview.jpg');
    expect(navigation.goBack).not.toHaveBeenCalled();

    await act(async () => {
      resolveSetPreviewImage();
      await savePromise;
    });

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
      expect(previewImages).toHaveLength(2);
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

    it('does not let a late-arriving metadata image displace a photo the user already staged', async () => {
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
      jest.mocked(launchImageLibrary).mockResolvedValue({
        didCancel: false,
        assets: [{ uri: 'file://staged.jpg', type: 'image/jpeg', fileName: 'staged.jpg' }],
      } as never);

      const { renderer } = await renderScreen({ initialTitle: null });

      // User stages their own photo while metadata is still resolving.
      await act(async () => {
        await findByAccessibilityLabel(renderer, '사진 추가')?.props.onPress();
      });
      expect(renderer.root.findByProps({ children: '사진 (1/2)' })).toBeTruthy();

      // Metadata now resolves with an image - it must not sneak in as a second, auto-added photo.
      await act(async () => {
        resolveMetadata({ title: null, source: null, previewImageUrl: 'https://cdn.example.com/preview.jpg' });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(renderer.root.findByProps({ children: '사진 (1/2)' })).toBeTruthy();
      const autoImages = renderer.root
        .findAllByType(require('react-native').Image)
        .filter(node => node.props.source?.uri === 'https://cdn.example.com/preview.jpg');
      expect(autoImages).toHaveLength(0);
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
      // [auto, staged] -> confirming makes index 1 the representative.
      await act(async () => {
        tapSecondPhoto(renderer);
      });
      await act(async () => {
        confirmSetRepresentative(renderer);
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

  it('shows each category\'s own pastel icon tile in the picker - not a plain gray outline icon', async () => {
    jest.mocked(getCollections).mockResolvedValue({
      items: [{ id: 3, name: '영화', isFavorite: false, itemCount: 0, createdAtUtc: '', updatedAtUtc: '', icon: 'Heart', color: null }],
      nextCursor: null,
    });
    const { renderer } = await renderScreen();

    await openCategoryPicker(renderer);

    const { HeartIcon } = require('../../icons/HeartIcon');
    const { FolderIcon } = require('../../icons/FolderIcon');
    expect(renderer.root.findAllByType(HeartIcon).length).toBeGreaterThan(0);
    expect(renderer.root.findAllByType(FolderIcon)).toHaveLength(0);
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
      icon: 'Folder',
      color: null,
    });
    jest.mocked(saveInboxEntry).mockResolvedValue({
      id: 60,
      url: 'https://example.com/shared',
      savedAtUtc: '2026-01-01T00:00:00Z',
    });
    jest.mocked(addItemToCollection).mockResolvedValue(undefined);

    const { renderer } = await renderScreen();
    await openCategoryPicker(renderer);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.addNew') }).props.onPress();
    });

    const nameInput = renderer.root.findAllByType(TextInput).find(input => input.props.placeholder === i18n.t('collections.namePlaceholder'))!;
    await act(async () => {
      nameInput.props.onChangeText('캠핑');
    });

    await act(async () => {
      const createButton = renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.createAction') });
      await createButton.props.onPress();
    });

    expect(createCollection).toHaveBeenCalledWith(expect.anything(), '캠핑', 'Folder', 'Blue');
    expect(findByAccessibilityLabel(renderer, '캠핑')).toBeTruthy();

    await act(async () => {
      pressSaveButton(renderer);
    });

    expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), 9, 60);
  });

  describe('active draft + conflicting incoming share', () => {
    function findConflictDialog(renderer: ReactTestRenderer.ReactTestRenderer) {
      return findVisibleConfirmDialog(renderer, i18n.t('item.activeDraftConflictTitle'));
    }

    it('shows the conflict dialog for a different-URL share, keeping the current draft untouched', async () => {
      const { renderer } = await renderScreen();
      await act(async () => {
        await Promise.resolve();
      });

      await triggerConflictingShare(makePendingShare({ text: 'https://example.com/different' }));

      expect(findConflictDialog(renderer)).toBeTruthy();
      // The draft's own title field is completely unaffected by the incoming share just sitting
      // there behind the dialog.
      const [titleInput] = renderer.root.findAllByType(TextInput);
      expect(titleInput.props.value).toBe('Shared title');
    });

    it('"저장 후 계속": saves the current draft exactly once, then replaces the screen with the new share', async () => {
      jest.mocked(saveInboxEntry).mockResolvedValue({
        id: 70,
        url: 'https://example.com/shared',
        savedAtUtc: '2026-01-01T00:00:00Z',
      });
      const { renderer, navigation } = await renderScreen();
      await act(async () => {
        await Promise.resolve();
      });
      const share = makePendingShare({
        id: 'incoming-save',
        text: 'https://example.com/new-after-save',
        initialTitle: 'New Title',
      });
      await triggerConflictingShare(share);

      await act(async () => {
        await findConflictDialog(renderer)!.props.onCancel();
      });

      expect(saveInboxEntry).toHaveBeenCalledTimes(1);
      expect(mockAcknowledgePendingShare).toHaveBeenCalledWith('incoming-save');
      expect(navigation.replace).toHaveBeenCalledWith('NewLinkReview', {
        url: 'https://example.com/new-after-save',
        initialTitle: 'New Title',
        preselectedCollectionId: null,
      });
      expect(navigation.goBack).not.toHaveBeenCalled();
      expect(findConflictDialog(renderer)).toBeFalsy();
    });

    it('a failed "저장 후 계속" keeps the current draft and the pending share - never transitions to the new share', async () => {
      jest.mocked(saveInboxEntry).mockRejectedValue(new Error('network down'));
      const { renderer, navigation } = await renderScreen();
      await act(async () => {
        await Promise.resolve();
      });
      await triggerConflictingShare(makePendingShare({ id: 'incoming-fail', text: 'https://example.com/new-after-fail' }));

      await act(async () => {
        await findConflictDialog(renderer)!.props.onCancel();
      });

      expect(saveInboxEntry).toHaveBeenCalledTimes(1);
      expect(navigation.replace).not.toHaveBeenCalled();
      expect(mockAcknowledgePendingShare).not.toHaveBeenCalled();
      // The dialog is still up (pendingConflictShare was never cleared) so the user can retry
      // either button.
      expect(findConflictDialog(renderer)).toBeTruthy();
    });

    it('"버리고 계속": never calls save, and replaces the screen with a fresh draft for the new share', async () => {
      const { renderer, navigation } = await renderScreen();
      await act(async () => {
        await Promise.resolve();
      });
      const share = makePendingShare({
        id: 'incoming-discard',
        text: 'https://example.com/new-after-discard',
        initialTitle: null,
        preselectedCollectionId: 5,
      });
      await triggerConflictingShare(share);

      await act(async () => {
        await findConflictDialog(renderer)!.props.onConfirm();
      });

      expect(saveInboxEntry).not.toHaveBeenCalled();
      expect(mockAcknowledgePendingShare).toHaveBeenCalledWith('incoming-discard');
      expect(navigation.replace).toHaveBeenCalledWith('NewLinkReview', {
        url: 'https://example.com/new-after-discard',
        initialTitle: null,
        preselectedCollectionId: 5,
      });
      expect(findConflictDialog(renderer)).toBeFalsy();
    });
  });
});
