jest.mock('../../config/publicWebConfig', () => ({ publicWebConfig: { host: 'dev.juple.co.kr' } }));
jest.mock('../../api/apiConfig', () => ({ apiConfig: { baseUrl: 'https://api.test' } }));
import ReactTestRenderer, { act } from 'react-test-renderer';
import { BackHandler, FlatList } from 'react-native';
import i18n from '../../i18n';
import { DailyInboxScreen } from '../DailyInboxScreen';
import { AppToastProvider } from '../../components/AppToast';
import { SavedLinkGridCell } from '../../components/SavedLinkGridCard';
import { SwipeableItemRow } from '../../components/SwipeableItemRow';
import { SavedLinkImageRow } from '../../components/SavedLinkImageTile';
import { ViewModeToggle } from '../../components/ViewModeToggle';
import { CategoryPickerModal } from '../../collections/CategoryPickerModal';
import { SelectionBarProvider, useSelectionBarModel, type SelectionBarModel } from '../../selection/SelectionBarContext';
import { deleteItem, getItemHistory, getItemHistoryCount, restoreItem, type ItemHistoryEntry } from '../../items/api/itemsApi';
import { addItemToCollections, getCollections, type Collection } from '../../collections/api/collectionsApi';
import { ApiError } from '../../api/ApiError';

