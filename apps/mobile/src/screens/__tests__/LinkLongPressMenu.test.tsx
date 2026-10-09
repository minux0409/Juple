jest.mock('../../config/publicWebConfig', () => ({ publicWebConfig: { host: 'dev.juple.co.kr' } }));
jest.mock('../../api/apiConfig', () => ({ apiConfig: { baseUrl: 'https://api.test' } }));
import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Linking } from 'react-native';
import i18n from '../../i18n';
import { DailyInboxScreen } from '../DailyInboxScreen';
import { ActionMenuDialog } from '../../components/ActionMenuDialog';
import { AppToastProvider } from '../../components/AppToast';
import { SavedLinkGridCell } from '../../components/SavedLinkGridCard';
import { SwipeableItemRow } from '../../components/SwipeableItemRow';
import { ViewModeToggle } from '../../components/ViewModeToggle';
import { CategoryPickerModal } from '../../collections/CategoryPickerModal';
import { CollectionChoiceGrid } from '../../collections/CollectionChoiceGrid';
import {
  addItemToCollection,
  getCollection,
  getCollections,
  removeItemFromCollection,
  type Collection,
} from '../../collections/api/collectionsApi';
import { getItemHistory, getItemHistoryCount, updateItemDetails, type ItemHistoryEntry } from '../../items/api/itemsApi';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
}));
jest.mock('@react-navigation/bottom-tabs', () => ({ useBottomTabBarHeight: () => 80 }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../inbox/api/inboxApi', () => ({ saveInboxEntry: jest.fn() }));
jest.mock('../../items/api/itemsApi', () => ({
  getItemHistory: jest.fn(),
  getItemHistoryCount: jest.fn(),
  deleteItem: jest.fn(),
  restoreItem: jest.fn(),
  updateItemDetails: jest.fn(),
  setItemPreviewImage: jest.fn(),
}));
jest.mock('../../items/shareItem', () => ({ shareItem: jest.fn() }));
jest.mock('../../urlMetadata/api/urlMetadataApi', () => ({ resolveUrlMetadata: jest.fn() }));
jest.mock('../../categories/collectionShortcutSync', () => ({ reconcileCollectionShortcuts: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../collections/api/collectionsApi', () => ({
  ...jest.requireActual('../../collections/api/collectionsApi'),
  getCollections: jest.fn(),
  getCollection: jest.fn(),
  addItemToCollection: jest.fn(),
  removeItemFromCollection: jest.fn(),
}));

type Renderer = ReactTestRenderer.ReactTestRenderer;

const item = (overrides: Partial<ItemHistoryEntry> = {}): ItemHistoryEntry => ({
  id: 1,
  url: 'https://example.com/a?x=1',
  title: 'Example',
  memo: null,
  savedAtUtc: new Date().toISOString(),
  representativeImage: null,
  previewImageUrl: null,
  coverImage: null,
  ...overrides,
});
const collection = (id: number, name: string): Collection => ({
  id,
  name,
  isFavorite: false,
  itemCount: 0,
  createdAtUtc: '2026-01-01T00:00:00Z',
  updatedAtUtc: '2026-01-01T00:00:00Z',
  icon: 'Folder',
  color: null,
});
const colA = collection(10, 'A');
const colB = collection(11, 'B');

const mounted: Renderer[] = [];
afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(renderer => renderer.unmount());
  });
  jest.clearAllMocks();
});

async function renderHome(items: readonly ItemHistoryEntry[]) {
  jest.mocked(getItemHistory).mockResolvedValue({ items, nextCursor: null });
  jest.mocked(getItemHistoryCount).mockResolvedValue(items.length);
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<AppToastProvider><DailyInboxScreen /></AppToastProvider>);
  });
  mounted.push(renderer);
  return renderer;
}

async function switchToGrid(renderer: Renderer) {
  const toggle = renderer.root.findAll(node => node.props.accessibilityLabel === 'Grid view' && typeof node.props.onPress === 'function')[0];
  await act(async () => toggle.props.onPress());
}

const menu = (renderer: Renderer) => renderer.root.findAllByType(ActionMenuDialog)[0];
/** Presses a menu row. On iOS (the jest platform) a row that opens another dialog waits for the menu's onDismiss, which the mock Modal never fires - so it is fired here, as the real Modal does. */
const pressMenuAction = async (renderer: Renderer, label: string) => {
  const dialog = menu(renderer);
  const action = dialog.props.actions.find((candidate: { label: string }) => candidate.label === label);
  await act(async () => action.onPress());
  await act(async () => dialog.props.onDismiss?.());
};

