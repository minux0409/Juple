import ReactTestRenderer, { act } from 'react-test-renderer';
import { Alert, Linking, Text, TextInput } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import i18n from '../../i18n';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ItemDetailsScreen } from '../ItemDetailsScreen';
import { checkUrlSafety } from '../../urlSafety/api/urlSafetyApi';
import { deleteItem, getItemDetails, updateItemDetails, type ItemDetails } from '../../items/api/itemsApi';
import { deleteItemImage, getItemImages, uploadItemImage, type ItemImage } from '../../images/api/imagesApi';
import {
  addItemToCollection,
  getCollections,
  removeItemFromCollection,
  type Collection,
  type GetCollectionsOptions,
} from '../../collections/api/collectionsApi';
import { launchImageLibrary } from 'react-native-image-picker';

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
}));

jest.mock('../../images/api/imagesApi', () => ({
  getItemImages: jest.fn(),
  uploadItemImage: jest.fn(),
  deleteItemImage: jest.fn(),
}));

jest.mock('../../collections/api/collectionsApi', () => ({
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

jest.mock('../../urlSafety/api/urlSafetyApi', () => ({
  checkUrlSafety: jest.fn(),
}));

const route = { key: 'ItemDetails', name: 'ItemDetails', params: { itemId: 1 } } as never;
const navigation = { goBack: jest.fn() } as never;

function makeItemDetails(overrides: Partial<ItemDetails> = {}): ItemDetails {
  return {
    id: 1,
    url: 'https://example.com',
    title: 'Original title',
    memo: 'Original memo',
    savedAtUtc: new Date().toISOString(),
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

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <ItemDetailsScreen navigation={navigation} route={route} />,
    );
  });
  return renderer;
}

function findVisibleConfirmDialog(renderer: ReactTestRenderer.ReactTestRenderer, title: string) {
  return renderer.root.findAll(
    node => node.type === ConfirmDialog && node.props.visible === true && node.props.title === title,
  )[0];
}

function mockConfirmAlert(): jest.SpyInstance {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    const confirmButton = buttons?.find(button => button.style === 'destructive');
    confirmButton?.onPress?.();
  });
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

  describe('images - immediate persistence, never staged', () => {
    it('image add calls the upload API immediately', async () => {
      jest.mocked(uploadItemImage).mockResolvedValue(makeImage({ id: 9 }));
      const renderer = await renderScreen();

      await act(async () => {
        await findPressableByAccessibilityLabel(renderer, '사진 추가')?.props.onPress();
      });

      expect(uploadItemImage).toHaveBeenCalledTimes(1);
    });

    it('image delete calls the delete API immediately (after confirmation)', async () => {
      jest.mocked(getItemImages).mockResolvedValue([makeImage({ id: 7 })]);
      jest.mocked(deleteItemImage).mockResolvedValue(undefined);
      const alertSpy = mockConfirmAlert();
      const renderer = await renderScreen();

      const deleteButton = findPressableByAccessibilityLabel(renderer, '사진 삭제');
      await act(async () => {
        deleteButton.props.onPress();
      });

      expect(deleteItemImage).toHaveBeenCalledWith(expect.anything(), 1, 7);
      alertSpy.mockRestore();
    });

    it('image add/delete never affect isDirty - Save stays disabled for an image-only change', async () => {
      jest.mocked(getItemImages).mockResolvedValue([makeImage({ id: 7 })]);
      jest.mocked(uploadItemImage).mockResolvedValue(makeImage({ id: 9 }));
      jest.mocked(deleteItemImage).mockResolvedValue(undefined);
      const alertSpy = mockConfirmAlert();
      const renderer = await renderScreen();
      expect(isSaveDisabled(renderer)).toBe(true);

      await act(async () => {
        await findPressableByAccessibilityLabel(renderer, '사진 추가')?.props.onPress();
      });
      expect(isSaveDisabled(renderer)).toBe(true);

      const deleteButton = findPressableByAccessibilityLabel(renderer, '사진 삭제');
      await act(async () => {
        deleteButton.props.onPress();
      });
      expect(isSaveDisabled(renderer)).toBe(true);
      alertSpy.mockRestore();
    });

    it('an image-only change never triggers the unsaved-changes back warning', async () => {
      jest.mocked(uploadItemImage).mockResolvedValue(makeImage({ id: 9 }));
      const renderer = await renderScreen();
      expect(latestPreventRemoveIsDirty()).toBe(false);

      await act(async () => {
        await findPressableByAccessibilityLabel(renderer, '사진 추가')?.props.onPress();
      });

      expect(latestPreventRemoveIsDirty()).toBe(false);
    });

    it('an upload failure never leaves the UI looking like it succeeded', async () => {
      jest.mocked(uploadItemImage).mockRejectedValue(new Error('network error'));
      const renderer = await renderScreen();

      await act(async () => {
        await findPressableByAccessibilityLabel(renderer, '사진 추가')?.props.onPress();
      });

      expect(renderer.root.findAllByType(require('react-native').Image)).toHaveLength(0);
      expect(renderer.root.findByProps({ children: '사진을 업로드할 수 없습니다.' })).toBeTruthy();
    });
  });

  describe('categories - staged, only persisted on Save', () => {
    /** Opens the compact summary row's picker Modal (see categorySummaryRow/편집 in ItemDetailsScreen). */
    async function openCategoryModal(renderer: ReactTestRenderer.ReactTestRenderer): Promise<void> {
      await act(async () => {
        findPressableByText(renderer, i18n.t('collections.edit'))?.props.onPress();
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

    it('a staged category change triggers the unsaved-changes back warning until saved', async () => {
      jest.mocked(addItemToCollection).mockResolvedValue(undefined);
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
      jest.mocked(addItemToCollection).mockResolvedValue(undefined);
      jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      // Remove the existing membership (Wishlist) and add a new one (Groceries).
      await openCategoryModal(renderer);
      await toggleCategoryInModal(renderer, 'Wishlist');
      await toggleCategoryInModal(renderer, 'Groceries');

      await act(async () => {
        await findPressableByText(renderer, '저장')?.props.onPress();
      });

      expect(removeItemFromCollection).toHaveBeenCalledWith(expect.anything(), 5, 1);
      expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), 6, 1);
      expect(isSaveDisabled(renderer)).toBe(true);
      expect(renderer.root.findByProps({ children: '저장되었습니다.' })).toBeTruthy();
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

      jest.mocked(addItemToCollection).mockResolvedValue(undefined);
      await act(async () => {
        await findPressableByText(renderer, '저장')?.props.onPress();
      });

      // Only the still-pending Groceries add is retried - Wishlist (already succeeded) is not
      // re-sent a third time.
      expect(addItemToCollection).toHaveBeenCalledTimes(3);
      expect(isSaveDisabled(renderer)).toBe(true);
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
    it('shows a compact 이동 button and no 공유하기 button', async () => {
      const renderer = await renderScreen();

      expect(findPressableByText(renderer, i18n.t('item.goToUrl'))).toBeTruthy();
      expect(findPressableByText(renderer, i18n.t('item.share'))).toBeFalsy();
    });
  });

  describe('bottom action row - Delete/Save', () => {
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
  });

  describe('URL safety check on 이동', () => {
    it('opens the URL directly when the safety check finds no known threat', async () => {
      jest.mocked(checkUrlSafety).mockResolvedValue({ status: 'noKnownThreat', threats: [] });
      const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
      const renderer = await renderScreen();

      await act(async () => {
        await findPressableByText(renderer, i18n.t('item.goToUrl'))?.props.onPress();
      });

      expect(openUrlSpy).toHaveBeenCalledWith('https://example.com');
      expect(findVisibleConfirmDialog(renderer, i18n.t('item.urlSafetyThreatTitle'))).toBeFalsy();
    });

    it('opens the URL directly (non-blocking) when the safety check itself fails', async () => {
      jest.mocked(checkUrlSafety).mockRejectedValue(new Error('network down'));
      const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
      const renderer = await renderScreen();

      await act(async () => {
        await findPressableByText(renderer, i18n.t('item.goToUrl'))?.props.onPress();
      });

      expect(openUrlSpy).toHaveBeenCalledWith('https://example.com');
    });

    it('shows a ConfirmDialog instead of opening the URL when a known threat is detected', async () => {
      jest.mocked(checkUrlSafety).mockResolvedValue({ status: 'threatDetected', threats: ['malware'] });
      const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
      const renderer = await renderScreen();

      await act(async () => {
        await findPressableByText(renderer, i18n.t('item.goToUrl'))?.props.onPress();
      });

      expect(openUrlSpy).not.toHaveBeenCalled();
      expect(findVisibleConfirmDialog(renderer, i18n.t('item.urlSafetyThreatTitle'))).toBeTruthy();
    });

    it('cancelling the threat ConfirmDialog closes it without opening the URL', async () => {
      jest.mocked(checkUrlSafety).mockResolvedValue({ status: 'threatDetected', threats: ['malware'] });
      const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
      const renderer = await renderScreen();

      await act(async () => {
        await findPressableByText(renderer, i18n.t('item.goToUrl'))?.props.onPress();
      });
      const dialog = findVisibleConfirmDialog(renderer, i18n.t('item.urlSafetyThreatTitle'));

      await act(async () => {
        dialog.props.onCancel();
      });

      expect(openUrlSpy).not.toHaveBeenCalled();
      expect(findVisibleConfirmDialog(renderer, i18n.t('item.urlSafetyThreatTitle'))).toBeFalsy();
    });

    it('confirming the threat ConfirmDialog opens the original URL', async () => {
      jest.mocked(checkUrlSafety).mockResolvedValue({ status: 'threatDetected', threats: ['malware'] });
      const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
      const renderer = await renderScreen();

      await act(async () => {
        await findPressableByText(renderer, i18n.t('item.goToUrl'))?.props.onPress();
      });
      const dialog = findVisibleConfirmDialog(renderer, i18n.t('item.urlSafetyThreatTitle'));

      await act(async () => {
        dialog.props.onConfirm();
      });

      expect(openUrlSpy).toHaveBeenCalledWith('https://example.com');
    });
  });
});