beforeAll(async () => {
  await i18n.changeLanguage('en');
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
jest.mock('../../items/shareItem', () => ({ shareItem: jest.fn(), shareLinks: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../urlMetadata/api/urlMetadataApi', () => ({ resolveUrlMetadata: jest.fn() }));
jest.mock('../../categories/collectionShortcutSync', () => ({ reconcileCollectionShortcuts: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../collections/api/collectionsApi', () => ({
  ...jest.requireActual('../../collections/api/collectionsApi'),
  getCollections: jest.fn(),
  getCollection: jest.fn(),
  addItemToCollection: jest.fn(),
  addItemToCollections: jest.fn(),
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

const mounted: Renderer[] = [];
let barModel: SelectionBarModel | null = null;
function BarProbe() {
  barModel = useSelectionBarModel();
  return null;
}

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(renderer => renderer.unmount());
  });
  jest.clearAllMocks();
  barModel = null;
});

async function renderHome(items: readonly ItemHistoryEntry[]) {
  jest.mocked(getItemHistory).mockResolvedValue({ items, nextCursor: null });
  jest.mocked(getItemHistoryCount).mockResolvedValue(items.length);
  jest.mocked(getCollections).mockResolvedValue({ items: [], nextCursor: null });
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <AppToastProvider><SelectionBarProvider><DailyInboxScreen /><BarProbe /></SelectionBarProvider></AppToastProvider>,
    );
  });
  mounted.push(renderer);
  return renderer;
}

const rows = (renderer: Renderer) => renderer.root.findAllByType(SwipeableItemRow);
const topBar = (renderer: Renderer) => renderer.root.findAllByProps({ testID: 'selection-top-bar' });
const barKeys = () => (barModel?.actions ?? []).map(action => action.key);
const barAction = (key: string) => barModel!.actions.find(action => action.key === key)!;
const moreRows = () => (barAction('more').menu ?? []).map(row => row.key);

describe('Home: long-press starts multi-selection (no centered menu)', () => {
  it('long-press selects that link, shows the selection header and swaps the tab bar for 컬렉션 변경 / 삭제 / 더보기', async () => {
    const renderer = await renderHome([item({ id: 1 }), item({ id: 2, title: 'Two' })]);
    expect(topBar(renderer)).toHaveLength(0);
    expect(barModel).toBeNull();

    await act(async () => rows(renderer)[0].props.onLongPress());

    expect(topBar(renderer).length).toBeGreaterThan(0);
    expect(renderer.root.findByProps({ testID: 'selection-count' }).props.children).toBe('1 selected');
    expect(rows(renderer)[0].props.selection.selected).toBe(true);
    expect(rows(renderer)[1].props.selection.selected).toBe(false);
    expect(barKeys()).toEqual(['changeCollection', 'delete', 'more']);
  });

  it('while selecting, a short tap only chooses / un-chooses - it never opens the link', async () => {
    const renderer = await renderHome([item({ id: 1 }), item({ id: 2, title: 'Two' })]);
    await act(async () => rows(renderer)[0].props.onLongPress());

    await act(async () => rows(renderer)[1].props.selection.onToggle());
    expect(renderer.root.findByProps({ testID: 'selection-count' }).props.children).toBe('2 selected');
    expect(mockNavigate).not.toHaveBeenCalled();

    await act(async () => rows(renderer)[1].props.selection.onToggle());
    expect(renderer.root.findByProps({ testID: 'selection-count' }).props.children).toBe('1 selected');
  });

  it('전체 선택 chooses every link, 전체 해제 clears them and ends selection at once, and the close button also leaves selection', async () => {
    const renderer = await renderHome([item({ id: 1 }), item({ id: 2, title: 'Two' }), item({ id: 3, title: 'Three' })]);
    await act(async () => rows(renderer)[0].props.onLongPress());

    await act(async () => renderer.root.findByProps({ testID: 'selection-toggle-all' }).props.onPress());
    expect(renderer.root.findByProps({ testID: 'selection-count' }).props.children).toBe('3 selected');
    expect(renderer.root.findByProps({ testID: 'selection-toggle-all' }).props.accessibilityLabel).toBe('Deselect all');

    await act(async () => renderer.root.findByProps({ testID: 'selection-toggle-all' }).props.onPress());
    expect(topBar(renderer)).toHaveLength(0);
    expect(barModel).toBeNull();

    await act(async () => rows(renderer)[0].props.onLongPress());
    await act(async () => renderer.root.findByProps({ testID: 'selection-exit' }).props.onPress());
    expect(topBar(renderer)).toHaveLength(0);
    expect(barModel).toBeNull();
  });

  it('un-choosing the last chosen link ends selection (header and bar gone, normal cards back)', async () => {
    const renderer = await renderHome([item({ id: 1 }), item({ id: 2, title: 'Two' })]);
    await act(async () => rows(renderer)[0].props.onLongPress());
    expect(topBar(renderer).length).toBeGreaterThan(0);
    await act(async () => rows(renderer)[0].props.selection.onToggle());
    expect(topBar(renderer)).toHaveLength(0);
    expect(barModel).toBeNull();
    expect(rows(renderer)[0].props.selection).toBeUndefined();
  });

  it('deleting every chosen link leaves selection mode', async () => {
    jest.mocked(deleteItem).mockResolvedValue(undefined);
    const renderer = await renderHome([item({ id: 1 })]);
    await act(async () => rows(renderer)[0].props.onLongPress());
    await act(async () => barAction('delete').onPress!());
    const confirm = renderer.root.findAll(node => typeof node.props.onConfirm === 'function' && node.props.confirmLabel === 'Delete' && node.props.visible === true)[0];
    await act(async () => confirm.props.onConfirm());
    expect(topBar(renderer)).toHaveLength(0);
    expect(barModel).toBeNull();
  });

  it("Android's back button leaves selection first", async () => {
    let backPress: (() => boolean) | undefined;
    const subscribe = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_name, handler) => {
      backPress = handler as () => boolean;
      return { remove: jest.fn() };
    });
    const renderer = await renderHome([item({ id: 1 })]);
    await act(async () => rows(renderer)[0].props.onLongPress());
    expect(backPress).toBeDefined();

    let handled = false;
    await act(async () => { handled = backPress!(); });
    expect(handled).toBe(true);
    expect(topBar(renderer)).toHaveLength(0);
    subscribe.mockRestore();
  });

  it('a card redacted by a Collection lock cannot be selected', async () => {
    const renderer = await renderHome([item({ id: 5, isCollectionLocked: true, url: '', title: null })]);
    expect(rows(renderer)[0].props.onLongPress).toBeUndefined();
  });

  it('Grid and Image views select the same way', async () => {
    const renderer = await renderHome([item({ id: 1 }), item({ id: 2, title: 'Two' })]);
    await act(async () => renderer.root.findByType(ViewModeToggle).props.onChange('grid'));
    const cells = renderer.root.findAllByType(SavedLinkGridCell);
    await act(async () => cells[1].props.onLongPress());
    expect(renderer.root.findAllByType(SavedLinkGridCell)[1].props.selection.selected).toBe(true);
    expect(renderer.root.findAllByType(SavedLinkGridCell)[0].props.selection.selected).toBe(false);

    await act(async () => renderer.root.findByProps({ testID: 'selection-exit' }).props.onPress());
    await act(async () => renderer.root.findByType(ViewModeToggle).props.onChange('image'));
    const list = renderer.root.findByType(FlatList);
    let part!: Renderer;
    act(() => { part = ReactTestRenderer.create(list.props.renderItem({ item: list.props.data[0], index: 0 })); });
    mounted.push(part);
    const imageRow = part.root.findByType(SavedLinkImageRow);
    await act(async () => imageRow.props.onLongPress(list.props.data[0].items[0]));
    expect(renderer.root.findAllByProps({ testID: 'selection-top-bar' }).length).toBeGreaterThan(0);
  });
});

