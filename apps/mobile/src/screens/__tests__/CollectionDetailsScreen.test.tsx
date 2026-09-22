import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Switch } from 'react-native';
import i18n from '../../i18n';
import { CollectionDetailsScreen } from '../CollectionDetailsScreen';
import {
  deleteCollection,
  enableCollectionShare,
  getCollection,
  getCollectionItems,
  getCollectionShare,
  getCollections,
  addItemToCollection,
  transferCollectionItem,
  undoTransferCollectionItem,
  mergeCollection,
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
import { deleteItem, restoreItem } from '../../items/api/itemsApi';
import { ActionMenuDialog } from '../../components/ActionMenuDialog';
import { UndoToast } from '../../components/UndoToast';

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

// Unlink must never touch the general Item delete/restore API surface (see the unlink-undo
// regression tests below) - mocked here purely so those assertions have something to check.
jest.mock('../../items/api/itemsApi', () => ({
  ...jest.requireActual('../../items/api/itemsApi'),
  deleteItem: jest.fn(),
  restoreItem: jest.fn(),
}));

jest.mock('../../collections/api/collectionsApi', () => ({
  deleteCollection: jest.fn(),
  enableCollectionShare: jest.fn(),
  getCollection: jest.fn(),
  getCollectionItems: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  getCollectionShare: jest.fn(),
  getCollections: jest.fn(),
  addItemToCollection: jest.fn(),
  transferCollectionItem: jest.fn(),
  undoTransferCollectionItem: jest.fn(),
  mergeCollection: jest.fn(),
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
const navigation = { navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn() } as never;

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
    jest.mocked(getCollections).mockResolvedValue({ items: [makeCollection({ id: 2, name: 'Target' })], nextCursor: null });
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
      // Category unlink is never a general Item delete - see the "General Item delete" policy
      // (only Home/History offer that).
      expect(deleteItem).not.toHaveBeenCalled();
      expect(restoreItem).not.toHaveBeenCalled();
    });
  });

  describe('item row - swipe unlink undo', () => {
    // jest.clearAllMocks() (see the outer afterEach) clears call history but not a
    // .mockResolvedValue(...) override set by an individual test below - without resetting it
    // back here too, a later test's fresh renderScreen() would keep fetching this describe's own
    // non-empty item list instead of the default empty one, corrupting unrelated tests further
    // down the file (e.g. adding stray swipe-delete rows to header-only tests).
    afterEach(() => {
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [], nextCursor: null });
    });

    async function unlinkViaSwipe(renderer: ReactTestRenderer.ReactTestRenderer, item: CollectionItemEntry) {
      const row = getRowElement(renderer, item);
      const removeAction = row.root.findAll(node => node.props.accessibilityLabel === '삭제')[0];
      await act(async () => removeAction.props.onPress());
      await act(async () => {
        const confirmButton = renderer.root.findAll(
          node => node.props.accessibilityLabel === i18n.t('collections.unlinkAction'),
        )[0];
        confirmButton.props.onPress();
      });
    }

    it('removes the row, decreases the count, and shows the unlink undo toast (not the delete wording)', async () => {
      const item = makeItemEntry({ itemId: 9 });
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [item], nextCursor: null });
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ itemCount: 1 }));
      jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      await unlinkViaSwipe(renderer, item);

      expect(removeItemFromCollection).toHaveBeenCalledWith(expect.anything(), 1, 9);
      expect(deleteItem).not.toHaveBeenCalled();
      expect(renderer.root.findByType(FlatList).props.data).toHaveLength(0);
      expect(renderer.root.findByProps({ children: i18n.t('collections.detailItemCount', { count: 0 }) })).toBeTruthy();
      expect(renderer.root.findByProps({ children: i18n.t('toast.unlinkSuccess') })).toBeTruthy();
      expect(renderer.root.findAllByProps({ children: i18n.t('toast.deleteSuccess') })).toHaveLength(0);
    });

    it('restores the row and count via the existing membership-add API after unlink undo succeeds', async () => {
      const item = makeItemEntry({ itemId: 9 });
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [item], nextCursor: null });
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ itemCount: 1 }));
      jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
      jest.mocked(addItemToCollection).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      await unlinkViaSwipe(renderer, item);

      await act(async () => {
        renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress();
        await Promise.resolve();
      });

      // The same PUT .../items/{itemId} membership-add API Add-to-category already uses - not a
      // bespoke unlink-undo endpoint, and never the Item restore API (soft-delete is unrelated).
      expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), 1, 9);
      expect(restoreItem).not.toHaveBeenCalled();
      expect(renderer.root.findByType(FlatList).props.data).toHaveLength(1);
      expect(renderer.root.findByProps({ children: i18n.t('collections.detailItemCount', { count: 1 }) })).toBeTruthy();
      expect(renderer.root.findAllByProps({ accessibilityLabel: i18n.t('toast.undoAction') })).toHaveLength(0);
      expect(renderer.root.findAllByProps({ children: i18n.t('collections.addSuccess') })).toHaveLength(0);
    });

    it('keeps the unlinked state and shows the shared notice dialog when unlink undo fails', async () => {
      const item = makeItemEntry({ itemId: 9 });
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [item], nextCursor: null });
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ itemCount: 1 }));
      jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
      jest.mocked(addItemToCollection).mockRejectedValue(new Error('no'));
      const renderer = await renderScreen();

      await unlinkViaSwipe(renderer, item);

      await act(async () => {
        renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress();
        await Promise.resolve();
      });

      expect(renderer.root.findByType(FlatList).props.data).toHaveLength(0);
      expect(renderer.root.findByProps({ children: i18n.t('collections.detailItemCount', { count: 0 }) })).toBeTruthy();
      expect(renderer.root.findAllByProps({ accessibilityLabel: i18n.t('toast.undoAction') })).toHaveLength(0);
      expect(renderer.root.findByProps({ children: i18n.t('toast.undoUnlinkError') })).toBeTruthy();
    });

    it('does not send a second membership-add request while unlink undo is pending', async () => {
      const item = makeItemEntry({ itemId: 9 });
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [item], nextCursor: null });
      jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
      let resolveUndo!: () => void;
      jest.mocked(addItemToCollection).mockImplementation(() => new Promise<void>(resolve => { resolveUndo = resolve; }));
      const renderer = await renderScreen();

      await unlinkViaSwipe(renderer, item);

      const undo = renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress;
      await act(async () => { undo(); undo(); });
      expect(addItemToCollection).toHaveBeenCalledTimes(1);

      await act(async () => { resolveUndo(); await Promise.resolve(); });
    });

    it('clears a pending Move undo once a later unlink succeeds, and vice versa (latest-one-only)', async () => {
      const movedItem = makeItemEntry({ itemId: 9 });
      const unlinkedItem = makeItemEntry({ itemId: 10 });
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [movedItem, unlinkedItem], nextCursor: null });
      jest.mocked(transferCollectionItem).mockResolvedValue({ targetMembershipCreated: true });
      jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      // Move first - its own undo toast appears.
      const movedRow = getRowElement(renderer, movedItem);
      await act(async () => movedRow.root.findByProps({ accessibilityLabel: i18n.t('collections.itemManageAction') }).props.onPress());
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress());
      await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Target' }).props.onPress());
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveAction') }).props.onPress());
      expect(renderer.root.findByProps({ children: i18n.t('toast.moveSuccess') })).toBeTruthy();

      // Then unlink another row - only the unlink toast should remain.
      await unlinkViaSwipe(renderer, unlinkedItem);
      expect(renderer.root.findAllByProps({ children: i18n.t('toast.moveSuccess') })).toHaveLength(0);
      expect(renderer.root.findByProps({ children: i18n.t('toast.unlinkSuccess') })).toBeTruthy();
      // At most one UndoToast component instance on screen at a time - never both Move's and
      // Unlink's simultaneously (see the "latest-one-only" policy).
      expect(renderer.root.findAllByType(UndoToast)).toHaveLength(1);
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

  describe('category management actions', () => {
    async function openItemMenu(renderer: ReactTestRenderer.ReactTestRenderer, item = makeItemEntry({ itemId: 9 })) {
      const row = getRowElement(renderer, item);
      await act(async () => row.root.findByProps({ accessibilityLabel: i18n.t('collections.itemManageAction') }).props.onPress());
    }
    async function chooseTarget(renderer: ReactTestRenderer.ReactTestRenderer) {
      await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Target' }).props.onPress());
    }
    it('opens the More action menu without navigating the row', async () => {
      const item = makeItemEntry({ itemId: 9 });
      const renderer = await renderScreen();
      const row = getRowElement(renderer, item);
      const stopPropagation = jest.fn();
      await act(async () => row.root.findByProps({ accessibilityLabel: i18n.t('collections.itemManageAction') }).props.onPress({ stopPropagation }));
      expect(stopPropagation).toHaveBeenCalledTimes(1);
      expect((navigation as { navigate: jest.Mock }).navigate).not.toHaveBeenCalled();
      expect(renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.addToOther') })).toBeTruthy();
    });
    // Full item delete used to live in this same menu (see the removed "CollectionDetailsScreen
    // item delete undo" test block) - product policy now restricts general item delete to
    // Home/History only, so this menu goes back to offering only Add/Move.
    it('offers only Add/Move in the link More menu - no Delete option', async () => {
      const item = makeItemEntry({ itemId: 9 });
      const renderer = await renderScreen();
      const row = getRowElement(renderer, item);
      await act(async () => row.root.findByProps({ accessibilityLabel: i18n.t('collections.itemManageAction') }).props.onPress());

      const itemMenu = renderer.root.findAllByType(ActionMenuDialog).find(
        node => node.props.actions.some((action: { label: string }) => action.label === i18n.t('collections.addToOther')),
      );
      expect(itemMenu).toBeTruthy();
      const labels = itemMenu!.props.actions.map((action: { label: string }) => action.label);
      expect(labels).toEqual([i18n.t('collections.addToOther'), i18n.t('collections.moveToOther')]);
    });
    it('adds to another category and keeps the source row', async () => {
      jest.mocked(addItemToCollection).mockResolvedValue(undefined);
      const renderer = await renderScreen(); await openItemMenu(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.addToOther') }).props.onPress());
      await chooseTarget(renderer);
      expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), 2, 9);
      expect(renderer.root.findAll(node => node.props.children === i18n.t('collections.addSuccess')).length).toBeGreaterThan(0);
    });
    it('shows add failure without removing the source row', async () => {
      jest.mocked(addItemToCollection).mockRejectedValue(new Error('no'));
      const renderer = await renderScreen(); await openItemMenu(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.addToOther') }).props.onPress()); await chooseTarget(renderer);
      expect(renderer.root.findAll(node => node.props.children === i18n.t('collections.addError')).length).toBeGreaterThan(0);
    });
    it('moves only after confirmation', async () => {
      jest.mocked(transferCollectionItem).mockResolvedValue({ targetMembershipCreated: true });
      const renderer = await renderScreen(); await openItemMenu(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress()); await chooseTarget(renderer);
      expect(transferCollectionItem).not.toHaveBeenCalled();
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveAction') }).props.onPress());
      expect(transferCollectionItem).toHaveBeenCalledWith(expect.anything(), 1, 9, 2);
    });
    it('shows undo after a move and sends the server-created target flag back unchanged', async () => {
      jest.mocked(transferCollectionItem).mockResolvedValue({ targetMembershipCreated: true });
      jest.mocked(undoTransferCollectionItem).mockResolvedValue(undefined);
      const renderer = await renderScreen(); await openItemMenu(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress()); await chooseTarget(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveAction') }).props.onPress());
      expect(renderer.root.findByProps({ children: i18n.t('toast.moveSuccess') })).toBeTruthy();
      // Stack screen with no bottom tab bar and no fixed bottom action bar - the toast floats
      // directly above the safe-area inset (mocked to 0 here - see useSafeAreaInsets mock above),
      // not some tab-bar/action-bar height.
      expect(renderer.root.findByType(UndoToast).props.bottomOffset).toBe(0);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress());
      expect(undoTransferCollectionItem).toHaveBeenCalledWith(expect.anything(), 1, 9, 2, true);
    });
    it('passes false unchanged when the target already contained the item', async () => {
      jest.mocked(transferCollectionItem).mockResolvedValue({ targetMembershipCreated: false });
      jest.mocked(undoTransferCollectionItem).mockResolvedValue(undefined);
      const renderer = await renderScreen(); await openItemMenu(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress()); await chooseTarget(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveAction') }).props.onPress());
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress());
      expect(undoTransferCollectionItem).toHaveBeenCalledWith(expect.anything(), 1, 9, 2, false);
    });
    it('restores the row after undo succeeds and the refreshed source page includes it again', async () => {
      const item = makeItemEntry({ itemId: 9 });
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [item], nextCursor: null });
      jest.mocked(transferCollectionItem).mockResolvedValue({ targetMembershipCreated: true });
      jest.mocked(undoTransferCollectionItem).mockResolvedValue(undefined);
      const renderer = await renderScreen(); await openItemMenu(renderer, item);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress()); await chooseTarget(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveAction') }).props.onPress());
      expect(renderer.root.findByType(FlatList).props.data).toHaveLength(0);
      await act(async () => { renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress(); await Promise.resolve(); });
      expect(undoTransferCollectionItem).toHaveBeenCalledWith(expect.anything(), 1, 9, 2, true);
      expect(renderer.root.findByType(FlatList).props.data).toHaveLength(1);
      expect(renderer.root.findByType(FlatList).props.data[0].itemId).toBe(9);
      expect(renderer.root.findAllByProps({ accessibilityLabel: i18n.t('toast.undoAction') })).toHaveLength(0);
      expect(renderer.root.findAll(node => node.props.children === '되돌렸습니다.').length).toBe(0);
    });
    it('keeps the moved state and shows the existing error dialog when undo fails', async () => {
      const item = makeItemEntry({ itemId: 9 });
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [item], nextCursor: null });
      jest.mocked(transferCollectionItem).mockResolvedValue({ targetMembershipCreated: true });
      jest.mocked(undoTransferCollectionItem).mockRejectedValue(new Error('no'));
      const renderer = await renderScreen(); await openItemMenu(renderer, item);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress()); await chooseTarget(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveAction') }).props.onPress());
      await act(async () => { renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress(); await Promise.resolve(); });
      expect(renderer.root.findByType(FlatList).props.data).toHaveLength(0);
      expect(renderer.root.findAllByProps({ accessibilityLabel: i18n.t('toast.undoAction') })).toHaveLength(0);
      expect(renderer.root.findByProps({ children: i18n.t('toast.undoMoveError') })).toBeTruthy();
    });
    it('does not send a second undo request while the first is pending', async () => {
      let resolveUndo!: () => void;
      jest.mocked(transferCollectionItem).mockResolvedValue({ targetMembershipCreated: true });
      jest.mocked(undoTransferCollectionItem).mockImplementation(() => new Promise<void>(resolve => { resolveUndo = resolve; }));
      const renderer = await renderScreen(); await openItemMenu(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress()); await chooseTarget(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveAction') }).props.onPress());
      const undo = renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress;
      await act(async () => { undo(); undo(); });
      expect(undoTransferCollectionItem).toHaveBeenCalledTimes(1);
      await act(async () => { resolveUndo(); await Promise.resolve(); });
    });
    it('keeps the screen and shows an error when move fails', async () => {
      jest.mocked(transferCollectionItem).mockRejectedValue(new Error('no'));
      const renderer = await renderScreen(); await openItemMenu(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress()); await chooseTarget(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveAction') }).props.onPress());
      expect(renderer.root.findAll(node => node.props.children === i18n.t('collections.moveError')).length).toBeGreaterThan(0);
    });
    it('merges only after confirmation and replaces the detail route', async () => {
      jest.mocked(mergeCollection).mockResolvedValue(undefined);
      const renderer = await renderScreen(); const header = getHeaderElement(renderer);
      await act(async () => header.root.findByProps({ accessibilityLabel: i18n.t('collections.manageAction') }).props.onPress());
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.mergeWithOther') }).props.onPress()); await chooseTarget(renderer);
      expect(mergeCollection).not.toHaveBeenCalled();
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.mergeAction') }).props.onPress());
      expect(mergeCollection).toHaveBeenCalledWith(expect.anything(), 1, 2);
      expect((navigation as { replace: jest.Mock }).replace).toHaveBeenCalledWith('CollectionDetails', { collectionId: 2 });
    });
    it('keeps the source screen and shows an error when merge fails', async () => {
      jest.mocked(mergeCollection).mockRejectedValue(new Error('no'));
      const renderer = await renderScreen(); const header = getHeaderElement(renderer);
      await act(async () => header.root.findByProps({ accessibilityLabel: i18n.t('collections.manageAction') }).props.onPress());
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.mergeWithOther') }).props.onPress()); await chooseTarget(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.mergeAction') }).props.onPress());
      expect((navigation as { replace: jest.Mock }).replace).not.toHaveBeenCalled();
      expect(renderer.root.findAll(node => node.props.children === i18n.t('collections.mergeError')).length).toBeGreaterThan(0);
    });
    it('loads the next cursor page when the first page contains only the source, then shows a selectable target', async () => {
      jest.mocked(getCollections)
        .mockResolvedValueOnce({ items: [makeCollection({ id: 1, name: 'Groceries' })], nextCursor: 'page2' })
        .mockResolvedValueOnce({ items: [makeCollection({ id: 2, name: 'Later target' })], nextCursor: null });
      const renderer = await renderScreen(); await openItemMenu(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.addToOther') }).props.onPress());
      expect(getCollections).toHaveBeenNthCalledWith(1, expect.anything(), { limit: 50 });
      expect(getCollections).toHaveBeenNthCalledWith(2, expect.anything(), { limit: 50, cursor: 'page2' });
      expect(renderer.root.findAllByProps({ accessibilityLabel: 'Groceries' })).toHaveLength(0);
      expect(renderer.root.findByProps({ accessibilityLabel: 'Later target' })).toBeTruthy();
      expect(renderer.root.findAll(node => node.props.children === i18n.t('collections.addModalEmpty'))).toHaveLength(0);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Later target' }).props.onPress());
      expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), 2, 9);
    });
    it('shows the no-target notice only after the final cursor page has been checked', async () => {
      jest.mocked(getCollections)
        .mockResolvedValueOnce({ items: [makeCollection({ id: 1, name: 'Groceries' })], nextCursor: 'page2' })
        .mockResolvedValueOnce({ items: [], nextCursor: null });
      const renderer = await renderScreen(); await openItemMenu(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.addToOther') }).props.onPress());
      expect(getCollections).toHaveBeenNthCalledWith(2, expect.anything(), { limit: 50, cursor: 'page2' });
      expect(renderer.root.findAll(node => node.props.children === i18n.t('collections.addModalEmpty')).length).toBeGreaterThan(0);
    });
  });
});
