import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Switch } from 'react-native';
import i18n from '../../i18n';
import { CollectionDetailsScreen } from '../CollectionDetailsScreen';
import {
  deleteCollection,
  enableCollectionShare,
  getCollection,
  getCollectionShare,
  removeItemFromCollection,
  renameCollection,
  revokeCollectionShare,
  setCollectionColor,
  setCollectionIcon,
  type Collection,
  type CollectionItemEntry,
} from '../../collections/api/collectionsApi';
import { HeartIcon } from '../../icons/HeartIcon';
import { shareItem } from '../../items/shareItem';

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
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../../collections/api/collectionsApi', () => ({
  deleteCollection: jest.fn(),
  enableCollectionShare: jest.fn(),
  getCollection: jest.fn(),
  getCollectionItems: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  getCollectionShare: jest.fn(),
  removeItemFromCollection: jest.fn(),
  renameCollection: jest.fn(),
  revokeCollectionShare: jest.fn(),
  setCollectionColor: jest.fn(),
  setCollectionFavorite: jest.fn(),
  setCollectionIcon: jest.fn(),
}));

jest.mock('../../items/shareItem', () => ({
  shareItem: jest.fn(),
}));

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 1,
    name: 'Groceries',
    isFavorite: false,
    itemCount: 1,
    createdAtUtc: new Date().toISOString(),
    updatedAtUtc: new Date().toISOString(),
    icon: 'Folder',
    color: null,
    ...overrides,
  };
}

function makeItemEntry(overrides: Partial<CollectionItemEntry> = {}): CollectionItemEntry {
  return {
    itemId: 1,
    url: 'https://example.com',
    title: 'Example item',
    memo: null,
    addedAtUtc: new Date().toISOString(),
    sortOrder: 0,
    representativeImage: null,
    previewImageUrl: null,
    coverImage: null,
    ...overrides,
  };
}

const route = { key: 'CollectionDetails', name: 'CollectionDetails', params: { collectionId: 1 } } as never;
const navigation = { navigate: jest.fn(), goBack: jest.fn() } as never;

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <CollectionDetailsScreen navigation={navigation} route={route} />,
    );
  });
  return renderer;
}

/**
 * Renders a single row in isolation (mirrors DailyInboxScreen.test.tsx's getRowElement pattern) so
 * the swipe action props can be invoked directly without simulating a gesture. Goes through the
 * FlatList's own `renderItem` prop directly rather than its internal virtualization.
 */
function getRowElement(renderer: ReactTestRenderer.ReactTestRenderer, item: CollectionItemEntry) {
  const flatList = renderer.root.findByType(FlatList);
  const element = flatList.props.renderItem({ item, index: 0 });
  let rowRenderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    rowRenderer = ReactTestRenderer.create(element);
  });
  return rowRenderer;
}

/**
 * Renders the FlatList's ListHeaderComponent (name/star/edit/delete, share section) in
 * isolation - same rationale as getRowElement above: FlatList's own virtualization is not
 * something these tests should depend on. The element's onPress/onValueChange props are the exact
 * same closures the mounted `renderer` created, so invoking them here still updates the real
 * screen's state (and, in turn, its ConfirmDialogs, which are siblings of the FlatList and must
 * still be queried from the main `renderer`, not this isolated one).
 */
function getHeaderElement(renderer: ReactTestRenderer.ReactTestRenderer) {
  const flatList = renderer.root.findByType(FlatList);
  let headerRenderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    headerRenderer = ReactTestRenderer.create(flatList.props.ListHeaderComponent);
  });
  return headerRenderer;
}

