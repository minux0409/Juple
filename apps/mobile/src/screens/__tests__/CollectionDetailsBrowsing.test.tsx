import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Image, StyleSheet, Text } from 'react-native';
import i18n from '../../i18n';
import { CollectionDetailsScreen } from '../CollectionDetailsScreen';
import { LinkSortChips } from '../../components/LinkSortChips';
import { ViewModeToggle } from '../../components/ViewModeToggle';
import { SearchField } from '../../components/SearchField';
import { ARCHIVE_SEARCH_DEBOUNCE_MS } from '../../items/useArchiveSearch';
import { AppToastProvider } from '../../components/AppToast';
import {
  getCollection,
  getCollectionItems,
  getCollectionItemSections,
  type Collection,
  type CollectionItemEntry,
} from '../../collections/api/collectionsApi';

// Collection Details browsing: 시간순 (the date accordion) and 이름순 (flat), each as List / Grid / Image.

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../items/api/itemsApi', () => ({ ...jest.requireActual('../../items/api/itemsApi'), deleteItem: jest.fn(), restoreItem: jest.fn() }));
jest.mock('../../collections/api/collectionsApi', () => ({
  deleteCollection: jest.fn(),
  enableCollectionShare: jest.fn(),
  getCollection: jest.fn(),
  getCollectionItems: jest.fn(),
  getCollectionItemSections: jest.fn(),
  getCollectionShare: jest.fn(),
  getCollections: jest.fn(),
  addItemToCollection: jest.fn(),
  addItemToCollections: jest.fn(),
  createCollection: jest.fn(),
  transferCollectionItem: jest.fn(),
  undoTransferCollectionItem: jest.fn(),
  mergeCollection: jest.fn(),
  undoCollectionMerge: jest.fn(),
  removeItemFromCollection: jest.fn(),
  renameCollection: jest.fn(),
  restoreCollection: jest.fn(),
  revokeCollectionShare: jest.fn(),
  setCollectionColor: jest.fn(),
  setCollectionFavorite: jest.fn(),
  setCollectionIcon: jest.fn(),
  getCollectionNotificationPreference: jest.fn().mockResolvedValue({ newItemNotificationsEnabled: true }),
  setCollectionNotificationPreference: jest.fn(),
  copyCollectionItems: jest.fn(),
  getCollectionShareLink: jest.fn().mockResolvedValue(null),
  MAX_ITEMS_PER_COPY: 200,
}));
jest.mock('../../collections/api/collaborationApi', () => ({ ...jest.requireActual('../../collections/api/collaborationApi'), leaveCollection: jest.fn() }));
jest.mock('../../items/shareItem', () => ({ shareItem: jest.fn() }));

const navigate = jest.fn();
const route = { key: 'CollectionDetails', name: 'CollectionDetails', params: { collectionId: 1 } } as never;
const navigation = { navigate, goBack: jest.fn(), replace: jest.fn(), popTo: jest.fn() } as never;

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return { id: 1, name: 'Groceries', isFavorite: false, itemCount: 1, createdAtUtc: new Date().toISOString(), updatedAtUtc: new Date().toISOString(), icon: 'Folder', color: null, accessRole: 'owner', ...overrides };
}
const daysAgo = (days: number, hour = 12) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, hour).toISOString();
};
function entry(id: number, daysBack: number, overrides: Partial<CollectionItemEntry> = {}): CollectionItemEntry {
  return { itemId: id, url: `https://site${id}.example/x`, title: `Link ${String(id).padStart(3, '0')}`, memo: `memo ${id}`, addedAtUtc: daysAgo(daysBack), sortOrder: 0, representativeImage: null, previewImageUrl: null, coverImage: null, ...overrides };
}

