import ReactTestRenderer, { act } from 'react-test-renderer';
import { Linking, Text, TextInput } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ContentPreviewCard } from '../../components/ContentPreviewCard';
import { ItemDetailsScreen } from '../ItemDetailsScreen';
import { AppToastProvider } from '../../components/AppToast';
import {
  deleteItem,
  getItemDetails,
  updateItemDetails,
  type ItemDetails,
} from '../../items/api/itemsApi';
import { deleteItemImage, getItemImages, uploadItemImage, type ItemImage } from '../../images/api/imagesApi';
import {
  addItemToCollection,
  getCollections,
  removeItemFromCollection,
  type Collection,
  type GetCollectionsOptions,
} from '../../collections/api/collectionsApi';
import { launchImageLibrary } from 'react-native-image-picker';
import { addItemComment, deleteItemComment, getItemComments, type ItemComment } from '../../comments/commentsApi';
import { getSharedCollectionItem, setItemReaction } from '../../collections/api/collectionsApi';
import { clearCollectionUnlockGrants, rememberCollectionUnlock } from '../../collections/collectionUnlockGrants';

// The react-native-localize jest mock (see jest.config.js) reports "en-US", so i18n would
// otherwise resolve to English by default - pinned to Korean so this file's label assertions are
// deterministic regardless of that mock's default locale.
beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => {
      return callback();
    }, [callback]);
  },
  usePreventRemove: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../items/api/itemsApi', () => ({
  getItemDetails: jest.fn(),
  updateItemDetails: jest.fn(),
  deleteItem: jest.fn(),
  setItemCoverImage: jest.fn(),
}));

jest.mock('../../images/api/imagesApi', () => ({
  getItemImages: jest.fn(),
  uploadItemImage: jest.fn(),
  deleteItemImage: jest.fn(),
}));

jest.mock('../../comments/commentsApi', () => ({
  ...jest.requireActual('../../comments/commentsApi'),
  getItemComments: jest.fn(),
  addItemComment: jest.fn(),
  deleteItemComment: jest.fn(),
}));

jest.mock('../../collections/api/collectionsApi', () => ({
  getSharedCollectionItem: jest.fn(),
  setItemReaction: jest.fn(),
  removeItemReaction: jest.fn(),
  getCollections: jest.fn(),
  addItemToCollection: jest.fn(),
  removeItemFromCollection: jest.fn(),
  createCollection: jest.fn(),
}));

jest.mock('../../items/shareItem', () => ({
  shareItem: jest.fn(),
}));

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(),
}));

const route ={ key: 'ItemDetails', name: 'ItemDetails', params: { itemId: 1 } } as never;
const navigation = { goBack: jest.fn() } as never;

function makeItemDetails(overrides: Partial<ItemDetails> = {}): ItemDetails {
  return {
    id: 1,
    url: 'https://example.com',
    title: 'Original title',
    memo: 'Original memo',
    savedAtUtc: new Date().toISOString(),
    previewImageUrl: null,
    coverImage: null,
    ...overrides,
  };
}

function makeImage(overrides: Partial<ItemImage> = {}): ItemImage {
  return {
    id: 1,
    contentType: 'image/jpeg',
    byteLength: 1000,
    sortOrder: 0,
    createdAtUtc: new Date().toISOString(),
    readUrl: 'https://example.com/image.jpg',
    ...overrides,
  };
}

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 1,
    name: 'Groceries',
    isFavorite: false,
    itemCount: 0,
    createdAtUtc: new Date().toISOString(),
    updatedAtUtc: new Date().toISOString(),
    icon: 'Folder',
    color: null,
    ...overrides,
  };
}

function findPressableByText(renderer: ReactTestRenderer.ReactTestRenderer, text: string) {
  return renderer.root
    .findAll(node => typeof node.props.onPress === 'function')
    .find(node => node.findAllByType(Text).some(textNode => textNode.props.children === text));
}

function findPressableByAccessibilityLabel(
  renderer: ReactTestRenderer.ReactTestRenderer,
  label: string,
) {
  return renderer.root.findAll(node => node.props.accessibilityLabel === label)[0];
}

function isSaveDisabled(renderer: ReactTestRenderer.ReactTestRenderer): boolean {
  return findPressableByText(renderer, '저장')?.props.accessibilityState.disabled;
}

/** The most recent isDirty value usePreventRemove was called with - i.e. whether leaving now would show the unsaved-changes warning. */
function latestPreventRemoveIsDirty(): boolean {
  const calls = jest.mocked(usePreventRemove).mock.calls;
  return calls[calls.length - 1]?.[0];
}

// Wrapped in the real AppToastProvider (not mocked) - the save-success Notification now shows via
// the global AppToast Host (see useAppToast), so these tests exercise the real Provider and
// assert on what it actually renders, exactly as a real app screen would.
async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <AppToastProvider>
        <ItemDetailsScreen navigation={navigation} route={route} />
      </AppToastProvider>,
    );
  });
  return renderer;
}

function findVisibleConfirmDialog(renderer: ReactTestRenderer.ReactTestRenderer, title: string) {
  return renderer.root.findAll(
    node => node.type === ConfirmDialog && node.props.visible === true && node.props.title === title,
  )[0];
}