describe('CollectionDetailsScreen', () => {
  beforeEach(() => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection());
    jest.mocked(getCollectionShare).mockResolvedValue(null);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('item row - swipe share/remove (reuses SwipeableItemRow)', () => {
    it('shares the item via the swipe share action', async () => {
      const item = makeItemEntry({ itemId: 5, title: 'Shareable' });
      jest.mocked(shareItem).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      const row = getRowElement(renderer, item);
      const shareAction = row.root.findAll(node => node.props.accessibilityLabel === '공유')[0];
      await act(async () => {
        shareAction.props.onPress();
      });

      expect(shareItem).toHaveBeenCalledWith(item.url, item.title);
    });

    it('asks for confirmation via the swipe delete action before unlinking, and only unlinks (never a real item delete) on confirm', async () => {
      const item = makeItemEntry({ itemId: 7 });
      jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      const row = getRowElement(renderer, item);
      const removeAction = row.root.findAll(node => node.props.accessibilityLabel === '삭제')[0];
      await act(async () => {
        removeAction.props.onPress();
      });
      expect(removeItemFromCollection).not.toHaveBeenCalled();

      await act(async () => {
        const confirmButton = renderer.root.findAll(
          node => node.props.accessibilityLabel === i18n.t('collections.unlinkAction'),
        )[0];
        confirmButton.props.onPress();
      });

      expect(removeItemFromCollection).toHaveBeenCalledWith(expect.anything(), 1, 7);
    });
  });

  describe('header - compact icon-only 수정/삭제, no giant footer button', () => {
    it('shows a compact 삭제 icon button next to 수정, and deletes only after confirming', async () => {
      jest.mocked(deleteCollection).mockResolvedValue(undefined);
      const renderer = await renderScreen();
      const header = getHeaderElement(renderer);

      const editButtons = header.root.findAll(
        node => node.props.accessibilityLabel === '수정' && typeof node.props.onPress === 'function',
      );
      expect(editButtons.length).toBeGreaterThan(0);
      const deleteButtons = header.root.findAll(
        node => node.props.accessibilityLabel === '삭제' && typeof node.props.onPress === 'function',
      );
      expect(deleteButtons.length).toBeGreaterThan(0);

      await act(async () => {
        deleteButtons[0].props.onPress();
      });
      expect(deleteCollection).not.toHaveBeenCalled();

      await act(async () => {
        // The header's own delete button opened the confirm dialog (isDeleteConfirmVisible is set
        // on the real screen, via the same closure the isolated `header` renderer shares - see
        // getHeaderElement). The real FlatList genuinely mounts ListHeaderComponent into the main
        // `renderer` tree, so there are now two elements with accessibilityLabel '삭제': the
        // header's own compact delete button and the ConfirmDialog's confirm button - the second
        // one is the actual confirm action.
        const confirmButtons = renderer.root.findAll(
          node => node.props.accessibilityLabel === '삭제' && typeof node.props.onPress === 'function',
        );
        expect(confirmButtons).toHaveLength(2);
        confirmButtons[1].props.onPress();
      });

      expect(deleteCollection).toHaveBeenCalledWith(expect.anything(), 1);
    });
  });

  describe('header - icon (create/edit)', () => {
    function openEditMode(renderer: ReactTestRenderer.ReactTestRenderer) {
      const header = getHeaderElement(renderer);
      const editButton = header.root.findAll(
        node => node.props.accessibilityLabel === '수정' && typeof node.props.onPress === 'function',
      )[0];
      act(() => {
        editButton.props.onPress();
      });
    }

    function findSaveButton(header: ReactTestRenderer.ReactTestRenderer) {
      return header.root.findAll(
        node =>
          typeof node.props.onPress === 'function' &&
          node.findAll(inner => inner.props.children === i18n.t('common.save')).length > 0,
      )[0];
    }

    /** The icon grid (see CategoryNameAndIconField) is hidden until its thumbnail button is
     * tapped - must operate on the SAME already-obtained header instance the icon option is then
     * queried from (a fresh getHeaderElement() call re-mounts CategoryNameAndIconField, resetting
     * its own local expand state back to collapsed). */
    function expandIconPicker(header: ReactTestRenderer.ReactTestRenderer) {
      act(() => {
        header.root.findByProps({ testID: 'category-icon-thumbnail-button' }).props.onPress();
      });
    }

    it('shows the collection\'s chosen icon in the header, next to the name', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ icon: 'Heart' }));
      const renderer = await renderScreen();
      const header = getHeaderElement(renderer);

      expect(header.root.findAllByType(HeartIcon)).toHaveLength(1);
    });

    it('seeds the icon picker from the collection\'s current icon when edit mode opens', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ icon: 'Heart' }));
      const renderer = await renderScreen();

      openEditMode(renderer);
      const header = getHeaderElement(renderer);
      expandIconPicker(header);
      const heartCell = header.root.findByProps({ testID: 'collection-icon-option-Heart' });
      expect(heartCell.props.accessibilityState.selected).toBe(true);
    });

    it('changing only the icon calls setCollectionIcon but not renameCollection', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ icon: 'Folder' }));
      jest.mocked(setCollectionIcon).mockResolvedValue(makeCollection({ icon: 'Plane' }));
      const renderer = await renderScreen();

      openEditMode(renderer);
      const header1 = getHeaderElement(renderer);
      expandIconPicker(header1);
      const planeCell = header1.root.findByProps({ testID: 'collection-icon-option-Plane' });
      act(() => {
        planeCell.props.onPress();
      });

      const header2 = getHeaderElement(renderer);
      const saveButton = findSaveButton(header2);
      await act(async () => {
        await saveButton.props.onPress();
      });

      expect(setCollectionIcon).toHaveBeenCalledWith(expect.anything(), 1, 'Plane');
      expect(renameCollection).not.toHaveBeenCalled();
    });

    it('changing only the name calls renameCollection but not setCollectionIcon', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ name: 'Old', icon: 'Folder' }));
      jest.mocked(renameCollection).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      openEditMode(renderer);
      const header1 = getHeaderElement(renderer);
      const nameInput = header1.root.findByProps({ value: 'Old' });
      act(() => {
        nameInput.props.onChangeText('New');
      });

      const header2 = getHeaderElement(renderer);
      const saveButton = findSaveButton(header2);
      await act(async () => {
        await saveButton.props.onPress();
      });

      expect(renameCollection).toHaveBeenCalledWith(expect.anything(), 1, 'New');
      expect(setCollectionIcon).not.toHaveBeenCalled();
    });

    it('changing both name and icon calls renameCollection then setCollectionIcon, never in parallel', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ name: 'Old', icon: 'Folder' }));
      const callOrder: string[] = [];
      jest.mocked(renameCollection).mockImplementation(async () => {
        callOrder.push('rename');
      });
      jest.mocked(setCollectionIcon).mockImplementation(async () => {
        callOrder.push('icon');
        return makeCollection({ name: 'New', icon: 'Plane' });
      });
      const renderer = await renderScreen();

      openEditMode(renderer);
      const header1 = getHeaderElement(renderer);
      const nameInput = header1.root.findByProps({ value: 'Old' });
      act(() => {
        nameInput.props.onChangeText('New');
      });

      const header2 = getHeaderElement(renderer);
      expandIconPicker(header2);
      const planeCell = header2.root.findByProps({ testID: 'collection-icon-option-Plane' });
      act(() => {
        planeCell.props.onPress();
      });

      const header3 = getHeaderElement(renderer);
      const saveButton = findSaveButton(header3);
      await act(async () => {
        await saveButton.props.onPress();
      });

      expect(callOrder).toEqual(['rename', 'icon']);
    });

    /** A Collection with no explicit color yet must seed the picker from its currently-visible
     * EFFECTIVE (id-deterministic fallback) color, as if it were already selected - never Blue by
     * default regardless of id (see resolveEffectiveCollectionColorKey). */
    it('seeds the color picker from the collection\'s effective (fallback) color when none is explicit', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ id: 3, color: null }));
      const renderer = await renderScreen();

      openEditMode(renderer);
      const header = getHeaderElement(renderer);
      expandIconPicker(header);
      // id 3's deterministic fallback resolves to 'Mint' - see collectionColors.ts's own mapping.
      const mintSwatch = header.root.findByProps({ testID: 'collection-color-option-Mint' });
      expect(mintSwatch.props.accessibilityState.selected).toBe(true);
    });

    it('seeds the color picker from the collection\'s explicit color when one is set', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ id: 3, color: 'Teal' }));
      const renderer = await renderScreen();

      openEditMode(renderer);
      const header = getHeaderElement(renderer);
      expandIconPicker(header);
      const tealSwatch = header.root.findByProps({ testID: 'collection-color-option-Teal' });
      expect(tealSwatch.props.accessibilityState.selected).toBe(true);
    });

    it('changing only the color calls setCollectionColor but not renameCollection/setCollectionIcon', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ id: 3, icon: 'Folder', color: 'Blue' }));
      jest.mocked(setCollectionColor).mockResolvedValue(makeCollection({ id: 3, color: 'Mint' }));
      const renderer = await renderScreen();

      openEditMode(renderer);
      const header1 = getHeaderElement(renderer);
      expandIconPicker(header1);
      const mintSwatch = header1.root.findByProps({ testID: 'collection-color-option-Mint' });
      act(() => {
        mintSwatch.props.onPress();
      });

      const header2 = getHeaderElement(renderer);
      const saveButton = findSaveButton(header2);
      await act(async () => {
        await saveButton.props.onPress();
      });

      expect(setCollectionColor).toHaveBeenCalledWith(expect.anything(), 1, 'Mint');
      expect(renameCollection).not.toHaveBeenCalled();
      expect(setCollectionIcon).not.toHaveBeenCalled();
    });
  });

  describe('header - no "URL N개" item-count line (rows already show their own sequence number)', () => {
    it('does not render the item-count text under the name', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ itemCount: 6 }));
      const renderer = await renderScreen();
      const header = getHeaderElement(renderer);

      expect(header.root.findAllByProps({ children: 'URL 6개' })).toHaveLength(0);
      expect(
        header.root.findAll(
          node => typeof node.props.children === 'string' && /^URL\s*\d+개$/.test(node.props.children),
        ),
      ).toHaveLength(0);
    });
  });

  describe('public sharing - single Switch, not two buttons', () => {
    it('renders no more 공유하기/공유 해제 button pair - a single Switch instead', async () => {
      const renderer = await renderScreen();
      const header = getHeaderElement(renderer);

      expect(header.root.findAllByType(Switch)).toHaveLength(1);
    });

    it('hides the description by default and reveals it inline only after the info icon is tapped', async () => {
      const renderer = await renderScreen();
      const header1 = getHeaderElement(renderer);

      expect(
        header1.root.findAll(node => node.props.children === i18n.t('collections.publicShareDescription')),
      ).toHaveLength(0);

      const infoButton = header1.root.findByProps({
        accessibilityLabel: i18n.t('collections.publicShareInfoA11y'),
      });
      act(() => {
        infoButton.props.onPress();
      });

      // isShareInfoExpanded lives on the real screen component (unlike CategoryNameAndIconField's
      // own local expand state) - re-fetching the header picks up its latest value.
      const header2 = getHeaderElement(renderer);
      expect(
        header2.root.findAll(node => node.props.children === i18n.t('collections.publicShareDescription')).length,
      ).toBeGreaterThan(0);
    });

    it('turning the switch ON calls enableCollectionShare without opening the OS share sheet', async () => {
      jest.mocked(enableCollectionShare).mockResolvedValue({
        publicId: 'p1',
        shareUrl: 'https://juple.example/c/p1',
        createdAtUtc: new Date().toISOString(),
      });
      const renderer = await renderScreen();
      const header = getHeaderElement(renderer);

      const toggle = header.root.findByType(Switch);
      expect(toggle.props.value).toBe(false);

      await act(async () => {
        toggle.props.onValueChange(true);
      });

      expect(enableCollectionShare).toHaveBeenCalledWith(expect.anything(), 1);
      expect(shareItem).not.toHaveBeenCalled();
    });

    it('turning the switch OFF asks for confirmation, then calls revokeCollectionShare', async () => {
      jest.mocked(getCollectionShare).mockResolvedValue({
        publicId: 'p1',
        shareUrl: 'https://juple.example/c/p1',
        createdAtUtc: new Date().toISOString(),
      });
      jest.mocked(revokeCollectionShare).mockResolvedValue(undefined);
      const renderer = await renderScreen();
      const header = getHeaderElement(renderer);

      const toggle = header.root.findByType(Switch);
      expect(toggle.props.value).toBe(true);

      await act(async () => {
        toggle.props.onValueChange(false);
      });
      expect(revokeCollectionShare).not.toHaveBeenCalled();

      await act(async () => {
        const confirmButton = renderer.root.findAll(
          node => node.props.accessibilityLabel === i18n.t('collections.unshare'),
        )[0];
        confirmButton.props.onPress();
      });

      expect(revokeCollectionShare).toHaveBeenCalledWith(expect.anything(), 1);
    });

    it('shows a compact 링크 공유 action only while sharing is ON, which opens the OS share sheet', async () => {
      jest.mocked(getCollectionShare).mockResolvedValue({
        publicId: 'p1',
        shareUrl: 'https://juple.example/c/p1',
        createdAtUtc: new Date().toISOString(),
      });
      jest.mocked(shareItem).mockResolvedValue(undefined);
      const renderer = await renderScreen();
      const header = getHeaderElement(renderer);

      const shareLinkButton = header.root.findAll(
        node =>
          node.props.accessibilityLabel === i18n.t('collections.shareAction') &&
          typeof node.props.onPress === 'function',
      )[0];
      expect(shareLinkButton).toBeTruthy();

      await act(async () => {
        shareLinkButton?.props.onPress();
      });

      expect(shareItem).toHaveBeenCalledWith('https://juple.example/c/p1', 'Groceries');
    });
  });

  describe('tap to open (regression)', () => {
    it('tapping a row navigates to that Item\'s details', async () => {
      const item = makeItemEntry({ itemId: 42 });
      const renderer = await renderScreen();

      const row = getRowElement(renderer, item);
      const openPressable = row.root.findAll(node => typeof node.props.onPress === 'function')[0];
      await act(async () => {
        openPressable.props.onPress();
      });

      expect((navigation as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith('ItemDetails', { itemId: 42 });
    });
  });
});
