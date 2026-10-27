import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Image, StyleSheet, Text } from 'react-native';
import i18n from '../../i18n';
import { CollectionDetailsScreen } from '../CollectionDetailsScreen';
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

// Collection Details browsing: one flat list, always newest first, as List / Grid / Image - and its search.

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

/** The server's link pages and search, in memory (the section summary stays served to prove nothing asks for it). */
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
/** Every link the list shows, in order - List / Grid list the links themselves, Image lines of tiles. */
const listedIds = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  (getList(renderer).props.data as readonly (AnyRow | CollectionItemEntry)[]).flatMap(shown =>
    'itemId' in shown ? [shown.itemId] : idsOf([shown as AnyRow]));
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
const flush = async () => {
  await act(async () => {
    await new Promise<void>(resolve => setImmediate(() => resolve()));
  });
};

/** Today: 1-4; this month and older months: 10-13 (spread over three months). */
const sample = () => [entry(1, 0), entry(2, 0), entry(3, 0), entry(4, 0), entry(10, 40), entry(11, 41), entry(12, 75), entry(13, 76)];
/** The server's 시간순 order: newest first, ties by id (newest id first). */
const newestFirst = (links: readonly CollectionItemEntry[]) => [...links].sort((a, b) => b.addedAtUtc.localeCompare(a.addedAtUtc) || b.itemId - a.itemId).map(link => link.itemId);