/** The server's 시간순 summary + section pages + search + the whole-Collection read, in memory. */
function serve(links: readonly CollectionItemEntry[], pageLimitOverride?: number) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sections: { key: string; kind: 'today' | 'month'; year: number | null; month: number | null; fromUtc: string; toUtc: string | null; count: number }[] = [];
  const todayCount = links.filter(link => new Date(link.addedAtUtc) >= todayStart).length;
  if (todayCount > 0) {
    sections.push({ key: 'today', kind: 'today', year: null, month: null, fromUtc: todayStart.toISOString(), toUtc: null, count: todayCount });
  }
  const older = links.filter(link => new Date(link.addedAtUtc) < todayStart);
  const monthKeys = [...new Set(older.map(link => { const date = new Date(link.addedAtUtc); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }))].sort().reverse();
  for (const monthKey of monthKeys) {
    const [year, month] = monthKey.split('-').map(Number);
    const from = new Date(year, month - 1, 1);
    const nextMonth = new Date(year, month, 1);
    const to = nextMonth < todayStart ? nextMonth : todayStart;
    const count = older.filter(link => new Date(link.addedAtUtc) >= from && new Date(link.addedAtUtc) < to).length;
    sections.push({ key: `month:${monthKey}`, kind: 'month', year, month, fromUtc: from.toISOString(), toUtc: to.toISOString(), count });
  }
  jest.mocked(getCollection).mockResolvedValue(makeCollection({ itemCount: links.length }));
  jest.mocked(getCollectionItemSections).mockImplementation(async () => sections);
  jest.mocked(getCollectionItems).mockImplementation(async (_request, _collectionId, options = {}) => {
    const sort = options.sort ?? 'dateDesc';
    const query = options.q?.toLowerCase();
    const inScope = links.filter(link =>
      (options.fromUtc === undefined || (new Date(link.addedAtUtc) >= new Date(options.fromUtc) && (!options.toUtc || new Date(link.addedAtUtc) < new Date(options.toUtc))))
      && (!query || `${link.title ?? ''} ${link.url}`.toLowerCase().includes(query)));
    // The server name orders: titled first (A-Z or Z-A), title-less last by host, equal names newest added first.
    const nameKey = (link: CollectionItemEntry) => (link.title && link.title.trim() ? link.title : link.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]);
    const nameBucket = (link: CollectionItemEntry) => (link.title && link.title.trim() ? 0 : 1);
    const byName = (direction: 1 | -1) => (a: CollectionItemEntry, b: CollectionItemEntry) =>
      nameBucket(a) - nameBucket(b) || direction * nameKey(a).localeCompare(nameKey(b)) || b.addedAtUtc.localeCompare(a.addedAtUtc) || b.itemId - a.itemId;
    const ordered = [...inScope].sort(
      sort === 'nameAsc' ? byName(1)
        : sort === 'nameDesc' ? byName(-1)
        : (a, b) => (sort === 'dateAsc' ? a.addedAtUtc.localeCompare(b.addedAtUtc) || a.itemId - b.itemId : b.addedAtUtc.localeCompare(a.addedAtUtc) || b.itemId - a.itemId),
    );
    const start = options.cursor ? Number(options.cursor.split(':')[1]) : 0;
    const end = start + Math.min(options.limit ?? 50, pageLimitOverride ?? 1000);
    return { items: ordered.slice(start, end), nextCursor: end < ordered.length ? `${sort}:${end}` : null };
  });
  return sections;
}

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  jest.mocked(getCollectionItems).mockResolvedValue({ items: [], nextCursor: null });
});

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <AppToastProvider>
        <CollectionDetailsScreen navigation={navigation} route={route} />
      </AppToastProvider>,
    );
  });
  await act(async () => {
    await new Promise<void>(resolve => setImmediate(() => resolve()));
  });
  return renderer;
}
type AnyRow = { kind: string; key: string; item?: CollectionItemEntry; items?: CollectionItemEntry[]; section?: { key: string }; label?: string; layout?: string };
const getList = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findByType(FlatList);
const rows = (renderer: ReactTestRenderer.ReactTestRenderer) => getList(renderer).props.data as AnyRow[];
const idsOf = (list: readonly AnyRow[]) => list.flatMap(row => (row.item ? [row.item.itemId] : row.items ? row.items.map(item => item.itemId) : []));
const header = (renderer: ReactTestRenderer.ReactTestRenderer) => {
  let part!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    part = ReactTestRenderer.create(getList(renderer).props.ListHeaderComponent);
  });
  return part;
};
const renderRow = (renderer: ReactTestRenderer.ReactTestRenderer, row: AnyRow) => {
  let part!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    part = ReactTestRenderer.create(getList(renderer).props.renderItem({ item: row, index: 1 }));
  });
  return part;
};
const tilesOf = (part: ReactTestRenderer.ReactTestRenderer) =>
  part.root.findAll(node => String(node.props.testID).startsWith('saved-link-image-tile') && typeof node.props.onPress === 'function');
async function setView(renderer: ReactTestRenderer.ReactTestRenderer, mode: 'list' | 'grid' | 'image') {
  const toggle = header(renderer).root.findByType(ViewModeToggle);
  await act(async () => {
    toggle.props.onChange(mode);
  });
}
async function pressSort(renderer: ReactTestRenderer.ReactTestRenderer, which: 'date' | 'name') {
  const chip = header(renderer).root.find(node => node.props.testID === `collection-sort-${which}` && typeof node.props.onPress === 'function');
  await act(async () => {
    chip.props.onPress();
  });
  await act(async () => {
    await new Promise<void>(resolve => setImmediate(() => resolve()));
  });
}
const flush = async () => {
  await act(async () => {
    await new Promise<void>(resolve => setImmediate(() => resolve()));
  });
};