describe('Home: 삭제 (the links themselves, with a confirmation that names the count)', () => {
  async function selectAll(renderer: Renderer) {
    await act(async () => rows(renderer)[0].props.onLongPress());
    await act(async () => renderer.root.findByProps({ testID: 'selection-toggle-all' }).props.onPress());
  }
  const deleteDialog = (renderer: Renderer) =>
    renderer.root.findAll(node => typeof node.props.onConfirm === 'function' && node.props.confirmLabel === 'Delete' && node.props.visible === true);

  it('cancelling the confirmation deletes nothing and keeps the selection', async () => {
    const renderer = await renderHome([item({ id: 1 }), item({ id: 2, title: 'Two' })]);
    await selectAll(renderer);
    await act(async () => barAction('delete').onPress!());

    expect(deleteDialog(renderer)[0].props.title).toBe('Delete 2 links?');
    await act(async () => deleteDialog(renderer)[0].props.onCancel());

    expect(deleteItem).not.toHaveBeenCalled();
    expect(deleteDialog(renderer)).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: 'selection-count' }).props.children).toBe('2 selected');
  });

  it('confirming deletes each selected link with its own request, then leaves selection and offers an undo', async () => {
    jest.mocked(deleteItem).mockResolvedValue(undefined);
    const renderer = await renderHome([item({ id: 1 }), item({ id: 2, title: 'Two' })]);
    await selectAll(renderer);
    await act(async () => barAction('delete').onPress!());
    await act(async () => deleteDialog(renderer)[0].props.onConfirm());

    expect(jest.mocked(deleteItem).mock.calls.map(call => call[1]).sort()).toEqual([1, 2]);
    expect(topBar(renderer)).toHaveLength(0);
    expect(rows(renderer)).toHaveLength(0);
    expect(restoreItem).not.toHaveBeenCalled();
  });

  it('a partial failure is reported as one and the failed link stays selected for another try', async () => {
    jest.mocked(deleteItem).mockImplementation(async (_request, id) => {
      if (id === 2) {
        throw new Error('server');
      }
    });
    const renderer = await renderHome([item({ id: 1 }), item({ id: 2, title: 'Two' })]);
    await selectAll(renderer);
    await act(async () => barAction('delete').onPress!());
    await act(async () => deleteDialog(renderer)[0].props.onConfirm());

    expect(topBar(renderer).length).toBeGreaterThan(0);
    expect(renderer.root.findByProps({ testID: 'selection-count' }).props.children).toBe('1 selected');
    const notice = renderer.root.findAll(node => typeof node.props.message === 'string' && String(node.props.message).includes('stay selected'));
    expect(notice.length).toBeGreaterThan(0);
    expect(rows(renderer)).toHaveLength(1);
  });
});