describe('link card long-press menu (Home)', () => {
  it('List: long-press opens 링크 열기 / 수정 / 컬렉션 변경 / 삭제 with 삭제 last and destructive, each with an icon', async () => {
    const renderer = await renderHome([item()]);
    expect(renderer.root.findAllByType(ActionMenuDialog)).toHaveLength(0);

    const row = renderer.root.findAllByType(SwipeableItemRow)[0];
    await act(async () => row.props.onLongPress());

    const actions = menu(renderer).props.actions as { label: string; destructive?: boolean; icon?: unknown }[];
    expect(actions.map(action => action.label)).toEqual(['링크 열기', '수정', '컬렉션 변경', '삭제']);
    expect(actions.map(action => action.destructive === true)).toEqual([false, false, false, true]);
    expect(actions.every(action => action.icon !== undefined)).toBe(true);
    expect(menu(renderer).props.visible).toBe(true);
  });

  it('Grid: the tile has the same long-press and opens the same menu', async () => {
    const renderer = await renderHome([item({ id: 1 }), item({ id: 2, title: 'Two' })]);
    await switchToGrid(renderer);

    const cells = renderer.root.findAllByType(SavedLinkGridCell);
    expect(cells).toHaveLength(2);
    expect(cells.every(cell => typeof cell.props.onLongPress === 'function')).toBe(true);
    await act(async () => cells[1].props.onLongPress());
    expect((menu(renderer).props.actions as { label: string }[]).map(action => action.label)).toEqual(['링크 열기', '수정', '컬렉션 변경', '삭제']);
  });

  it('a tap still just opens the link, and the long-press is a screen-reader action too', async () => {
    const renderer = await renderHome([item()]);
    const row = renderer.root.findAllByType(SwipeableItemRow)[0];

    await act(async () => row.props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('ItemDetails', expect.objectContaining({ itemId: 1 }));
    expect(renderer.root.findAllByType(ActionMenuDialog)).toHaveLength(0);

    const layer = renderer.root.findAll(node => Array.isArray(node.props.accessibilityActions))[0];
    expect(layer.props.accessibilityActions.map((action: { name: string }) => action.name)).toContain('options');
  });

  it('a card redacted by a Collection lock has no menu', async () => {
    const renderer = await renderHome([item({ id: 5, isCollectionLocked: true, url: '', title: null })]);
    const row = renderer.root.findAllByType(SwipeableItemRow)[0];
    expect(row.props.onLongPress).toBeUndefined();
  });

  it('링크 열기 opens the link in the browser, query string intact', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const renderer = await renderHome([item()]);
    await act(async () => renderer.root.findAllByType(SwipeableItemRow)[0].props.onLongPress());

    await pressMenuAction(renderer, '링크 열기');

    expect(openURL).toHaveBeenCalledWith('https://example.com/a?x=1');
    expect(menu(renderer)?.props.visible ?? false).toBe(false);
    openURL.mockRestore();
  });

  it('수정 opens the same Item Details as a tap', async () => {
    const renderer = await renderHome([item()]);
    await act(async () => renderer.root.findAllByType(SwipeableItemRow)[0].props.onLongPress());

    await pressMenuAction(renderer, '수정');

    expect(mockNavigate).toHaveBeenCalledWith('ItemDetails', expect.objectContaining({ itemId: 1 }));
  });

  it('삭제 goes through the screen\'s own delete confirmation (nothing is deleted by the menu itself)', async () => {
    const renderer = await renderHome([item()]);
    await act(async () => renderer.root.findAllByType(SwipeableItemRow)[0].props.onLongPress());

    await pressMenuAction(renderer, '삭제');

    const confirm = renderer.root.findAll(node => typeof node.props.onConfirm === 'function' && node.props.visible === true && node.props.title === i18n.t('inbox.deleteConfirmTitle'));
    expect(confirm.length).toBeGreaterThan(0);
  });
});