describe('ItemDetailsScreen', () => {
  beforeEach(() => {
    jest.mocked(getItemDetails).mockResolvedValue(makeItemDetails());
    jest.mocked(getItemImages).mockResolvedValue([]);
    jest.mocked(getCollections).mockImplementation(
      async (_request, options: GetCollectionsOptions = {}) => {
        if (options.itemId) {
          return { items: [], nextCursor: null };
        }
        return { items: [makeCollection({ id: 5, name: 'Wishlist' })], nextCursor: null };
      },
    );
    jest.mocked(launchImageLibrary).mockResolvedValue({
      didCancel: false,
      assets: [{ uri: 'file://photo.jpg', type: 'image/jpeg', fileName: 'photo.jpg' }],
    } as never);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('unified content preview card (shared with NewLinkReviewScreen)', () => {
    it('renders the title/source using the shared ContentPreviewCard component, not a separately structured form', async () => {
      const renderer = await renderScreen();

      expect(renderer.root.findAllByType(ContentPreviewCard)).toHaveLength(1);
    });
  });

  describe('title/memo', () => {
    it('keeps Save disabled until title or memo actually changes', async () => {
      const renderer = await renderScreen();
      expect(isSaveDisabled(renderer)).toBe(true);

      const titleInput = renderer.root.findAllByType(TextInput)[0];
      await act(async () => {
        titleInput.props.onChangeText('Changed title');
      });

      expect(isSaveDisabled(renderer)).toBe(false);
    });

    it('revert -> not dirty: restoring the original title disables Save again', async () => {
      const renderer = await renderScreen();
      const titleInput = renderer.root.findAllByType(TextInput)[0];

      await act(async () => {
        titleInput.props.onChangeText('Changed title');
      });
      expect(isSaveDisabled(renderer)).toBe(false);

      await act(async () => {
        titleInput.props.onChangeText('Original title');
      });
      expect(isSaveDisabled(renderer)).toBe(true);
    });

    it('save -> new baseline: saving establishes the saved value as the new baseline', async () => {
      jest.mocked(updateItemDetails).mockResolvedValue(undefined);
      const renderer = await renderScreen();
      const titleInput = renderer.root.findAllByType(TextInput)[0];

      await act(async () => {
        titleInput.props.onChangeText('Saved title');
      });
      await act(async () => {
        await findPressableByText(renderer, '저장')?.props.onPress();
      });

      expect(updateItemDetails).toHaveBeenCalledWith(expect.anything(), 1, {
        title: 'Saved title',
        memo: 'Original memo',
      });
      expect(isSaveDisabled(renderer)).toBe(true);

      await act(async () => {
        titleInput.props.onChangeText('Original title');
      });
      expect(isSaveDisabled(renderer)).toBe(false);
    });
  });

  describe('대표 사진 - one photo, saved at once, never a reload of the Item', () => {
    const { Image } = require('react-native');
    const { ActionMenuDialog } = require('../../components/ActionMenuDialog');

    const byTestId = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
      renderer.root.findAll(node => node.props.testID === testID && (typeof node.props.onPress === 'function' || node.type === Image));
    const has = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
      renderer.root.findAll(node => node.props.testID === testID).length > 0;
    /** The photo the field shows, or null for none. */
    const shownPhoto = (renderer: ReactTestRenderer.ReactTestRenderer): string | null =>
      renderer.root.findAll(node => node.type === Image && node.props.testID === 'representative-photo-image')[0]?.props.source.uri ?? null;
    const memoInput = (renderer: ReactTestRenderer.ReactTestRenderer) =>
      renderer.root.findAllByType(TextInput).find(node => node.props.placeholder === i18n.t('item.memoPlaceholder'))!;

    async function pressAdd(renderer: ReactTestRenderer.ReactTestRenderer) {
      await act(async () => {
        await byTestId(renderer, 'representative-photo-add')[0].props.onPress();
      });
    }

    /** Thumbnail → its menu; returns the menu's labels, or runs the one named. */
    async function openPhotoMenu(renderer: ReactTestRenderer.ReactTestRenderer): Promise<string[]> {
      await act(async () => {
        byTestId(renderer, 'representative-photo-edit')[0].props.onPress();
      });
      const menu = renderer.root.findAllByType(ActionMenuDialog).find((dialog: ReactTestRenderer.ReactTestInstance) => dialog.props.visible)!;
      return (menu?.props.actions ?? []).map((action: { label: string }) => action.label);
    }

    async function runPhotoMenu(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
      await openPhotoMenu(renderer);
      const menu = renderer.root.findAllByType(ActionMenuDialog).find((dialog: ReactTestRenderer.ReactTestInstance) => dialog.props.visible)!;
      await act(async () => {
        menu.props.actions.find((action: { label: string }) => action.label === label).onPress();
      });
      // The test platform is iOS: the action waits for the closing menu's onDismiss.
      await act(async () => {
        menu.props.onDismiss?.();
      });
      await settle();
    }

    /** The menu and its confirmation start the work without returning it - let it finish. */
    async function settle() {
      await act(async () => {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      });
    }

    async function removeWithConfirmation(renderer: ReactTestRenderer.ReactTestRenderer) {
      await runPhotoMenu(renderer, i18n.t('profile.photoRemove'));
      await act(async () => {
        findVisibleConfirmDialog(renderer, i18n.t('item.deletePhotoConfirmTitle'))?.props.onConfirm();
      });
      await settle();
    }

    it('no photo: one 사진 추가 action under 대표 사진 - no count, no limit text, no "+"', async () => {
      const renderer = await renderScreen();

      expect(renderer.root.findByProps({ children: '대표 사진' })).toBeTruthy();
      expect(byTestId(renderer, 'representative-photo-add')).toHaveLength(1);
      expect(shownPhoto(renderer)).toBeNull();
      const texts = renderer.root.findAllByType(Text).map(node => node.props.children);
      expect(JSON.stringify(texts)).not.toMatch(/\(0\/2\)|최대 2장/);
    });

    it('add: the uploaded photo shows at once, the spinner ends, and the Item is not loaded again', async () => {
      let finishUpload!: (image: ItemImage) => void;
      jest.mocked(uploadItemImage).mockImplementation(() => new Promise(resolve => { finishUpload = resolve; }));
      const renderer = await renderScreen();

      await act(async () => {
        byTestId(renderer, 'representative-photo-add')[0].props.onPress();
        await Promise.resolve();
      });
      // Only the photo field is busy - the rest of the screen stays as it is.
      expect(has(renderer, 'representative-photo-busy')).toBe(true);
      expect(renderer.root.findAllByType(ContentPreviewCard)).toHaveLength(1);

      await act(async () => {
        finishUpload(makeImage({ id: 9, readUrl: 'https://blob.example/9.jpg' }));
      });

      expect(shownPhoto(renderer)).toBe('https://blob.example/9.jpg');
      expect(renderer.root.findByType(ContentPreviewCard).props.previewImageUrl).toBe('https://blob.example/9.jpg');
      expect(has(renderer, 'representative-photo-busy')).toBe(false);
      expect(getItemDetails).toHaveBeenCalledTimes(1);
      expect(getItemImages).toHaveBeenCalledTimes(1);
    });

    it('a cancelled pick changes nothing and is no error', async () => {
      jest.mocked(launchImageLibrary).mockResolvedValue({ didCancel: true } as never);
      const renderer = await renderScreen();

      await pressAdd(renderer);

      expect(uploadItemImage).not.toHaveBeenCalled();
      expect(shownPhoto(renderer)).toBeNull();
      expect(has(renderer, 'representative-photo-busy')).toBe(false);
      expect(renderer.root.findAll(node => node.props.children === '사진을 업로드할 수 없습니다.')).toHaveLength(0);
    });

    it('a failed add leaves no photo, ends the spinner and says why', async () => {
      jest.mocked(uploadItemImage).mockRejectedValue(new Error('network error'));
      const renderer = await renderScreen();

      await pressAdd(renderer);

      expect(shownPhoto(renderer)).toBeNull();
      expect(has(renderer, 'representative-photo-busy')).toBe(false);
      expect(byTestId(renderer, 'representative-photo-add')).toHaveLength(1);
      expect(renderer.root.findByProps({ children: '사진을 업로드할 수 없습니다.' })).toBeTruthy();
    });

    it('with a photo there is no way to add a second one - only 사진 변경 / 사진 삭제', async () => {
      jest.mocked(getItemImages).mockResolvedValue([makeImage({ id: 7, readUrl: 'https://blob.example/7.jpg' })]);
      const renderer = await renderScreen();

      expect(shownPhoto(renderer)).toBe('https://blob.example/7.jpg');
      expect(byTestId(renderer, 'representative-photo-add')).toHaveLength(0);
      expect(renderer.root.findAll(node => node.props.accessibilityLabel === '사진 추가')).toHaveLength(0);
      expect(await openPhotoMenu(renderer)).toEqual(['사진 변경', '사진 삭제']);
      expect(renderer.root.findAll(node => node.props.children === '대표')).toHaveLength(0); // no Cover badge
    });

    it('change: the new photo replaces the old one at once; a failed change keeps the old one', async () => {
      jest.mocked(getItemImages).mockResolvedValue([makeImage({ id: 7, readUrl: 'https://blob.example/7.jpg' })]);
      jest.mocked(uploadItemImage)
        .mockResolvedValueOnce(makeImage({ id: 8, readUrl: 'https://blob.example/8.jpg' }))
        .mockRejectedValueOnce(new Error('network error'));
      const renderer = await renderScreen();

      await runPhotoMenu(renderer, '사진 변경');
      // A new upload is a new Blob with its own read URL - no cached image of the old one can show.
      expect(shownPhoto(renderer)).toBe('https://blob.example/8.jpg');

      await runPhotoMenu(renderer, '사진 변경');
      expect(shownPhoto(renderer)).toBe('https://blob.example/8.jpg');
      expect(has(renderer, 'representative-photo-busy')).toBe(false);
      expect(renderer.root.findByProps({ children: '사진을 업로드할 수 없습니다.' })).toBeTruthy();
      expect(getItemDetails).toHaveBeenCalledTimes(1);
      expect(getItemImages).toHaveBeenCalledTimes(1);
    });

    it('delete (after confirming) shows 사진 추가 at once; a failed delete keeps the photo', async () => {
      jest.mocked(getItemImages).mockResolvedValue([makeImage({ id: 7, readUrl: 'https://blob.example/7.jpg' })]);
      jest.mocked(deleteItemImage).mockRejectedValueOnce(new Error('network error')).mockResolvedValueOnce(undefined);
      const renderer = await renderScreen();

      await removeWithConfirmation(renderer);
      expect(shownPhoto(renderer)).toBe('https://blob.example/7.jpg');
      expect(renderer.root.findByProps({ children: '사진을 삭제할 수 없습니다.' })).toBeTruthy();

      await removeWithConfirmation(renderer);
      expect(deleteItemImage).toHaveBeenLastCalledWith(expect.anything(), 1, 7);
      expect(shownPhoto(renderer)).toBeNull();
      expect(byTestId(renderer, 'representative-photo-add')).toHaveLength(1);
      expect(getItemDetails).toHaveBeenCalledTimes(1);
      expect(getItemImages).toHaveBeenCalledTimes(1);
    });

    it('the automatic link preview is the photo when there is none of my own - it can be replaced, not deleted', async () => {
      jest.mocked(getItemDetails).mockResolvedValue(makeItemDetails({ previewImageUrl: 'https://cdn.example.com/preview.jpg' }));
      jest.mocked(uploadItemImage).mockResolvedValue(makeImage({ id: 9, readUrl: 'https://blob.example/9.jpg' }));
      jest.mocked(deleteItemImage).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      expect(shownPhoto(renderer)).toBe('https://cdn.example.com/preview.jpg');
      expect(await openPhotoMenu(renderer)).toEqual(['사진 변경']);
      const menu = renderer.root.findAllByType(ActionMenuDialog).find((dialog: ReactTestRenderer.ReactTestInstance) => dialog.props.visible)!;
      await act(async () => {
        await menu.props.onCancel();
      });

      // My own photo goes ahead of the preview...
      await runPhotoMenu(renderer, '사진 변경');
      expect(shownPhoto(renderer)).toBe('https://blob.example/9.jpg');
      // ...and deleting it falls back to the preview, again with no reload.
      await removeWithConfirmation(renderer);
      expect(shownPhoto(renderer)).toBe('https://cdn.example.com/preview.jpg');
      expect(getItemDetails).toHaveBeenCalledTimes(1);
    });

    it('an Item saved with two photos shows its cover, and deleting it leaves none (the server removed both)', async () => {
      jest.mocked(getItemDetails).mockResolvedValue(makeItemDetails({ coverImage: { id: 8, readUrl: 'https://blob.example/8.jpg' } }));
      jest.mocked(getItemImages).mockResolvedValue([
        makeImage({ id: 7, sortOrder: 0, readUrl: 'https://blob.example/7.jpg' }),
        makeImage({ id: 8, sortOrder: 1, readUrl: 'https://blob.example/8.jpg' }),
      ]);
      jest.mocked(deleteItemImage).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      expect(shownPhoto(renderer)).toBe('https://blob.example/8.jpg');
      expect(renderer.root.findAll(node => node.type === Image && node.props.testID === 'representative-photo-image')).toHaveLength(1);

      await removeWithConfirmation(renderer);
      expect(deleteItemImage).toHaveBeenCalledWith(expect.anything(), 1, 8);
      // No hidden second photo surfaces in its place.
      expect(shownPhoto(renderer)).toBeNull();
    });

    it('add, change and delete never touch an unsaved memo or Collection choice, and never reload them', async () => {
      jest.mocked(uploadItemImage)
        .mockResolvedValueOnce(makeImage({ id: 9, readUrl: 'https://blob.example/9.jpg' }))
        .mockResolvedValueOnce(makeImage({ id: 10, readUrl: 'https://blob.example/10.jpg' }));
      jest.mocked(deleteItemImage).mockResolvedValue(undefined);
      jest.mocked(updateItemDetails).mockResolvedValue(undefined);
      jest.mocked(addItemToCollection).mockResolvedValue('added');
      const renderer = await renderScreen();
      const collectionLoads = () => jest.mocked(getCollections).mock.calls.filter(([, options]) => options?.itemId === 1).length;
      const loadsBefore = collectionLoads();

      // Unsaved drafts: a memo and a Collection added to the Item.
      await act(async () => {
        memoInput(renderer).props.onChangeText('not saved yet');
      });
      await act(async () => {
        findPressableByAccessibilityLabel(renderer, i18n.t('item.categoryEditA11y'))?.props.onPress();
      });
      await act(async () => {
        await findPressableByAccessibilityLabel(renderer, 'Wishlist')?.props.onPress();
      });

      await pressAdd(renderer);
      await runPhotoMenu(renderer, '사진 변경');
      await removeWithConfirmation(renderer);

      expect(memoInput(renderer).props.value).toBe('not saved yet');
      expect(getItemDetails).toHaveBeenCalledTimes(1);
      expect(getItemImages).toHaveBeenCalledTimes(1);
      expect(collectionLoads()).toBe(loadsBefore);
      // Both drafts are still exactly what Save sends.
      expect(isSaveDisabled(renderer)).toBe(false);
      await act(async () => {
        await findPressableByText(renderer, '저장')?.props.onPress();
      });
      expect(updateItemDetails).toHaveBeenCalledWith(expect.anything(), 1, { title: 'Original title', memo: 'not saved yet' });
      expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), 5, 1, expect.anything());
    });

    it('a photo change alone is not an unsaved edit - Save stays off and leaving does not warn', async () => {
      jest.mocked(uploadItemImage).mockResolvedValue(makeImage({ id: 9 }));
      const renderer = await renderScreen();

      await pressAdd(renderer);

      expect(isSaveDisabled(renderer)).toBe(true);
      expect(latestPreventRemoveIsDirty()).toBe(false);
    });
  });

  describe('categories - staged, only persisted on Save', () => {
    /** Opens the compact summary row's picker Modal (see categorySummaryRow in ItemDetailsScreen - an icon-only row action, found by accessibilityLabel not text). */
    async function openCategoryModal(renderer: ReactTestRenderer.ReactTestRenderer): Promise<void> {
      await act(async () => {
        findPressableByAccessibilityLabel(renderer, i18n.t('item.categoryEditA11y'))?.props.onPress();
      });
    }

    /** Taps a category row inside the picker Modal by name - add if unselected, remove (toggle off) if already selected. Uses accessibilityLabel, not text, because the compact summary's own selected-category chips repeat the same name outside the Modal. */
    async function toggleCategoryInModal(
      renderer: ReactTestRenderer.ReactTestRenderer,
      name: string,
    ): Promise<void> {
      await act(async () => {
        await findPressableByAccessibilityLabel(renderer, name)?.props.onPress();
      });
    }

    it('shows each category\'s own pastel icon tile in the picker - not a plain gray outline icon', async () => {
      jest.mocked(getCollections).mockImplementation(
        async (_request, options: GetCollectionsOptions = {}) => {
          if (options.itemId) {
            return { items: [], nextCursor: null };
          }
          return { items: [makeCollection({ id: 5, name: 'Wishlist', icon: 'Plane' })], nextCursor: null };
        },
      );
      const renderer = await renderScreen();

      await openCategoryModal(renderer);

      const { PlaneIcon } = require('../../icons/PlaneIcon');
      const { FolderIcon } = require('../../icons/FolderIcon');
      expect(renderer.root.findAllByType(PlaneIcon).length).toBeGreaterThan(0);
      expect(renderer.root.findAllByType(FolderIcon)).toHaveLength(0);
    });

    it('category add stages locally with no immediate API call, and enables Save', async () => {
      const renderer = await renderScreen();
      expect(isSaveDisabled(renderer)).toBe(true);

      await openCategoryModal(renderer);
      await toggleCategoryInModal(renderer, 'Wishlist');

      expect(addItemToCollection).not.toHaveBeenCalled();
      expect(isSaveDisabled(renderer)).toBe(false);
    });

    it('category remove stages locally with no immediate API call, and enables Save', async () => {
      jest.mocked(getCollections).mockImplementation(
        async (_request, options: GetCollectionsOptions = {}) => {
          if (options.itemId) {
            return { items: [makeCollection({ id: 5, name: 'Wishlist' })], nextCursor: null };
          }
          return { items: [makeCollection({ id: 5, name: 'Wishlist' })], nextCursor: null };
        },
      );
      const renderer = await renderScreen();
      expect(isSaveDisabled(renderer)).toBe(true);

      await openCategoryModal(renderer);
      await toggleCategoryInModal(renderer, 'Wishlist');

      expect(removeItemFromCollection).not.toHaveBeenCalled();
      expect(isSaveDisabled(renderer)).toBe(false);
    });

    it('reverting a staged category change (remove then re-add) disables Save again', async () => {
      jest.mocked(getCollections).mockImplementation(
        async (_request, options: GetCollectionsOptions = {}) => {
          if (options.itemId) {
            return { items: [makeCollection({ id: 5, name: 'Wishlist' })], nextCursor: null };
          }
          return { items: [makeCollection({ id: 5, name: 'Wishlist' })], nextCursor: null };
        },
      );
      const renderer = await renderScreen();

      await openCategoryModal(renderer);
      await toggleCategoryInModal(renderer, 'Wishlist');
      expect(isSaveDisabled(renderer)).toBe(false);

      await toggleCategoryInModal(renderer, 'Wishlist');

      expect(isSaveDisabled(renderer)).toBe(true);
    });

    it('a 승인 후 추가 Collection takes it as a proposal: said once saved, and it does not stay selected (it is not in there yet)', async () => {
      jest.mocked(getCollections).mockImplementation(
        async (_request, options: GetCollectionsOptions = {}) => {
          if (options.itemId) {
            return { items: [], nextCursor: null };
          }
          return { items: [makeCollection({ id: 9, name: 'Team ideas', accessRole: 'submitter' })], nextCursor: null };
        },
      );
      jest.mocked(addItemToCollection).mockResolvedValue('submitted');
      const renderer = await renderScreen();

      await openCategoryModal(renderer);
      await toggleCategoryInModal(renderer, 'Team ideas');
      await act(async () => {
        await findPressableByText(renderer, '저장')?.props.onPress();
      });

      expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), 9, 1, expect.anything());
      // A dialog, not a toast: the link itself is saved, and the request was sent.
      const dialog = renderer.root.findAll(
        node => node.type === ConfirmDialog && node.props.visible === true && node.props.title === i18n.t('collections.saveOutcomeTitle'),
      )[0];
      expect(dialog.props.message).toBe(i18n.t('collections.saveOutcomeSubmitted', { count: 1 }));
      expect(renderer.root.findAllByType(Text).some(node => node.props.children === i18n.t('item.saved'))).toBe(false);
      // Not a membership: nothing left unsaved, and Save is off again.
      expect(latestPreventRemoveIsDirty()).toBe(false);
      expect(isSaveDisabled(renderer)).toBe(true);
    });

    it('a link already in that Collection, or already waiting there, says exactly that', async () => {
      jest.mocked(addItemToCollection).mockRejectedValue(new ApiError('conflict', 409, 'linkAlreadyPending'));
      const renderer = await renderScreen();

      await openCategoryModal(renderer);
      await toggleCategoryInModal(renderer, 'Wishlist');
      await act(async () => {
        await findPressableByText(renderer, '저장')?.props.onPress();
      });

      // In the shared message dialog - never a red line under the form.
      const dialog = findVisibleConfirmDialog(renderer, i18n.t('common.notice'));
      expect(dialog.props.message).toBe('이미 승인 대기 중인 링크예요.');
      expect(dialog.props.onCancel).toBeUndefined();
      // Settled: nothing is left to save for that Collection, so it does not keep Save on.
      expect(isSaveDisabled(renderer)).toBe(true);
    });

    it('a duplicate proposal keeps the unsaved memo and the other choices, and never reloads the item', async () => {
      const { Keyboard } = require('react-native');
      const dismissSpy = jest.spyOn(Keyboard, 'dismiss');
      jest.mocked(addItemToCollection).mockRejectedValue(new ApiError('conflict', 409, 'linkAlreadyInCollection'));
      jest.mocked(updateItemDetails).mockRejectedValue(new Error('network error'));
      const renderer = await renderScreen();
      const memoInput = () => renderer.root.findAllByType(TextInput).find(input => input.props.placeholder === i18n.t('item.memoPlaceholder'))!;

      await act(async () => {
        memoInput().props.onChangeText('draft memo');
      });
      await openCategoryModal(renderer);
      await toggleCategoryInModal(renderer, 'Wishlist');
      await act(async () => {
        await findPressableByText(renderer, '저장')?.props.onPress();
      });

      expect(dismissSpy).toHaveBeenCalled();
      // Every reason in ONE dialog, each once.
      const dialog = findVisibleConfirmDialog(renderer, i18n.t('common.notice'));
      expect(dialog.props.message).toBe(`${i18n.t('item.errorSaveFallback')}\n${i18n.t('collections.linkAlreadyInCollection')}`);
      await act(async () => {
        dialog.props.onConfirm();
      });
      expect(findVisibleConfirmDialog(renderer, i18n.t('common.notice'))).toBeUndefined();
      // The memo that did not save is still there to retry; nothing was reloaded.
      expect(memoInput().props.value).toBe('draft memo');
      expect(isSaveDisabled(renderer)).toBe(false);
      expect(getItemDetails).toHaveBeenCalledTimes(1);
      dismissSpy.mockRestore();
    });

    it('a staged category change triggers the unsaved-changes back warning until saved', async () => {
      jest.mocked(addItemToCollection).mockResolvedValue('added');
      const renderer = await renderScreen();
      expect(latestPreventRemoveIsDirty()).toBe(false);

      await openCategoryModal(renderer);
      await toggleCategoryInModal(renderer, 'Wishlist');
      expect(latestPreventRemoveIsDirty()).toBe(true);

      await act(async () => {
        await findPressableByText(renderer, '저장')?.props.onPress();
      });
      expect(latestPreventRemoveIsDirty()).toBe(false);
    });

    it('Save calls addItemToCollection/removeItemFromCollection for exactly the staged diff', async () => {
      jest.mocked(getCollections).mockImplementation(
        async (_request, options: GetCollectionsOptions = {}) => {
          if (options.itemId) {
            return { items: [makeCollection({ id: 5, name: 'Wishlist' })], nextCursor: null };
          }
          return {
            items: [
              makeCollection({ id: 5, name: 'Wishlist' }),
              makeCollection({ id: 6, name: 'Groceries' }),
            ],
            nextCursor: null,
          };
        },
      );
      jest.mocked(addItemToCollection).mockResolvedValue('added');
      jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      // Remove the existing membership (Wishlist) and add a new one (Groceries).
      await openCategoryModal(renderer);
      await toggleCategoryInModal(renderer, 'Wishlist');
      await toggleCategoryInModal(renderer, 'Groceries');

      await act(async () => {
        await findPressableByText(renderer, '저장')?.props.onPress();
      });

      expect(removeItemFromCollection).toHaveBeenCalledWith(expect.anything(), 5, 1, { unlockToken: null });
      expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), 6, 1, { unlockToken: null });
      expect(isSaveDisabled(renderer)).toBe(true);
      expect(renderer.root.findByProps({ children: '저장되었습니다.' })).toBeTruthy();
      expect(renderer.root.findAllByType(ConfirmDialog).filter(dialog => dialog.props.visible && dialog.props.message === '저장되었습니다.')).toHaveLength(0);
    });

    it('never shows a saved message before Save is actually pressed, even after staging a category change', async () => {
      const renderer = await renderScreen();

      await openCategoryModal(renderer);
      await toggleCategoryInModal(renderer, 'Wishlist');

      expect(renderer.root.findAllByProps({ children: '저장되었습니다.' })).toHaveLength(0);
    });

    it('a partial category save failure keeps only the failed diff pending, and retry does not redo the succeeded one', async () => {
      jest.mocked(getCollections).mockImplementation(
        async (_request, options: GetCollectionsOptions = {}) => {
          if (options.itemId) {
            return { items: [], nextCursor: null };
          }
          return {
            items: [
              makeCollection({ id: 5, name: 'Wishlist' }),
              makeCollection({ id: 6, name: 'Groceries' }),
            ],
            nextCursor: null,
          };
        },
      );
      jest.mocked(addItemToCollection).mockImplementation(async (_request, collectionId) => {
        if (collectionId === 6) {
          throw new Error('network error');
        }
        return 'added';
      });
      const renderer = await renderScreen();

      await openCategoryModal(renderer);
      await toggleCategoryInModal(renderer, 'Wishlist');
      await toggleCategoryInModal(renderer, 'Groceries');

      await act(async () => {
        await findPressableByText(renderer, '저장')?.props.onPress();
      });

      expect(addItemToCollection).toHaveBeenCalledTimes(2);
      // Wishlist succeeded, Groceries failed - Save must stay enabled (Groceries still pending).
      expect(isSaveDisabled(renderer)).toBe(false);
      expect(renderer.root.findAllByProps({ children: '저장되었습니다.' })).toHaveLength(0);

      jest.mocked(addItemToCollection).mockResolvedValue('added');
      await act(async () => {
        await findPressableByText(renderer, '저장')?.props.onPress();
      });

      // Only the still-pending Groceries add is retried - Wishlist (already succeeded) is not
      // re-sent a third time.
      expect(addItemToCollection).toHaveBeenCalledTimes(3);
      expect(isSaveDisabled(renderer)).toBe(true);
    });

    describe('Collections shared with me', () => {
      const wishlist = makeCollection({ id: 5, name: 'Wishlist', accessRole: 'owner' });
      const sharedTrip = makeCollection({ id: 9, name: 'Shared Trip', accessRole: 'contributor', ownerJupleId: 'WNER2345' });

      beforeEach(() => {
        jest.mocked(getCollections).mockImplementation(async (_request, options: GetCollectionsOptions = {}) => {
          if (options.itemId) {
            // Only the 'all' scope includes the ones shared with me.
            return { items: options.scope === 'all' ? [wishlist, sharedTrip] : [wishlist], nextCursor: null };
          }
          if (options.scope === 'shared') {
            // The server lists my own shared Collection under 'shared' as well.
            return { items: [wishlist, sharedTrip], nextCursor: null };
          }
          return { items: [wishlist], nextCursor: null };
        });
      });

      it('lists every Collection the link is in - my own and the ones shared with me', async () => {
        const renderer = await renderScreen();

        expect(getCollections).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ itemId: 1, scope: 'all' }));
        const shown = renderer.root.findAllByType(Text).map(node => node.props.children);
        expect(shown).toEqual(expect.arrayContaining(['Wishlist', 'Shared Trip']));
        expect(isSaveDisabled(renderer)).toBe(true);
      });

      it('a shared-with-me Collection the link is already in is not deselected - only its Owner can take the link out', async () => {
        const renderer = await renderScreen();
        await openCategoryModal(renderer);
        await toggleCategoryInModal(renderer, 'Shared Trip');

        expect(isSaveDisabled(renderer)).toBe(true);
        expect(renderer.root.findAllByType(Text).some(node => node.props.children === i18n.t('collections.removeFromSharedOwnerOnly'))).toBe(true);

        // The picker lists my own shared Collection once, not again among the shared ones.
        expect(renderer.root.findAll(node => typeof node.type === 'string' && node.props.accessibilityLabel === 'Wishlist')).toHaveLength(1);

        // My own Collection is still mine to change.
        await toggleCategoryInModal(renderer, 'Wishlist');
        expect(isSaveDisabled(renderer)).toBe(false);
        expect(removeItemFromCollection).not.toHaveBeenCalled();
        act(() => renderer.unmount());
      });
    });
  });

  describe('category summary (compact chips)', () => {
    function mockSelectedCategories(items: readonly Collection[]): void {
      jest.mocked(getCollections).mockImplementation(
        async (_request, options: GetCollectionsOptions = {}) => {
          if (options.itemId) {
            return { items, nextCursor: null };
          }
          return { items: [], nextCursor: null };
        },
      );
    }

    it('shows the "no categories selected" message when there are none', async () => {
      mockSelectedCategories([]);
      const renderer = await renderScreen();

      expect(
        renderer.root.findByProps({ children: i18n.t('collections.itemSectionEmpty') }),
      ).toBeTruthy();
    });

    it('shows every chip inline with no "+N" chip when there are 1-3 categories', async () => {
      mockSelectedCategories([
        makeCollection({ id: 1, name: 'A' }),
        makeCollection({ id: 2, name: 'B' }),
        makeCollection({ id: 3, name: 'C' }),
      ]);
      const renderer = await renderScreen();

      expect(renderer.root.findByProps({ children: 'A' })).toBeTruthy();
      expect(renderer.root.findByProps({ children: 'B' })).toBeTruthy();
      expect(renderer.root.findByProps({ children: 'C' })).toBeTruthy();
      expect(
        renderer.root.findAll(node => typeof node.props.children === 'string' && /^\+\d+$/.test(node.props.children)),
      ).toHaveLength(0);
    });

    it('collapses everything past the 3rd selected category into a single "+N" chip', async () => {
      mockSelectedCategories([
        makeCollection({ id: 1, name: 'A' }),
        makeCollection({ id: 2, name: 'B' }),
        makeCollection({ id: 3, name: 'C' }),
        makeCollection({ id: 4, name: 'D' }),
        makeCollection({ id: 5, name: 'E' }),
      ]);
      const renderer = await renderScreen();

      expect(renderer.root.findByProps({ children: 'A' })).toBeTruthy();
      expect(renderer.root.findByProps({ children: 'B' })).toBeTruthy();
      expect(renderer.root.findByProps({ children: 'C' })).toBeTruthy();
      expect(renderer.root.findAll(node => node.props.children === 'D')).toHaveLength(0);
      expect(renderer.root.findAll(node => node.props.children === 'E')).toHaveLength(0);
      expect(renderer.root.findByProps({ children: '+2' })).toBeTruthy();
    });

    it('truncates a long category name to a single line instead of growing the screen', async () => {
      const longName = 'A'.repeat(60);
      mockSelectedCategories([makeCollection({ id: 1, name: longName })]);
      const renderer = await renderScreen();

      expect(renderer.root.findByProps({ children: longName }).props.numberOfLines).toBe(1);
    });

    it('the compact summary never grows past the 3-chip cap regardless of how many categories are selected', async () => {
      mockSelectedCategories(
        Array.from({ length: 12 }, (_, index) =>
          makeCollection({ id: index + 1, name: `Category ${index + 1}` }),
        ),
      );
      const renderer = await renderScreen();

      expect(renderer.root.findByProps({ children: '+9' })).toBeTruthy();
      expect(renderer.root.findAll(node => node.props.children === 'Category 12')).toHaveLength(0);
    });
  });

  describe('URL section - compact, no in-screen share', () => {
    it('shows an icon-only URL-open action (no visible text) and no 공유하기 button', async () => {
      const renderer = await renderScreen();

      expect(findPressableByAccessibilityLabel(renderer, i18n.t('item.goToUrlA11y'))).toBeTruthy();
      expect(findPressableByText(renderer, i18n.t('item.goToUrl'))).toBeFalsy();
      expect(findPressableByText(renderer, i18n.t('item.share'))).toBeFalsy();
    });

    it('opens the original URL directly when the URL-open action is pressed', async () => {
      const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
      const renderer = await renderScreen();

      await act(async () => {
        await findPressableByAccessibilityLabel(renderer, i18n.t('item.goToUrlA11y'))?.props.onPress();
      });

      expect(openUrlSpy).toHaveBeenCalledWith('https://example.com');
    });
  });

  describe('opened from inside a Collection: delete means "remove from this Collection"', () => {
    async function renderFromCollection(canRemove: boolean) {
      const collectionRoute = {
        key: 'ItemDetails',
        name: 'ItemDetails',
        params: { itemId: 1, collectionContext: { collectionId: 9, canRemove, isCollectionOwner: canRemove } },
      } as never;
      let renderer!: ReactTestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <AppToastProvider>
            <ItemDetailsScreen navigation={navigation} route={collectionRoute} />
          </AppToastProvider>,
        );
      });
      return renderer;
    }

    it('the button says 컬렉션에서 삭제 and, after confirming, removes only this Collection membership - never the link itself', async () => {
      jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
      const renderer = await renderFromCollection(true);

      const button = renderer.root.findByProps({ testID: 'item-details-delete' });
      expect(button.findByType(Text).props.children).toBe(i18n.t('collections.removeFromCollection'));
      expect(findPressableByText(renderer, '삭제')).toBeUndefined();

      await act(async () => {
        button.props.onPress();
      });
      expect(removeItemFromCollection).not.toHaveBeenCalled();
      const confirm = renderer.root.findAll(
        node => node.type === ConfirmDialog && node.props.visible === true && node.props.title === i18n.t('collections.unlinkConfirmTitle'),
      )[0];
      expect(confirm.props.message).toBe(i18n.t('collections.unlinkConfirmMessage'));

      await act(async () => {
        await confirm.props.onConfirm();
      });

      // Collection 9 only (the one it was opened from), with this visit's stored unlock grant.
      expect(removeItemFromCollection).toHaveBeenCalledWith(expect.anything(), 9, 1);
      expect(deleteItem).not.toHaveBeenCalled();
      expect((navigation as unknown as { goBack: jest.Mock }).goBack).toHaveBeenCalled();
      expect(renderer.root.findAllByType(Text).some(node => node.props.children === i18n.t('toast.unlinkSuccess'))).toBe(true);
      act(() => renderer.unmount());
    });

    it('someone who is not the Collection\'s Owner is told why, and nothing is removed or deleted', async () => {
      const renderer = await renderFromCollection(false);

      await act(async () => {
        renderer.root.findByProps({ testID: 'item-details-delete' }).props.onPress();
      });

      expect(renderer.root.findAllByType(Text).some(node => node.props.children === i18n.t('collections.removeFromSharedOwnerOnly'))).toBe(true);
      expect(renderer.root.findAll(node => node.type === ConfirmDialog && node.props.visible === true)).toHaveLength(0);
      expect(removeItemFromCollection).not.toHaveBeenCalled();
      expect(deleteItem).not.toHaveBeenCalled();
      act(() => renderer.unmount());
    });

    it('a failed removal stays on the screen with the reason', async () => {
      jest.mocked(removeItemFromCollection).mockRejectedValue(new Error('network'));
      const renderer = await renderFromCollection(true);

      await act(async () => {
        renderer.root.findByProps({ testID: 'item-details-delete' }).props.onPress();
      });
      const confirm = renderer.root.findAll(node => node.type === ConfirmDialog && node.props.visible === true)[0];
      await act(async () => {
        await confirm.props.onConfirm();
      });

      expect(renderer.root.findAllByType(Text).some(node => node.props.children === i18n.t('collections.errorMembershipFallback'))).toBe(true);
      expect((navigation as unknown as { goBack: jest.Mock }).goBack).not.toHaveBeenCalled();
    });
  });

  describe('the Collection\'s reactions and comments on my own link - only when opened from a collaborative Collection', () => {
    const comment = (id: number, authorOverrides = {}, body = `comment ${id}`): ItemComment => ({
      id,
      body,
      createdAtUtc: new Date().toISOString(),
      author: { jupleId: 'ABCD2345', displayName: '민욱', profileImageUrl: null, profileImageVersion: null, isCollectionOwner: false, isMe: false, ...authorOverrides },
    });
    const sharedRow = (overrides = {}) => ({
      itemId: 1, url: 'https://example.com', title: 'Original title', previewImageUrl: null, addedAtUtc: '2026-01-01T00:00:00Z', isMine: true, ...overrides,
    });
    const press = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
      renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];
    const has = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
      renderer.root.findAll(node => node.props.testID === testID).length > 0;
    const shown = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));
    const memoField = (renderer: ReactTestRenderer.ReactTestRenderer) =>
      renderer.root.findAllByType(TextInput).find(node => node.props.placeholder === i18n.t('item.memoPlaceholder'))!;
    const composerInput = (renderer: ReactTestRenderer.ReactTestRenderer) =>
      renderer.root.findAll(node => node.props.testID === 'comment-input' && node.type === TextInput)[0];

    async function renderFrom(collectionContext?: { collectionId: number; canRemove: boolean; isCollectionOwner: boolean; isCollaborative?: boolean }) {
      const contextRoute = { key: 'ItemDetails', name: 'ItemDetails', params: { itemId: 1, collectionContext } } as never;
      let renderer!: ReactTestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <AppToastProvider>
            <ItemDetailsScreen navigation={navigation} route={contextRoute} />
          </AppToastProvider>,
        );
      });
      return renderer;
    }
    const collaborative = { collectionId: 9, canRemove: true, isCollectionOwner: false, isCollaborative: true };

    beforeEach(() => {
      clearCollectionUnlockGrants();
      jest.mocked(getSharedCollectionItem).mockResolvedValue(sharedRow());
      jest.mocked(getItemComments).mockResolvedValue({ items: [], previousCursor: null, totalCount: 0 });
    });

    it('A. my own link opened from a collaborative Collection shows that Collection\'s reactions and comments, below the normal form', async () => {
      jest.mocked(getSharedCollectionItem).mockResolvedValue(sharedRow({ reactions: [{ key: 'heart', count: 2 }], myReaction: 'heart' }));
      jest.mocked(getItemComments).mockResolvedValue({ items: [comment(1), comment(2, { isMe: true })], previousCursor: null, totalCount: 2 });
      const renderer = await renderFrom(collaborative);

      expect(getSharedCollectionItem).toHaveBeenCalledWith(expect.anything(), 9, 1, null);
      expect(getItemComments).toHaveBeenCalledWith(expect.anything(), 9, 1, { unlockToken: null });
      expect(press(renderer, 'shared-item-reactions-heart').props.accessibilityState).toEqual({ selected: true });
      expect(shown(renderer)).toContain('댓글 2');
      expect(has(renderer, 'comment-composer')).toBe(true);
      // After the item\'s own fields (memo is above), in the same order as the shared view: reactions, comments, composer.
      const order = renderer.root
        .findAll(node => typeof node.type === 'string' && ['representative-photo-add', 'shared-item-reactions', 'comments-section', 'comment-composer'].includes(node.props.testID))
        .map(node => node.props.testID);
      expect(order.filter((id: string, index: number, all: string[]) => all.indexOf(id) === index).slice(-3)).toEqual(['shared-item-reactions', 'comments-section', 'comment-composer']);
      // The item itself is as it was: still editable, still one load.
      expect(memoField(renderer).props.editable).not.toBe(false);
      expect(getItemDetails).toHaveBeenCalledTimes(1);
    });

    it('B + C. opened from Home or History (no Collection context at all) there is no collaboration - and nothing is requested', async () => {
      const renderer = await renderScreen();

      expect(has(renderer, 'shared-item-reactions')).toBe(false);
      expect(has(renderer, 'comments-section')).toBe(false);
      expect(has(renderer, 'comment-composer')).toBe(false);
      expect(getSharedCollectionItem).not.toHaveBeenCalled();
      expect(getItemComments).not.toHaveBeenCalled();
    });

    it('B + C. only the Collection screen passes a Collection context to ItemDetails - Home, History and the others never guess one', () => {
      const fs = require('fs');
      const path = require('path');
      const walk = (directory: string): string[] =>
        fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry: { name: string; isDirectory: () => boolean }) =>
          entry.isDirectory() ? (entry.name === '__tests__' ? [] : walk(path.join(directory, entry.name))) : [path.join(directory, entry.name)]);
      const withContext = walk(path.resolve(__dirname, '../..'))
        .filter((file: string) => /\.tsx?$/.test(file))
        .filter((file: string) => /collectionContext\s*:/.test(fs.readFileSync(file, 'utf8')))
        .map((file: string) => path.basename(file))
        .sort();

      expect(withContext).toEqual(['CollectionDetailsScreen.tsx', 'RootStack.tsx']);
    });

    it('D. my link in a private Collection (no one else in it) - or a context that does not say - has no collaboration section', async () => {
      for (const context of [{ collectionId: 9, canRemove: true, isCollectionOwner: true, isCollaborative: false }, { collectionId: 9, canRemove: true, isCollectionOwner: true }]) {
        jest.clearAllMocks();
        jest.mocked(getItemDetails).mockResolvedValue(makeItemDetails());
        const renderer = await renderFrom(context);

        expect(has(renderer, 'shared-item-reactions')).toBe(false);
        expect(has(renderer, 'comment-composer')).toBe(false);
        expect(getSharedCollectionItem).not.toHaveBeenCalled();
        expect(getItemComments).not.toHaveBeenCalled();
      }
    });

    it('E. the same link in two Collections: the shared one shows ITS conversation, the private one nothing - never merged', async () => {
      jest.mocked(getSharedCollectionItem).mockResolvedValue(sharedRow({ reactions: [{ key: 'fire', count: 1 }], myReaction: null }));
      jest.mocked(getItemComments).mockResolvedValue({ items: [comment(5, {}, 'only in A')], previousCursor: null, totalCount: 1 });

      const inA = await renderFrom({ collectionId: 9, canRemove: true, isCollectionOwner: false, isCollaborative: true });
      expect(shown(inA)).toContain('only in A');
      expect(getItemComments).toHaveBeenCalledWith(expect.anything(), 9, 1, expect.anything());
      expect(getSharedCollectionItem).toHaveBeenCalledWith(expect.anything(), 9, 1, null);

      jest.clearAllMocks();
      jest.mocked(getItemDetails).mockResolvedValue(makeItemDetails());
      const inB = await renderFrom({ collectionId: 10, canRemove: true, isCollectionOwner: true, isCollaborative: false });
      expect(shown(inB)).not.toContain('only in A');
      expect(has(inB, 'comments-section')).toBe(false);
      expect(getItemComments).not.toHaveBeenCalled();
    });

    it('F. a reaction never wipes an unsaved memo or Collection choice, and never reloads the item', async () => {
      jest.mocked(setItemReaction).mockResolvedValue({ reactions: [{ key: 'heart', count: 1 }], myReaction: 'heart' });
      jest.mocked(getSharedCollectionItem).mockResolvedValue(sharedRow({ reactions: [{ key: 'heart', count: 0 }], myReaction: null }));
      const renderer = await renderFrom(collaborative);
      await act(async () => {
        memoField(renderer).props.onChangeText('unsaved memo');
      });
      await act(async () => {
        findPressableByAccessibilityLabel(renderer, i18n.t('item.categoryEditA11y'))?.props.onPress();
      });
      await act(async () => {
        await findPressableByAccessibilityLabel(renderer, 'Wishlist')?.props.onPress();
      });
      const detailLoads = jest.mocked(getItemDetails).mock.calls.length;
      const commentLoads = jest.mocked(getItemComments).mock.calls.length;

      await act(async () => press(renderer, 'shared-item-reactions-add').props.onPress());
      await act(async () => press(renderer, 'reaction-option-heart').props.onPress());

      expect(setItemReaction).toHaveBeenCalledWith(expect.anything(), 9, 1, 'heart', null);
      expect(memoField(renderer).props.value).toBe('unsaved memo');
      expect(isSaveDisabled(renderer)).toBe(false);
      expect(latestPreventRemoveIsDirty()).toBe(true);
      expect(getItemDetails).toHaveBeenCalledTimes(detailLoads);
      expect(getItemComments).toHaveBeenCalledTimes(commentLoads);
    });

    it('G. commenting and deleting a comment never wipe the memo, the Collection choice or the photo, and never reload the item', async () => {
      jest.mocked(getItemComments).mockResolvedValue({ items: [comment(2, { isMe: true })], previousCursor: null, totalCount: 1 });
      jest.mocked(addItemComment).mockResolvedValue(comment(3, { isMe: true }, 'new one'));
      jest.mocked(deleteItemComment).mockResolvedValue(undefined);
      jest.mocked(getCollections).mockImplementation(async (_request, options: GetCollectionsOptions = {}) =>
        options.itemId ? { items: [], nextCursor: null } : { items: [makeCollection({ id: 5, name: 'Wishlist' })], nextCursor: null });
      const renderer = await renderFrom(collaborative);
      await act(async () => {
        memoField(renderer).props.onChangeText('unsaved memo');
      });
      await act(async () => {
        findPressableByAccessibilityLabel(renderer, i18n.t('item.categoryEditA11y'))?.props.onPress();
      });
      await act(async () => {
        await findPressableByAccessibilityLabel(renderer, 'Wishlist')?.props.onPress();
      });
      const detailLoads = jest.mocked(getItemDetails).mock.calls.length;
      const imageLoads = jest.mocked(getItemImages).mock.calls.length;
      const collectionLoads = jest.mocked(getCollections).mock.calls.length;

      await act(async () => composerInput(renderer).props.onChangeText('new one'));
      await act(async () => press(renderer, 'comment-send').props.onPress());
      expect(shown(renderer)).toContain('댓글 2');
      await act(async () => press(renderer, 'comment-more-2').props.onPress());
      const { ActionMenuDialog } = require('../../components/ActionMenuDialog');
      await act(async () => renderer.root.findAllByType(ActionMenuDialog).find((dialog: ReactTestRenderer.ReactTestInstance) => dialog.props.visible)!.props.actions[0].onPress());
      await act(async () => findVisibleConfirmDialog(renderer, '댓글을 삭제할까요?')!.props.onConfirm());

      expect(addItemComment).toHaveBeenCalledWith(expect.anything(), 9, 1, 'new one', null);
      expect(deleteItemComment).toHaveBeenCalledWith(expect.anything(), 9, 1, 2, null);
      expect(memoField(renderer).props.value).toBe('unsaved memo');
      expect(isSaveDisabled(renderer)).toBe(false);
      expect(uploadItemImage).not.toHaveBeenCalled();
      expect(deleteItemImage).not.toHaveBeenCalled();
      expect(getItemDetails).toHaveBeenCalledTimes(detailLoads);
      expect(getItemImages).toHaveBeenCalledTimes(imageLoads);
      expect(getCollections).toHaveBeenCalledTimes(collectionLoads);
      expect(has(renderer, 'representative-photo-add')).toBe(true);
    });

    it('H. a locked Collection: the grant of this visit is used, and without access nothing is shown or requested', async () => {
      rememberCollectionUnlock(9, 'visit-grant', new Date(Date.now() + 600000).toISOString());
      const unlocked = await renderFrom(collaborative);
      expect(getSharedCollectionItem).toHaveBeenCalledWith(expect.anything(), 9, 1, 'visit-grant');
      expect(getItemComments).toHaveBeenCalledWith(expect.anything(), 9, 1, { unlockToken: 'visit-grant' });
      expect(has(unlocked, 'comment-composer')).toBe(true);

      jest.clearAllMocks();
      clearCollectionUnlockGrants();
      jest.mocked(getItemDetails).mockResolvedValue(makeItemDetails());
      jest.mocked(getSharedCollectionItem).mockRejectedValue(new ApiError('forbidden', 403, 'collectionLocked'));
      const locked = await renderFrom(collaborative);

      expect(has(locked, 'shared-item-reactions')).toBe(false);
      expect(has(locked, 'comment-composer')).toBe(false);
      expect(getItemComments).not.toHaveBeenCalled();
      expect(setItemReaction).not.toHaveBeenCalled();
      // The item itself is unaffected.
      expect(memoField(locked).props.value).toBe('Original memo');
    });

    describe('comment moderation follows owning the Collection - never canRemove or owning the link', () => {
      const thread = () =>
        jest.mocked(getItemComments).mockResolvedValue({ items: [comment(1), comment(2, { isMe: true })], previousCursor: null, totalCount: 2 });

      it('my link in someone elses Collection (canRemove, not the Collection owner): I delete my own comment, never another participants', async () => {
        thread();
        const renderer = await renderFrom({ collectionId: 9, canRemove: true, isCollectionOwner: false, isCollaborative: true });

        expect(has(renderer, 'comment-composer')).toBe(true);
        expect(press(renderer, 'comment-more-1')).toBeUndefined();
        expect(press(renderer, 'comment-more-2')).toBeDefined();
      });

      it('my own collaborative Collection: I may delete any comment, my link or not', async () => {
        thread();
        const renderer = await renderFrom({ collectionId: 9, canRemove: true, isCollectionOwner: true, isCollaborative: true });

        expect(press(renderer, 'comment-more-1')).toBeDefined();
        expect(press(renderer, 'comment-more-2')).toBeDefined();
      });

      it('canRemove alone changes nothing: owner without canRemove still moderates, canRemove without ownership never does', async () => {
        thread();
        const ownerOnly = await renderFrom({ collectionId: 9, canRemove: false, isCollectionOwner: true, isCollaborative: true });
        expect(press(ownerOnly, 'comment-more-1')).toBeDefined();

        const removeOnly = await renderFrom({ collectionId: 9, canRemove: true, isCollectionOwner: false, isCollaborative: true });
        expect(press(removeOnly, 'comment-more-1')).toBeUndefined();
      });
    });
  });

  describe('bottom action row - Delete/Save', () => {
    it('opened from Home/History (no Collection): the button is still a plain 삭제 of the link', async () => {
      const renderer = await renderScreen();

      expect(renderer.root.findByProps({ testID: 'item-details-delete' }).findByType(Text).props.children).toBe(i18n.t('common.delete'));
    });

    it('renders Delete and Save as a single action row', async () => {
      const renderer = await renderScreen();

      expect(findPressableByText(renderer, '삭제')).toBeTruthy();
      expect(findPressableByText(renderer, '저장')).toBeTruthy();
    });

    it('deletes the item only after confirming the shared ConfirmDialog, never on the first tap', async () => {
      jest.mocked(deleteItem).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      await act(async () => {
        findPressableByText(renderer, '삭제')?.props.onPress();
      });
      expect(deleteItem).not.toHaveBeenCalled();

      await act(async () => {
        await findPressableByAccessibilityLabel(renderer, '삭제')?.props.onPress();
      });

      expect(deleteItem).toHaveBeenCalledWith(expect.anything(), 1);
      expect((navigation as unknown as { goBack: jest.Mock }).goBack).toHaveBeenCalled();
    });

    it('deleting a dirty item never shows the unsaved-changes warning and navigates back exactly once', async () => {
      jest.mocked(deleteItem).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      const titleInput = renderer.root.findAllByType(TextInput)[0];
      await act(async () => {
        titleInput.props.onChangeText('Changed title');
      });
      expect(latestPreventRemoveIsDirty()).toBe(true);

      await act(async () => {
        findPressableByText(renderer, '삭제')?.props.onPress();
      });
      await act(async () => {
        await findPressableByAccessibilityLabel(renderer, '삭제')?.props.onPress();
      });

      expect(deleteItem).toHaveBeenCalledWith(expect.anything(), 1);
      // The guard must be disabled post-delete even though the title edit was never saved/reverted.
      expect(latestPreventRemoveIsDirty()).toBe(false);
      expect((navigation as unknown as { goBack: jest.Mock }).goBack).toHaveBeenCalledTimes(1);
    });

    it('Save is disabled and does nothing once delete has succeeded', async () => {
      jest.mocked(deleteItem).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      const titleInput = renderer.root.findAllByType(TextInput)[0];
      await act(async () => {
        titleInput.props.onChangeText('Changed title');
      });
      expect(isSaveDisabled(renderer)).toBe(false);

      await act(async () => {
        findPressableByText(renderer, '삭제')?.props.onPress();
      });
      await act(async () => {
        await findPressableByAccessibilityLabel(renderer, '삭제')?.props.onPress();
      });

      expect(isSaveDisabled(renderer)).toBe(true);

      await act(async () => {
        findPressableByText(renderer, '저장')?.props.onPress();
      });
      expect(updateItemDetails).not.toHaveBeenCalled();
    });

    it('a failed delete preserves dirty edits, shows the error, and never navigates back', async () => {
      jest.mocked(deleteItem).mockRejectedValue(new Error('server error'));
      const renderer = await renderScreen();

      const titleInput = renderer.root.findAllByType(TextInput)[0];
      await act(async () => {
        titleInput.props.onChangeText('Changed title');
      });

      await act(async () => {
        findPressableByText(renderer, '삭제')?.props.onPress();
      });
      await act(async () => {
        await findPressableByAccessibilityLabel(renderer, '삭제')?.props.onPress();
      });

      expect((navigation as unknown as { goBack: jest.Mock }).goBack).not.toHaveBeenCalled();
      expect(renderer.root.findByProps({ children: '항목을 삭제할 수 없습니다.' })).toBeTruthy();
      // Dirty state (the unsaved title edit) survives the failed delete - the user can still edit/Save/retry.
      expect(latestPreventRemoveIsDirty()).toBe(true);
      expect(isSaveDisabled(renderer)).toBe(false);
      expect(titleInput.props.value).toBe('Changed title');
    });
  });

});