describe('Home: 컬렉션 변경 and 더보기', () => {
  it('one link: the existing Item Details-style editor opens', async () => {
    jest.mocked(getCollections).mockResolvedValue({ items: [], nextCursor: null });
    const renderer = await renderHome([item({ id: 1 })]);
    await act(async () => rows(renderer)[0].props.onLongPress());
    await act(async () => { await barAction('changeCollection').onPress!(); });

    const picker = renderer.root.findAllByType(CategoryPickerModal).find(node => node.props.noneTile !== undefined);
    expect(picker?.props.title).toBe('Change collection');
  });

  it('더보기 for ONE link: open, copy, edit and share - single-link actions', async () => {
    const renderer = await renderHome([item({ id: 1 })]);
    await act(async () => rows(renderer)[0].props.onLongPress());
    expect(moreRows()).toEqual(['open', 'copy', 'edit', 'share']);
  });

  it('더보기 for SEVERAL links: only what makes sense for many (copy and share as one text)', async () => {
    const renderer = await renderHome([item({ id: 1 }), item({ id: 2, title: 'Two' })]);
    await act(async () => rows(renderer)[0].props.onLongPress());
    await act(async () => renderer.root.findByProps({ testID: 'selection-toggle-all' }).props.onPress());
    expect(moreRows()).toEqual(['copy', 'share']);
  });

  it('수정 in 더보기 opens the same Item Details as a tap', async () => {
    const renderer = await renderHome([item({ id: 1 })]);
    await act(async () => rows(renderer)[0].props.onLongPress());
    await act(async () => barAction('more').menu!.find(row => row.key === 'edit')!.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('ItemDetails', expect.objectContaining({ itemId: 1 }));
  });
});

describe('Home: 컬렉션 변경 for several links adds them to the chosen collections', () => {
  const destination = (id: number): Collection => ({
    id,
    name: `Dest ${id}`,
    isFavorite: false,
    itemCount: 0,
    createdAtUtc: '2026-01-01T00:00:00Z',
    updatedAtUtc: '2026-01-01T00:00:00Z',
    icon: 'Folder',
    color: null,
    accessRole: 'owner',
  });
  const byTestId = (renderer: Renderer, testID: string) =>
    renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];

  async function openPickerForAll(renderer: Renderer) {
    await act(async () => rows(renderer)[0].props.onLongPress());
    await act(async () => renderer.root.findByProps({ testID: 'selection-toggle-all' }).props.onPress());
    await act(async () => { barAction('changeCollection').onPress!(); });
    await act(async () => { await new Promise<void>(resolve => setImmediate(() => resolve())); });
  }

  it('opens the destination picker for all selected links; existing memberships are never removed', async () => {
    jest.mocked(getCollections).mockResolvedValue({ items: [destination(10)], nextCursor: null });
    jest.mocked(addItemToCollections).mockResolvedValue({ addedCount: 1, skippedCount: 0 });
    const renderer = await renderHome([item({ id: 1 }), item({ id: 2, title: 'Two' })]);
    jest.mocked(getCollections).mockResolvedValue({ items: [destination(10)], nextCursor: null });
    await openPickerForAll(renderer);

    const picker = renderer.root.findAllByType(CategoryPickerModal).find(node => node.props.visible === true)!;
    expect(picker.props.title).toBe('Add 2 links to collections');
    await act(async () => byTestId(renderer, 'category-picker-option-10').props.onPress());
    await act(async () => byTestId(renderer, 'category-picker-submit').props.onPress());

    expect(jest.mocked(addItemToCollections).mock.calls.map(call => [call[1], call[2]])).toEqual([[1, [10]], [2, [10]]]);
    expect(topBar(renderer)).toHaveLength(0);
  });

  it('a partial failure keeps only the failed link selected and is reported as partial', async () => {
    jest.mocked(getCollections).mockResolvedValue({ items: [destination(10)], nextCursor: null });
    jest.mocked(addItemToCollections).mockImplementation(async (_request, itemId) => {
      if (itemId === 2) {
        throw new ApiError('forbidden', 403);
      }
      return { addedCount: 1, skippedCount: 0 };
    });
    const renderer = await renderHome([item({ id: 1 }), item({ id: 2, title: 'Two' })]);
    jest.mocked(getCollections).mockResolvedValue({ items: [destination(10)], nextCursor: null });
    await openPickerForAll(renderer);
    await act(async () => byTestId(renderer, 'category-picker-option-10').props.onPress());
    await act(async () => byTestId(renderer, 'category-picker-submit').props.onPress());

    expect(renderer.root.findByProps({ testID: 'selection-count' }).props.children).toBe('1 selected');
    expect(renderer.root.findAll(node => typeof node.props.message === 'string' && String(node.props.message).includes('Added 1 of 2 links')).length).toBeGreaterThan(0);
  });

  it('every request failing keeps the picker open for another try', async () => {
    jest.mocked(getCollections).mockResolvedValue({ items: [destination(10)], nextCursor: null });
    jest.mocked(addItemToCollections).mockRejectedValue(new ApiError('forbidden', 403));
    const renderer = await renderHome([item({ id: 1 }), item({ id: 2, title: 'Two' })]);
    jest.mocked(getCollections).mockResolvedValue({ items: [destination(10)], nextCursor: null });
    await openPickerForAll(renderer);
    await act(async () => byTestId(renderer, 'category-picker-option-10').props.onPress());
    await act(async () => byTestId(renderer, 'category-picker-submit').props.onPress());
    expect(byTestId(renderer, 'category-picker-submit')).toBeDefined();
    expect(renderer.root.findByProps({ testID: 'selection-count' }).props.children).toBe('2 selected');
  });
});