describe('Collection Details - one list, always newest first', () => {
  it('offers only List / Grid / Image (the shared switch) - no 시간순 / 이름순 and no 날짜별 / 전체 selector', async () => {
    serve(sample());
    const renderer = await renderScreen();
    const part = header(renderer);

    expect(part.root.findByType(ViewModeToggle).props.showImage).toBe(true);
    for (const label of [i18n.t('common.viewList'), i18n.t('common.viewGrid'), i18n.t('common.viewImage')]) {
      expect(part.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function').length).toBeGreaterThan(0);
    }
    expect(part.root.findAll(node => node.props.testID === 'view-mode-image-glyph' && typeof node.type === 'string')[0].children).toHaveLength(9);
    expect(part.root.findAllByType(Text).some(node => ['시간순', '이름순', '날짜별', '전체'].includes(String(node.props.children)))).toBe(false);
    expect(part.root.findAll(node => /^collection-(sort|grouping)/.test(String(node.props.testID)))).toHaveLength(0);
  });

  it('keeps the order: [List|Grid|Image] at the end of its row, THEN search, THEN the links', async () => {
    serve(sample());
    const renderer = await renderScreen();
    const part = header(renderer);
    const controls = part.root.findAll(node => node.props.testID === 'collection-view-controls' && typeof node.type === 'string')[0];
    const children = controls.children as ReactTestRenderer.ReactTestInstance[];
    expect(children[children.length - 1].type).toBe(ViewModeToggle);
    const everything = part.root.findAll(() => true);
    expect(everything.findIndex(node => node.type === ViewModeToggle)).toBeLessThan(everything.findIndex(node => node.type === SearchField));
  });

  it('defaults to List (the current look), persists the view under its own key, and restores it', async () => {
    serve(sample());
    const renderer = await renderScreen();
    expect(header(renderer).root.findByType(ViewModeToggle).props.value).toBe('list');

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

  it('shows every link as ONE flat list, newest added first, in List, Grid and Image - no date headers to open', async () => {
    for (const view of ['list', 'grid', 'image'] as const) {
      mockStore.clear();
      mockStore.set('juple.collectionDetailsViewMode', view);
      serve(sample());
      const renderer = await renderScreen();

      expect(listedIds(renderer)).toEqual(newestFirst(sample()));
      expect(JSON.stringify(rows(renderer))).not.toContain('"header"');
      expect(getCollectionItemSections).not.toHaveBeenCalled();
      expect(getCollectionItems).toHaveBeenCalledWith(expect.anything(), 1, expect.objectContaining({ sort: 'dateDesc', limit: 50 }));
      expect(jest.mocked(getCollectionItems).mock.calls.every(([, , options]) => options?.fromUtc === undefined)).toBe(true);
      renderer.unmount();
    }
  });

  it('a sort stored by an older version changes nothing - still newest first, no chips', async () => {
    serve([entry(1, 0, { title: 'Zebra' }), entry(2, 5, { title: 'apple' }), entry(3, 40, { title: 'Mango' })]);
    const renderer = await renderScreen();
    expect(listedIds(renderer)).toEqual([1, 2, 3]);
    expect(header(renderer).root.findAll(node => String(node.props.testID).startsWith('collection-sort-'))).toHaveLength(0);
  });

  it('Image: one continuous run of three-tile lines, the last one short - no section containers', async () => {
    serve([entry(1, 0), entry(2, 0), entry(3, 0), entry(4, 0), entry(5, 0), entry(6, 0), entry(7, 0)]);
    mockStore.set('juple.collectionDetailsViewMode', 'image');
    const renderer = await renderScreen();

    expect(rows(renderer).every(row => row.kind === 'flatImageRow')).toBe(true);
    expect(rows(renderer).map(row => row.items!.map(item => item.itemId))).toEqual([[7, 6, 5], [4, 3, 2], [1]]);
    const views = rows(renderer).map(row => renderRow(renderer, row));
    expect(views.map(view => tilesOf(view).length)).toEqual([3, 3, 1]);
  });

  it('pages the next links as the end of the list comes near - in order, no repeats - in List, Grid and Image', async () => {
    const many = Array.from({ length: 75 }, (_, index) => entry(1000 + index, Math.floor(index / 10)));
    for (const view of ['list', 'grid', 'image'] as const) {
      mockStore.clear();
      mockStore.set('juple.collectionDetailsViewMode', view);
      serve(many);
      const renderer = await renderScreen();
      expect(listedIds(renderer)).toEqual(newestFirst(many).slice(0, 50));

      await act(async () => {
        getList(renderer).props.onEndReached();
      });
      await flush();
      expect(listedIds(renderer)).toEqual(newestFirst(many));
      expect(new Set(listedIds(renderer)).size).toBe(75);
      // Nothing more to ask for: the end is quiet.
      const calls = jest.mocked(getCollectionItems).mock.calls.length;
      await act(async () => {
        getList(renderer).props.onEndReached();
      });
      await flush();
      expect(jest.mocked(getCollectionItems).mock.calls.length).toBe(calls);
      renderer.unmount();
    }
  });
});

describe('Collection Details - Image tiles', () => {
  it.each([[1, [1]], [2, [2]], [3, [3]], [4, [3, 1]], [7, [3, 3, 1]]])('%i links make lines %j, square tiles with no visible text', async (count, shape) => {
    serve(Array.from({ length: count }, (_, index) => entry(index + 1, 0)));
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
    expect(navigate).toHaveBeenLastCalledWith('ItemDetails', expect.objectContaining({ itemId: 2, collectionContext: expect.objectContaining({ collectionId: 1, readOnly: true }) }));
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

  it('Image: flat three-tile lines of the matches from ONE server search - no extra call on a view switch; clearing restores the whole list', async () => {
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
    // The whole Collection again (all five links, not the four matches), still one flat newest-first list.
    expect(listedIds(renderer)).toEqual(newestFirst(links()));
    expect(searchCalls()).toHaveLength(1);
  });

  it('a search always asks the server for newest first', async () => {
    serve(links());
    mockStore.set('juple.collectionDetailsLinkSort', 'titleDesc');
    const renderer = await renderScreen();
    await search(renderer, 'quokka');
    expect(searchCalls().map(([, , options]) => options?.sort)).toEqual(['dateDesc']);
    expect(listedIds(renderer)).toEqual([3, 2, 1, 4]);
  });

  it('List / Grid / Image switches keep the query and never ask the server again', async () => {
    serve(links());
    const renderer = await renderScreen();
    await search(renderer, 'quokka');
    const before = searchCalls().length;

    for (const mode of ['grid', 'image', 'list'] as const) {
      await setView(renderer, mode);
      expect(header(renderer).root.findByType(SearchField).props.value).toBe('quokka');
      expect(listedIds(renderer)).toEqual([3, 2, 1, 4]);
    }
    expect(searchCalls()).toHaveLength(before);
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

  // Each view is an independent lifecycle under the normal five-second budget. Comparing each
  // complete result with the canonical order is stronger than comparing three possibly-partial lists.
  // A timed-out three-view loop used to continue mounting/unmounting roots in the following test.
  it.each(['list', 'grid', 'image'] as const)('%s converges to the complete canonical sequence', async view => {
    reported = new WeakMap();
    const source = many(40);
    const renderer = await openSearch(view, source, 7);
    await layout(renderer, 99999);
    await measure(renderer, view, 24);
    expect(idsOf(rows(renderer))).toEqual(newestFirst(source));
    await act(async () => { renderer.unmount(); });
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