/** Today: 1-4; this month and older months: 10-13 (spread over three months). */
const sample = () => [entry(1, 0), entry(2, 0), entry(3, 0), entry(4, 0), entry(10, 40), entry(11, 41), entry(12, 75), entry(13, 76)];
/** The server's 시간순 order: newest first, ties by id (newest id first). */
const newestFirst = (links: readonly CollectionItemEntry[]) => [...links].sort((a, b) => b.addedAtUtc.localeCompare(a.addedAtUtc) || b.itemId - a.itemId).map(link => link.itemId);

describe('Collection Details - selectors and layout', () => {
  it('offers 시간순 / 이름순 and List / Grid / Image (the shared switch) - and no 날짜별 / 전체 selector', async () => {
    serve(sample());
    const renderer = await renderScreen();
    const part = header(renderer);

    expect(part.root.findByType(LinkSortChips).props.dateLabel).toBe('시간순');
    expect(part.root.findByType(LinkSortChips).props.nameLabel).toBe('이름순');
    expect(part.root.findByType(ViewModeToggle).props.showImage).toBe(true);
    for (const label of ['List view', 'Grid view', 'Image view']) {
      expect(part.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function').length).toBeGreaterThan(0);
    }
    expect(part.root.findAll(node => node.props.testID === 'view-mode-image-glyph' && typeof node.type === 'string')[0].children).toHaveLength(9);
    expect(part.root.findAllByType(Text).some(node => ['날짜별', '전체'].includes(String(node.props.children)))).toBe(false);
    expect(part.root.findAll(node => String(node.props.testID).startsWith('collection-grouping'))).toHaveLength(0);
  });

  it('keeps the order: [시간순][이름순] … [List|Grid|Image] on ONE row, THEN search, THEN the links', async () => {
    serve(sample());
    const renderer = await renderScreen();
    const part = header(renderer);
    const chips = part.root.findByType(LinkSortChips);
    const viewToggle = part.root.findByType(ViewModeToggle);
    expect(viewToggle.parent).toBe(chips.parent);
    const everything = part.root.findAll(() => true);
    expect(everything.findIndex(node => node.type === LinkSortChips)).toBeLessThan(everything.findIndex(node => node.type === SearchField));
    expect(everything.findIndex(node => node.type === ViewModeToggle)).toBeLessThan(everything.findIndex(node => node.type === SearchField));
  });

  it('defaults to 시간순 + List (the current look), persists the view under its own key, and restores it', async () => {
    serve(sample());
    const renderer = await renderScreen();
    expect(header(renderer).root.findByType(ViewModeToggle).props.value).toBe('list');
    expect(rows(renderer).some(row => row.kind === 'header')).toBe(true);

    await setView(renderer, 'image');
    expect(mockStore.get('juple.collectionDetailsViewMode')).toBe('image');
    expect(mockStore.get('juple.homeViewMode')).toBeUndefined();
    expect(mockStore.get('juple.historyViewMode')).toBeUndefined();
    // The grouping preference of the removed 날짜별 / 전체 selector is gone for good.
    expect(mockStore.get('juple.collectionDetailsGroupingMode')).toBeUndefined();
    renderer.unmount();

    const restored = await renderScreen();
    expect(header(restored).root.findByType(ViewModeToggle).props.value).toBe('image');
  });

  it('still loads the stored List and Grid values', async () => {
    for (const stored of ['list', 'grid']) {
      mockStore.clear();
      mockStore.set('juple.collectionDetailsViewMode', stored);
      serve(sample());
      const renderer = await renderScreen();
      expect(header(renderer).root.findByType(ViewModeToggle).props.value).toBe(stored);
    }
  });
});

describe('Collection Details - 시간순 (the date accordion)', () => {
  it('keeps the date sections in List, Grid and Image', async () => {
    for (const view of ['list', 'grid', 'image'] as const) {
      mockStore.clear();
      serve(sample());
      const renderer = await renderScreen();
      await setView(renderer, view);
      expect(rows(renderer).filter(row => row.kind === 'header').length).toBeGreaterThanOrEqual(2);
      expect(rows(renderer).some(row => row.kind === (view === 'list' ? 'item' : view === 'grid' ? 'gridRow' : 'imageRow'))).toBe(true);
      renderer.unmount();
    }
  });

  it('Image: header, then lines of three tiles inside the section, the last one short - no blank accordion', async () => {
    serve([entry(1, 0), entry(2, 0), entry(3, 0), entry(4, 0), entry(5, 0), entry(6, 0), entry(7, 0)]);
    const renderer = await renderScreen();
    await setView(renderer, 'image');

    expect(rows(renderer).map(row => row.kind)).toEqual(['header', 'imageRow', 'imageRow', 'imageRow']);
    const lines = rows(renderer).filter(row => row.kind === 'imageRow');
    expect(lines.map(row => row.items!.map(item => item.itemId))).toEqual([[7, 6, 5], [4, 3, 2], [1]]);
    const views = lines.map(row => renderRow(renderer, row));
    expect(views.map(view => tilesOf(view).length)).toEqual([3, 3, 1]);
    // The card body is a COLUMN with a full-width line (a row-direction body would collapse the tiles to width 0).
    const body = StyleSheet.flatten(views[0].root.find(node => String(node.props.testID).startsWith('collection-date-image') && typeof node.type === 'string').props.style);
    const line = StyleSheet.flatten(views[0].root.find(node => String(node.props.testID).startsWith('collection-image-line') && typeof node.type === 'string').props.style);
    expect(body.flexDirection).toBe('column');
    expect(body.height).toBeUndefined();
    expect(line).toMatchObject({ flexDirection: 'row', width: '100%' });
  });

  it('a stored image view opens straight into the sections, with 오늘 expanded', async () => {
    mockStore.set('juple.collectionDetailsViewMode', 'image');
    serve(sample());
    const renderer = await renderScreen();
    expect(rows(renderer)[0].kind).toBe('header');
    expect(rows(renderer).some(row => row.kind === 'imageRow' && row.section?.key === 'today')).toBe(true);
  });
});

describe('Collection Details - 이름순', () => {
  it('is flat: no date headers in List, Grid or Image, the whole Collection by name', async () => {
    const links = [entry(1, 0, { title: 'Zebra' }), entry(2, 5, { title: 'apple' }), entry(3, 40, { title: 'Mango' }), entry(4, 90, { title: 'banana' })];
    for (const view of ['list', 'grid', 'image'] as const) {
      mockStore.clear();
      serve(links);
      const renderer = await renderScreen();
      await setView(renderer, view);
      await pressSort(renderer, 'name');

      const data = rows(renderer) as unknown as (CollectionItemEntry | AnyRow)[];
      const titles = view === 'image'
        ? (data as AnyRow[]).flatMap(row => row.items!.map(item => item.title))
        : (data as CollectionItemEntry[]).map(item => item.title);
      expect(titles).toEqual(['apple', 'banana', 'Mango', 'Zebra']);
      expect(JSON.stringify(data)).not.toContain('"header"');
      expect(getCollectionItems).toHaveBeenCalledWith(expect.anything(), 1, expect.objectContaining({ sort: 'dateDesc', limit: 100 }));
      expect(header(renderer).root.findByType(ViewModeToggle).props.value).toBe(view);
      renderer.unmount();
    }
  });

  it('Image under 이름순 is one continuous run of three-tile lines, with no section containers', async () => {
    const links = [entry(1, 0, { title: 'Zebra' }), entry(2, 5, { title: 'apple' }), entry(3, 40, { title: 'Mango' }), entry(4, 90, { title: 'banana' }), entry(5, 91, { title: 'cherry' })];
    serve(links);
    mockStore.set('juple.collectionDetailsViewMode', 'image');
    const renderer = await renderScreen();
    await pressSort(renderer, 'name');

    expect(rows(renderer).every(row => row.kind === 'flatImageRow')).toBe(true);
    expect(rows(renderer).map(row => row.items!.map(item => item.title))).toEqual([['apple', 'banana', 'cherry'], ['Mango', 'Zebra']]);
    const line = renderRow(renderer, rows(renderer)[0]);
    expect(tilesOf(line)).toHaveLength(3);
  });

  it('switching 시간순 <-> 이름순 keeps the chosen view and brings the sections back', async () => {
    serve(sample());
    const renderer = await renderScreen();
    await setView(renderer, 'image');
    await pressSort(renderer, 'name');
    expect(header(renderer).root.findByType(ViewModeToggle).props.value).toBe('image');
    expect(rows(renderer).some(row => row.kind === 'header')).toBe(false);
    await pressSort(renderer, 'date');
    expect(header(renderer).root.findByType(ViewModeToggle).props.value).toBe('image');
    expect(rows(renderer).some(row => row.kind === 'header')).toBe(true);
  });
});

describe('Collection Details - Image tiles', () => {
  it.each([[1, [1]], [2, [2]], [3, [3]], [4, [3, 1]], [7, [3, 3, 1]]])('%i links make lines %j, square tiles with no visible text', async (count, shape) => {
    serve(Array.from({ length: count }, (_, index) => entry(index + 1, 0)));
    mockStore.set('juple.collectionDetailsLinkSort', 'title');
    mockStore.set('juple.collectionDetailsViewMode', 'image');
    const renderer = await renderScreen();

    expect(rows(renderer).map(row => row.items!.length)).toEqual(shape);
    const views = rows(renderer).map(row => renderRow(renderer, row));
    expect(views.map(view => tilesOf(view).length)).toEqual(shape);
    for (const view of views) {
      expect(view.root.findAllByType(Text)).toHaveLength(0);
      expect(StyleSheet.flatten(tilesOf(view)[0].props.style)).toMatchObject({ aspectRatio: 1 });
      expect(JSON.stringify(view.toJSON()).replace(/"accessibilityLabel":"[^"]*"/g, '')).not.toMatch(/memo \d|site\d|example/);
    }
  });

  it('shows a picture, else a fallback, and falls back again when the picture fails to load', async () => {
    serve([
      entry(1, 0, { previewImageUrl: 'https://img.example/a.jpg' }),
      entry(2, 0, { url: 'https://www.youtube.com/watch?v=abc' }),
      entry(3, 0),
    ]);
    mockStore.set('juple.collectionDetailsLinkSort', 'title');
    mockStore.set('juple.collectionDetailsViewMode', 'image');
    const renderer = await renderScreen();
    const view = renderRow(renderer, rows(renderer)[0]);

    expect(view.root.findAllByType(Image)).toHaveLength(1);
    expect(view.root.findAll(node => node.props.testID === 'saved-link-image-tile-fallback' && typeof node.type === 'string')).toHaveLength(2);
    act(() => {
      view.root.findByType(Image).props.onError();
    });
    expect(view.root.findAllByType(Image)).toHaveLength(0);
    expect(view.root.findAll(node => node.props.testID === 'saved-link-image-tile-fallback' && typeof node.type === 'string')).toHaveLength(3);
  });

  it('tapping a tile opens the same Item Details (own link) or shared view (another member\'s) as a card does', async () => {
    serve([entry(1, 0), entry(2, 0, { isMine: false })]);
    mockStore.set('juple.collectionDetailsLinkSort', 'title');
    mockStore.set('juple.collectionDetailsViewMode', 'image');
    const renderer = await renderScreen();
    const view = renderRow(renderer, rows(renderer)[0]);

    const tileFor = (title: string) => tilesOf(view).find(tile => tile.props.accessibilityLabel === title)!;
    await act(async () => {
      tileFor('Link 001').props.onPress();
    });
    expect(navigate).toHaveBeenLastCalledWith('ItemDetails', expect.objectContaining({ itemId: 1, collectionContext: expect.objectContaining({ collectionId: 1 }) }));
    await act(async () => {
      tileFor('Link 002').props.onPress();
    });
    expect(navigate).toHaveBeenLastCalledWith('CollectionSharedItem', expect.objectContaining({ collectionId: 1, itemId: 2 }));
  });
});

describe('Collection Details - search', () => {
  beforeEach(() => {
    // setImmediate stays real: the screen helpers use it to let loads land.
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  const searchCalls = () => jest.mocked(getCollectionItems).mock.calls.filter(([, , options]) => options?.q !== undefined);
  async function search(renderer: ReactTestRenderer.ReactTestRenderer, text: string) {
    const field = header(renderer).root.findByType(SearchField);
    await act(async () => {
      field.props.onChangeText(text);
    });
    await act(async () => {
      jest.advanceTimersByTime(ARCHIVE_SEARCH_DEBOUNCE_MS + 10);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }
  const links = () => [entry(1, 0, { title: 'Quokka a' }), entry(2, 0, { title: 'Quokka b' }), entry(3, 0, { title: 'Quokka c' }), entry(4, 40, { title: 'Quokka d' }), entry(5, 0, { title: 'Other' })];

  it('Image: flat three-tile lines of the matches from ONE server search - no date labels, no extra call on a view switch; clearing restores the sections', async () => {
    serve(links());
    const renderer = await renderScreen();
    await setView(renderer, 'image');
    await search(renderer, 'quokka');

    expect(searchCalls()).toHaveLength(1);
    expect(searchCalls()[0][2]).toMatchObject({ q: 'quokka', sort: 'dateDesc', limit: 30 });
    expect(rows(renderer).map(row => row.kind)).toEqual(['flatImageRow', 'flatImageRow']);
    expect(rows(renderer).map(row => row.items!.map(item => item.itemId))).toEqual([[3, 2, 1], [4]]);

    await setView(renderer, 'list');
    expect(rows(renderer).every(row => row.kind === 'flatItem')).toBe(true);
    await setView(renderer, 'grid');
    expect(rows(renderer).every(row => row.kind === 'flatGridRow')).toBe(true);
    expect(searchCalls()).toHaveLength(1);

    await search(renderer, '');
    expect(rows(renderer).some(row => row.kind === 'header')).toBe(true);
    expect(searchCalls()).toHaveLength(1);
  });

  const sortChips = (renderer: ReactTestRenderer.ReactTestRenderer) => header(renderer).root.findByType(LinkSortChips);
  const nameLinks = () => [
    entry(1, 0, { title: 'Quokka pear' }),
    entry(2, 0, { title: 'Quokka apple' }),
    entry(3, 0, { title: 'Quokka mango' }),
    entry(4, 40, { title: 'Quokka banana' }),
    entry(5, 0, { title: 'Other' }),
  ];

  it('시간순 + search asks the server for the time order (newest, then oldest)', async () => {
    serve(nameLinks());
    const renderer = await renderScreen();
    await search(renderer, 'quokka');
    expect(searchCalls()).toHaveLength(1);
    expect(searchCalls()[0][2]).toMatchObject({ q: 'quokka', sort: 'dateDesc' });
    expect(sortChips(renderer).props.sort).toBe('newest');

    await search(renderer, '');
    await pressSort(renderer, 'date'); // newest -> oldest
    await search(renderer, 'quokka');
    expect(searchCalls()[searchCalls().length - 1][2]).toMatchObject({ q: 'quokka', sort: 'dateAsc' });
    expect(sortChips(renderer).props.sort).toBe('oldest');
  });

  it('이름순 + search stays 이름순: the chip is unchanged, the server is asked for the name order, results come back A-Z', async () => {
    serve(nameLinks());
    const renderer = await renderScreen();
    await pressSort(renderer, 'name');
    expect(sortChips(renderer).props.sort).toBe('title');
    await search(renderer, 'quokka');

    expect(searchCalls()).toHaveLength(1);
    expect(searchCalls()[0][2]).toMatchObject({ q: 'quokka', sort: 'nameAsc', limit: 30 });
    expect(sortChips(renderer).props.sort).toBe('title');
    expect(rows(renderer).every(row => row.kind === 'flatItem')).toBe(true);
    expect(rows(renderer).map(row => row.item!.title)).toEqual(['Quokka apple', 'Quokka banana', 'Quokka mango', 'Quokka pear']);
    expect(mockStore.get('juple.collectionDetailsLinkSort')).toBe('title');
  });

  it('이름순 descending searches with nameDesc; the server order is shown as it arrives', async () => {
    serve(nameLinks());
    mockStore.set('juple.collectionDetailsLinkSort', 'titleDesc');
    const renderer = await renderScreen();
    expect(sortChips(renderer).props.sort).toBe('titleDesc');
    await search(renderer, 'quokka');

    expect(searchCalls()[0][2]).toMatchObject({ sort: 'nameDesc' });
    expect(rows(renderer).map(row => row.item!.title)).toEqual(['Quokka pear', 'Quokka mango', 'Quokka banana', 'Quokka apple']);
  });

  it('switching 시간순 <-> 이름순 WHILE searching re-searches in the new order, keeping the query and the view', async () => {
    serve(nameLinks());
    const renderer = await renderScreen();
    await setView(renderer, 'grid');
    await search(renderer, 'quokka');
    expect(searchCalls()).toHaveLength(1);

    await pressSort(renderer, 'name');
    await act(async () => {
      jest.advanceTimersByTime(ARCHIVE_SEARCH_DEBOUNCE_MS + 10);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(searchCalls()[searchCalls().length - 1][2]).toMatchObject({ q: 'quokka', sort: 'nameAsc' });
    expect(header(renderer).root.findByType(SearchField).props.value).toBe('quokka');
    expect(header(renderer).root.findByType(ViewModeToggle).props.value).toBe('grid');
    expect(rows(renderer).every(row => row.kind === 'flatGridRow')).toBe(true);
    expect(idsOf(rows(renderer))).toEqual([2, 4, 3, 1]);
  });

  it('List / Grid / Image switches keep the sort and the query and never ask the server again', async () => {
    serve(nameLinks());
    mockStore.set('juple.collectionDetailsLinkSort', 'title');
    const renderer = await renderScreen();
    await search(renderer, 'quokka');
    const before = searchCalls().length;

    for (const mode of ['grid', 'image', 'list'] as const) {
      await setView(renderer, mode);
      expect(sortChips(renderer).props.sort).toBe('title');
      expect(header(renderer).root.findByType(SearchField).props.value).toBe('quokka');
      expect(idsOf(rows(renderer))).toEqual([2, 4, 3, 1]);
    }
    expect(searchCalls()).toHaveLength(before);
  });

  it('Image + 이름순 + search: flat three-tile lines in the server name order', async () => {
    serve(nameLinks());
    mockStore.set('juple.collectionDetailsLinkSort', 'title');
    mockStore.set('juple.collectionDetailsViewMode', 'image');
    const renderer = await renderScreen();
    await search(renderer, 'quokka');

    expect(rows(renderer).map(row => row.kind)).toEqual(['flatImageRow', 'flatImageRow']);
    expect(rows(renderer).map(row => row.items!.map(item => item.itemId))).toEqual([[2, 4, 3], [1]]);
    const line = renderRow(renderer, rows(renderer)[0]);
    expect(tilesOf(line)).toHaveLength(3);
  });

  it('clearing the search returns to the same selected sort (이름순 stays flat, no sections)', async () => {
    serve(nameLinks());
    const renderer = await renderScreen();
    await pressSort(renderer, 'name');
    await search(renderer, 'quokka');
    await search(renderer, '');

    expect(sortChips(renderer).props.sort).toBe('title');
    expect(rows(renderer).some(row => row.kind === 'header')).toBe(false);
    // The whole Collection again (all five links, not the two-match search), still without date sections.
    expect(rows(renderer)).toHaveLength(5);
  });

  it('name search pages with the name cursor: a global A-Z order across pages, no repeats', async () => {
    const many = Array.from({ length: 45 }, (_, index) => entry(100 + index, 0, { title: `Quokka ${String(44 - index).padStart(2, '0')}` }));
    serve(many);
    mockStore.set('juple.collectionDetailsLinkSort', 'title');
    mockStore.set('juple.collectionDetailsViewMode', 'image');
    const renderer = await renderScreen();
    await search(renderer, 'quokka');
    expect(idsOf(rows(renderer))).toHaveLength(30);

    await act(async () => {
      getList(renderer).props.onEndReached();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const ids = idsOf(rows(renderer));
    expect(ids).toHaveLength(45);
    expect(new Set(ids).size).toBe(45);
    // Titles 00..44 ascend, so the ids (144 - n) descend by one.
    expect(ids).toEqual(Array.from({ length: 45 }, (_, index) => 144 - index));
    expect(searchCalls().map(([, , options]) => options?.sort)).toEqual(['nameAsc', 'nameAsc']);
  });

  it('pages search results with the cursor, appending without repeats', async () => {
    const many = Array.from({ length: 45 }, (_, index) => entry(100 + index, 0, { title: `Quokka ${index}` }));
    serve(many);
    mockStore.set('juple.collectionDetailsViewMode', 'image');
    const renderer = await renderScreen();
    await search(renderer, 'quokka');
    expect(idsOf(rows(renderer))).toHaveLength(30);

    await act(async () => {
      getList(renderer).props.onEndReached();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(idsOf(rows(renderer))).toHaveLength(45);
    expect(new Set(idsOf(rows(renderer))).size).toBe(45);
    expect(searchCalls()).toHaveLength(2);
  });
});

describe('Collection Details - the search result list fills the viewport by itself (dense Image lines)', () => {
  const HEADER_HEIGHT = 400;
  const LINE_HEIGHT = { list: 90, grid: 200, image: 110 } as const;
  let reported = new WeakMap<object, number>();
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    reported = new WeakMap();
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  const many = (count: number) => Array.from({ length: count }, (_, index) => entry(100 + index, 0, { title: `Quokka ${String(index).padStart(3, '0')}` }));
  const searchCalls = () => jest.mocked(getCollectionItems).mock.calls.filter(([, , options]) => options?.q !== undefined);
  async function openSearch(view: 'list' | 'grid' | 'image', links: CollectionItemEntry[], pageCap: number) {
    serve(links, pageCap);
    mockStore.set('juple.collectionDetailsViewMode', view);
    const renderer = await renderScreen();
    const field = header(renderer).root.findByType(SearchField);
    await act(async () => {
      field.props.onChangeText('quokka');
    });
    await act(async () => {
      jest.advanceTimersByTime(ARCHIVE_SEARCH_DEBOUNCE_MS + 10);
    });
    await flush();
    return renderer;
  }
  async function layout(renderer: ReactTestRenderer.ReactTestRenderer, viewport: number) {
    await act(async () => {
      getList(renderer).props.onLayout({ nativeEvent: { layout: { height: viewport, width: 360, x: 0, y: 0 } } });
    });
  }
  async function measure(renderer: ReactTestRenderer.ReactTestRenderer, mode: 'list' | 'grid' | 'image', passes = 16) {
    for (let pass = 0; pass < passes; pass++) {
      const height = HEADER_HEIGHT + LINE_HEIGHT[mode] * rows(renderer).length;
      if (reported.get(renderer) !== height) {
        reported.set(renderer, height);
        await act(async () => {
          getList(renderer).props.onContentSizeChange(360, height);
        });
      }
      await flush();
    }
  }

  it('CRITICAL: short pages (7 per request) in Image keep loading until the viewport is full - no scrolling, in order, no repeats', async () => {
    const renderer = await openSearch('image', many(60), 7);
    expect(idsOf(rows(renderer))).toHaveLength(7);

    await layout(renderer, 800);
    await measure(renderer, 'image');

    const loaded = idsOf(rows(renderer));
    expect(loaded.length).toBeGreaterThan(7);
    expect(new Set(loaded).size).toBe(loaded.length);
    expect(loaded).toEqual(newestFirst(many(60)).slice(0, loaded.length));
    const cursors = searchCalls().map(([, , options]) => options?.cursor ?? '');
    expect(new Set(cursors).size).toBe(cursors.length);
  });

  it('stops once the viewport is filled, and when there is nothing more', async () => {
    const renderer = await openSearch('image', many(12), 7);
    await layout(renderer, 9000);
    await measure(renderer, 'image', 20);
    expect(idsOf(rows(renderer))).toHaveLength(12);
    const calls = searchCalls().length;
    await measure(renderer, 'image', 6);
    expect(searchCalls().length).toBe(calls);
  });

  it('List, Grid and Image converge to the same sequence', async () => {
    const sequences: number[][] = [];
    for (const view of ['list', 'grid', 'image'] as const) {
      reported = new WeakMap();
      jest.clearAllMocks();
      mockStore.clear();
      const renderer = await openSearch(view, many(40), 7);
      await layout(renderer, 99999);
      await measure(renderer, view, 24);
      sequences.push(idsOf(rows(renderer)));
      renderer.unmount();
    }
    expect(sequences[0]).toHaveLength(40);
    expect(sequences[1]).toEqual(sequences[0]);
    expect(sequences[2]).toEqual(sequences[0]);
  });

  it('a failing next page keeps the results, shows the compact retry and does not retry by itself; retrying resumes', async () => {
    const working = serve(many(40), 7);
    expect(working).toBeDefined();
    const original = jest.mocked(getCollectionItems).getMockImplementation()!;
    let failing = true;
    jest.mocked(getCollectionItems).mockImplementation(async (request, collectionId, options = {}) => {
      if (failing && options.q !== undefined && options.cursor) {
        throw new Error('offline');
      }
      return original(request, collectionId, options);
    });
    mockStore.set('juple.collectionDetailsViewMode', 'image');
    const renderer = await renderScreen();
    const field = header(renderer).root.findByType(SearchField);
    await act(async () => {
      field.props.onChangeText('quokka');
    });
    await act(async () => {
      jest.advanceTimersByTime(ARCHIVE_SEARCH_DEBOUNCE_MS + 10);
    });
    await flush();
    await layout(renderer, 5000);
    await measure(renderer, 'image', 12);

    expect(idsOf(rows(renderer))).toHaveLength(7);
    const calls = searchCalls().length;
    expect(renderer.root.findAll(node => node.props.testID === 'collection-search-more-error').length).toBeGreaterThan(0);
    await measure(renderer, 'image', 6);
    expect(searchCalls().length).toBe(calls);

    failing = false;
    await act(async () => {
      renderer.root.find(node => node.props.testID === 'collection-search-more-error-retry' && typeof node.props.onPress === 'function').props.onPress();
    });
    await flush();
    await measure(renderer, 'image', 12);
    expect(idsOf(rows(renderer)).length).toBeGreaterThan(7);
  });
});