describe('image-only view (Home): the same link menu', () => {
  /** The tiles of every line the list holds, each line rendered the way the FlatList renders it (the list is virtualized). */
  function tilesOf(renderer: Renderer) {
    const list = renderer.root.findByType(FlatList);
    const parts = (list.props.data as { lineKey: string; items: ItemHistoryEntry[] }[]).map(line => {
      let part!: Renderer;
      act(() => { part = ReactTestRenderer.create(list.props.renderItem({ item: line, index: 0 })); });
      mounted.push(part);
      return part;
    });
    // One entry per tile: its Pressable (the outermost element carrying the tile's testID), whose props are the tile's behavior.
    return parts.flatMap(part => part.root.findAll(node =>
      String(node.props.testID).startsWith('saved-link-image-tile')
      && typeof node.props.onPress === 'function'
      && node.parent?.props.testID !== node.props.testID));
  }

  async function renderImageView(items: readonly ItemHistoryEntry[]) {
    const renderer = await renderHome(items);
    await act(async () => renderer.root.findByType(ViewModeToggle).props.onChange('image'));
    return renderer;
  }

  it('long-pressing a tile opens the very same menu (Open link / Edit / Change Collection / Delete last) from the same provider', async () => {
    const renderer = await renderImageView([item({ id: 1 }), item({ id: 2, title: 'Two' })]);

    const tiles = tilesOf(renderer);
    expect(tiles).toHaveLength(2);
    expect(tiles.every(tile => typeof tile.props.onLongPress === 'function')).toBe(true);
    await act(async () => tiles[1].props.onLongPress());

    const actions = menu(renderer).props.actions as { label: string; destructive?: boolean }[];
    expect(actions.map(action => action.label)).toEqual(['링크 열기', '수정', '컬렉션 변경', '삭제']);
    expect(actions.at(-1)!.destructive).toBe(true);
  });

  it('the menu acts on the tile that was pressed (수정 opens that link)', async () => {
    const renderer = await renderImageView([item({ id: 1 }), item({ id: 2, title: 'Two' })]);
    const tiles = tilesOf(renderer);
    await act(async () => tiles[1].props.onLongPress());

    await pressMenuAction(renderer, '수정');

    expect(mockNavigate).toHaveBeenCalledWith('ItemDetails', expect.objectContaining({ itemId: 2 }));
  });

  it('a tap is unchanged, the tile also offers the screen-reader action, and a locked tile has no menu', async () => {
    const renderer = await renderImageView([item({ id: 1 }), item({ id: 3, isCollectionLocked: true, url: '', title: null })]);
    const [open, locked] = tilesOf(renderer);

    expect(open.props.accessibilityActions).toEqual([{ name: 'options', label: i18n.t('collections.linkActionsA11y') }]);
    await act(async () => open.props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('ItemDetails', expect.objectContaining({ itemId: 1 }));
    expect(renderer.root.findAllByType(ActionMenuDialog)).toHaveLength(0);

    expect(locked.props.onLongPress).toBeUndefined();
    expect(locked.props.accessibilityActions).toBeUndefined();
  });
});

describe('link card long-press → 컬렉션 변경 (the Item Details picker)', () => {
  const setUpCollections = (memberOf: readonly Collection[]) => {
    jest.mocked(getCollections).mockImplementation(async (_request, options = {}) => {
      if (options.itemId !== undefined) {
        return { items: [...memberOf], nextCursor: null };
      }
      return { items: options.scope === 'shared' ? [] : [colA, colB], nextCursor: null };
    });
    jest.mocked(getCollection).mockImplementation(async (_request, id) => (id === colA.id ? colA : colB));
    jest.mocked(addItemToCollection).mockResolvedValue('added');
    jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
  };

  async function openPicker(renderer: Renderer) {
    await act(async () => renderer.root.findAllByType(SwipeableItemRow)[0].props.onLongPress());
    await pressMenuAction(renderer, '컬렉션 변경');
  }

  it('opens the shared CategoryPickerModal, preselected with the link\'s Collections, offering 컬렉션 없음', async () => {
    setUpCollections([colA]);
    const renderer = await renderHome([item()]);

    await openPicker(renderer);

    const picker = renderer.root.findByType(CategoryPickerModal);
    expect(picker.props.visible).toBe(true);
    expect(picker.props.title).toBe('컬렉션 변경');
    expect([...picker.props.selectedIds]).toEqual([colA.id]);
    expect(picker.props.noneTile.label).toBe('컬렉션 없음');
    expect(picker.props.noneTile.isSelected).toBe(false);
    expect(renderer.root.findByType(CollectionChoiceGrid).props.noneTile.label).toBe('컬렉션 없음');
    expect(addItemToCollection).not.toHaveBeenCalled();
    expect(removeItemFromCollection).not.toHaveBeenCalled();
  });

  it('컬렉션 없음 then 저장 takes the link out of its Collections - and touches nothing else of the link', async () => {
    setUpCollections([colA]);
    const renderer = await renderHome([item()]);
    await openPicker(renderer);

    await act(async () => renderer.root.findByType(CategoryPickerModal).props.noneTile.onPress());
    expect([...renderer.root.findByType(CategoryPickerModal).props.selectedIds]).toEqual([]);
    expect(renderer.root.findByType(CategoryPickerModal).props.noneTile.isSelected).toBe(true);

    await act(async () => renderer.root.findByType(CategoryPickerModal).props.submit.onSubmit());

    expect(removeItemFromCollection).toHaveBeenCalledWith(expect.anything(), colA.id, 1, expect.anything());
    expect(addItemToCollection).not.toHaveBeenCalled();
    expect(updateItemDetails).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType(CategoryPickerModal)).toHaveLength(0);
  });

  it('choosing another Collection adds it through the same call Item Details saves with', async () => {
    setUpCollections([colA]);
    const renderer = await renderHome([item()]);
    await openPicker(renderer);

    await act(async () => renderer.root.findByType(CategoryPickerModal).props.onToggle(colB));
    expect([...renderer.root.findByType(CategoryPickerModal).props.selectedIds].sort()).toEqual([colA.id, colB.id]);
    await act(async () => renderer.root.findByType(CategoryPickerModal).props.submit.onSubmit());

    expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), colB.id, 1, expect.anything());
    expect(removeItemFromCollection).not.toHaveBeenCalled();
  });

  it('저장 is off until something changed', async () => {
    setUpCollections([colA]);
    const renderer = await renderHome([item()]);
    await openPicker(renderer);

    expect(renderer.root.findByType(CategoryPickerModal).props.submit.enabled).toBe(false);
  });
});
