import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Modal, StyleSheet, Text, View } from 'react-native';
import i18n from '../../i18n';
import { ViewModeToggle } from '../../components/ViewModeToggle';
import { SwipeableItemRow } from '../../components/SwipeableItemRow';
import { SearchField } from '../../components/SearchField';
import { LoadFailureState } from '../../components/LoadFailureState';
import { CenteredEmptyState } from '../../components/CenteredEmptyState';
import { UndoToast } from '../../components/UndoToast';
import { AppToastProvider } from '../../components/AppToast';
import { savedLinkLayout } from '../../components/savedLinkLayout';
import { ARCHIVE_SEARCH_DEBOUNCE_MS, ARCHIVE_SEARCH_PAGE_SIZE } from '../../items/useArchiveSearch';
import {
  deleteItem,
  getItemHistory,
  getItemHistorySections,
  restoreItem,
  type GetItemHistoryOptions,
  type ItemHistoryEntry,
} from '../../items/api/itemsApi';
import { buildFlatRows, DateHistoryScreen, type FlatRow } from '../DateHistoryScreen';
import { swipeRowToDelete } from '../../testing/swipeRowDriver';

// The Archive: one flat list of every link, always newest first, a page at a time - and a search over it.

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

const mockNavigate = jest.fn();
const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
}));
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
jest.mock('../../items/api/itemsApi', () => ({
  ...jest.requireActual('../../items/api/itemsApi'),
  getItemHistorySections: jest.fn(),
  getItemHistory: jest.fn(),
  deleteItem: jest.fn(),
  restoreItem: jest.fn(),
}));
jest.mock('../../items/shareItem', () => ({ shareItem: jest.fn() }));

function makeItem(overrides: Partial<ItemHistoryEntry>): ItemHistoryEntry {
  return { id: 1, url: 'https://example.com', title: 'Example', memo: null, savedAtUtc: new Date().toISOString(), representativeImage: null, previewImageUrl: null, coverImage: null, ...overrides };
}
/** `count` links, one hour apart, the newest first (id `first`). */
function links(count: number, first = 1, title = 'Link'): ItemHistoryEntry[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, index) => makeItem({ id: first + index, title: `${title} ${first + index}`, savedAtUtc: new Date(now - index * 3_600_000).toISOString() }));
}

/** GET /api/v1/items/history over `all`: newest saved first (ties by id), `q` a contains search, `limit` a page with an offset cursor. */
let all: ItemHistoryEntry[] = [];
function serve(entries: readonly ItemHistoryEntry[]) {
  all = [...entries];
  jest.mocked(getItemHistory).mockImplementation(async (_request, options: GetItemHistoryOptions = {}) => {
    const query = options.q?.toLowerCase();
    const ordered = all
      .filter(item => !query || `${item.title ?? ''} ${item.url}`.toLowerCase().includes(query))
      .sort((a, b) => b.savedAtUtc.localeCompare(a.savedAtUtc) || b.id - a.id);
    const start = options.cursor ? Number(options.cursor) : 0;
    const end = start + (options.limit ?? 50);
    return { items: ordered.slice(start, end), nextCursor: end < ordered.length ? String(end) : null };
  });
  jest.mocked(deleteItem).mockImplementation(async (_request, itemId) => {
    all = all.filter(item => item.id !== itemId);
  });
}

async function flush() {
  await act(async () => {
    await new Promise<void>(resolve => setImmediate(() => resolve()));
  });
}
async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <AppToastProvider>
        <DateHistoryScreen />
      </AppToastProvider>,
    );
  });
  await flush();
  return renderer;
}
const getList = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findByType(FlatList);
const rows = (renderer: ReactTestRenderer.ReactTestRenderer): readonly FlatRow[] => getList(renderer).props.data;
const shownIds = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  rows(renderer).flatMap(row => (row.kind === 'flatItem' ? [row.item.id] : row.kind === 'flatGridRow' || row.kind === 'flatImageRow' ? row.items.map(item => item.id) : []));
function renderPart(element: React.ReactElement) {
  let part!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    part = ReactTestRenderer.create(element);
  });
  return part;
}
const header = (renderer: ReactTestRenderer.ReactTestRenderer) => renderPart(<View>{renderer.root.findAll(node => node.props.testID === 'history-fixed-header' && typeof node.type === 'string')[0].props.children}{getList(renderer).props.ListHeaderComponent}</View>);
const renderRow = (renderer: ReactTestRenderer.ReactTestRenderer, row: FlatRow) => renderPart(getList(renderer).props.renderItem({ item: row, index: 0 }));
const historyCalls = () => jest.mocked(getItemHistory).mock.calls.map(([, options]) => options ?? {});

async function deleteViaSwipe(renderer: ReactTestRenderer.ReactTestRenderer, itemId: number) {
  const row = renderRow(renderer, rows(renderer).find(candidate => candidate.kind === 'flatItem' && candidate.item.id === itemId)!);
  await swipeRowToDelete(row.root);
  await act(async () => {
    renderer.root.findByType(Modal).findAll(node => node.props.accessibilityLabel === '삭제')[0].props.onPress();
  });
  await flush();
}

beforeEach(() => {
  mockStore.clear();
});
afterEach(() => {
  jest.clearAllMocks();
});

describe('DateHistoryScreen header', () => {
  it('puts 보관함 and the List/Grid/Image switch on ONE title row (title one line, switch at the end), then the search - no sort chips', async () => {
    serve(links(3));
    const renderer = await renderScreen();

    expect(i18n.t('history.title')).toBe('보관함');
    const part = header(renderer);
    const title = part.root.findAll(node => node.props.children === '보관함' && typeof node.type === 'string')[0];
    const titleRow = part.root.findAll(node => node.findAll(inner => inner === title).length > 0 && StyleSheet.flatten(node.props.style)?.justifyContent === 'space-between')[0];
    expect(titleRow.findAllByType(ViewModeToggle)).toHaveLength(1);

    const controls = part.root.findAll(node => node.props.testID === 'history-view-controls' && typeof node.type === 'string')[0];
    expect(controls.findAllByType(ViewModeToggle)).toHaveLength(1);
    expect(part.root.findByType(ViewModeToggle).props.showImage).toBe(true);
    const everything = part.root.findAll(() => true);
    expect(everything.findIndex(node => node.type === ViewModeToggle)).toBeLessThan(everything.findIndex(node => node.type === SearchField));
    expect(part.root.findAllByType(Text).some(node => ['시간순', '이름순', '날짜별', '전체'].includes(String(node.props.children)))).toBe(false);
    expect(part.root.findAll(node => String(node.props.testID).startsWith('history-sort'))).toHaveLength(0);
  });
});

describe('DateHistoryScreen - one list, newest first', () => {
  it('opens with every link newest first from ONE plain request - no date sections, no section summary', async () => {
    const source = links(5);
    serve([...source].reverse()); // the order the server stores them in does not matter
    const renderer = await renderScreen();

    expect(shownIds(renderer)).toEqual([1, 2, 3, 4, 5]);
    expect(historyCalls()).toEqual([expect.objectContaining({ limit: ARCHIVE_SEARCH_PAGE_SIZE })]);
    expect(historyCalls()[0]).toEqual(expect.not.objectContaining({ q: expect.anything() }));
    expect(historyCalls()[0].sort).toBeUndefined();
    expect(historyCalls()[0].fromUtc).toBeUndefined();
    expect(getItemHistorySections).not.toHaveBeenCalled();
    expect(rows(renderer).every(row => row.kind === 'flatItem')).toBe(true);
  });

  it('a sort stored by an older version changes nothing', async () => {
    mockStore.set('juple.historyLinkSort', 'title');
    serve(links(3));
    const renderer = await renderScreen();
    expect(shownIds(renderer)).toEqual([1, 2, 3]);
    expect(historyCalls().every(options => options.sort === undefined)).toBe(true);
  });

  it('pages the next links as the end comes near - in order, no repeats - and stops at the end', async () => {
    serve(links(45));
    const renderer = await renderScreen();
    expect(shownIds(renderer)).toEqual(links(30).map(item => item.id));

    await act(async () => {
      getList(renderer).props.onEndReached();
    });
    await flush();
    expect(shownIds(renderer)).toEqual(links(45).map(item => item.id));
    expect(historyCalls().map(options => options.cursor)).toEqual([undefined, '30']);

    await act(async () => {
      getList(renderer).props.onEndReached();
    });
    await flush();
    expect(historyCalls()).toHaveLength(2);
  });

  it('List rows are the shared rounded, bordered card; Grid and Image are the same links - with no new request', async () => {
    serve(links(4));
    const renderer = await renderScreen();
    const listRow = renderRow(renderer, rows(renderer)[0]);
    expect([listRow.root.findByType(SwipeableItemRow).props.containerStyle].flat()).toContain(savedLinkLayout.card);
    expect(StyleSheet.flatten(savedLinkLayout.card)).toEqual(expect.objectContaining({ borderRadius: expect.any(Number), borderWidth: expect.any(Number) }));

    const toggle = header(renderer).root.findByType(ViewModeToggle);
    await act(async () => {
      toggle.props.onChange('grid');
    });
    expect(rows(renderer).map(row => row.kind)).toEqual(['flatGridRow', 'flatGridRow']);
    await act(async () => {
      toggle.props.onChange('image');
    });
    expect(rows(renderer).map(row => row.kind)).toEqual(['flatImageRow', 'flatImageRow']);
    expect(shownIds(renderer)).toEqual([1, 2, 3, 4]);
    expect(historyCalls()).toHaveLength(1);
  });

  it('an empty Archive says so; a failed first load offers a retry that loads again', async () => {
    serve([]);
    const empty = await renderScreen();
    expect(rows(empty).map(row => row.kind)).toEqual(['searchStatus']);
    expect(renderRow(empty, rows(empty)[0]).root.findByType(CenteredEmptyState).props.message).toBe(i18n.t('history.empty'));
    empty.unmount();

    serve(links(2));
    jest.mocked(getItemHistory).mockRejectedValueOnce(new Error('offline'));
    const failed = await renderScreen();
    const failure = renderRow(failed, rows(failed)[0]).root.findByType(LoadFailureState);
    await act(async () => {
      failure.props.onRetry();
    });
    await flush();
    expect(shownIds(failed)).toEqual([1, 2]);
  });
});

describe('DateHistoryScreen delete undo', () => {
  it('a deleted link leaves the list at once, with the undo toast above the tab bar; undo brings it back in place', async () => {
    serve(links(3));
    jest.mocked(restoreItem).mockImplementation(async () => {
      all = links(3);
    });
    const renderer = await renderScreen();

    await deleteViaSwipe(renderer, 2);
    expect(deleteItem).toHaveBeenCalledWith(expect.anything(), 2);
    expect(shownIds(renderer)).toEqual([1, 3]);
    expect(renderer.root.findByType(UndoToast).props.bottomOffset).toBe(80);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress();
    });
    await flush();
    expect(restoreItem).toHaveBeenCalledWith(expect.anything(), 2);
    expect(shownIds(renderer)).toEqual([1, 2, 3]);
  });
});

describe('DateHistoryScreen - search the whole archive', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  async function type(renderer: ReactTestRenderer.ReactTestRenderer, text: string) {
    const field = header(renderer).root.findByType(SearchField);
    await act(async () => {
      field.props.onChangeText(text);
    });
    await act(async () => {
      jest.advanceTimersByTime(ARCHIVE_SEARCH_DEBOUNCE_MS + 10);
    });
    await flush();
  }

  it('searches the server (newest first) after the pause, and clearing goes straight back to every link', async () => {
    serve([...links(3, 1, 'Quokka'), ...links(2, 10, 'Other')]);
    const renderer = await renderScreen();
    await type(renderer, 'quokka');

    expect(historyCalls().filter(options => options.q !== undefined)).toEqual([expect.objectContaining({ q: 'quokka', limit: ARCHIVE_SEARCH_PAGE_SIZE })]);
    expect(historyCalls().every(options => options.sort === undefined)).toBe(true);
    expect(shownIds(renderer)).toEqual([1, 2, 3]);

    await type(renderer, '');
    // Every link again, in the server's newest-first order.
    expect(shownIds(renderer)).toEqual([...all].sort((a, b) => b.savedAtUtc.localeCompare(a.savedAtUtc) || b.id - a.id).map(item => item.id));
    expect(shownIds(renderer)).toHaveLength(5);
  });

  it('one character only shows the hint - nothing is searched', async () => {
    serve(links(3));
    const renderer = await renderScreen();
    await type(renderer, 'q');
    expect(header(renderer).root.findAll(node => node.props.testID === 'history-search-hint' && typeof node.type === 'string')).toHaveLength(1);
    expect(historyCalls().filter(options => options.q !== undefined)).toHaveLength(0);
    expect(shownIds(renderer)).toEqual([1, 2, 3]);
  });

  it('nothing found says so in the search\'s own words', async () => {
    serve(links(3));
    const renderer = await renderScreen();
    await type(renderer, 'zzz');
    expect(rows(renderer).map(row => row.kind)).toEqual(['searchStatus']);
    expect(renderRow(renderer, rows(renderer)[0]).root.findAll(node => node.props.testID === 'history-search-empty' && typeof node.type === 'string')).toHaveLength(1);
  });
});

describe('buildFlatRows', () => {
  const items = [1, 2, 3].map(id => makeItem({ id, savedAtUtc: new Date().toISOString() }));

  it('is one unbroken run in the given order: a row per link in List, pairs in Grid, three to a line in Image', () => {
    expect(buildFlatRows(items, 'list').map(row => row.kind)).toEqual(['flatItem', 'flatItem', 'flatItem']);
    expect(buildFlatRows(items, 'grid').map(row => (row.kind === 'flatGridRow' ? row.items.map(item => item.id) : []))).toEqual([[1, 2], [3]]);
    expect(buildFlatRows(items, 'image').map(row => (row.kind === 'flatImageRow' ? row.items.map(item => item.id) : []))).toEqual([[1, 2, 3]]);
  });

  it('keys every row by its first link, so a later page never reshuffles the lines already there', () => {
    const more = [...items, ...[4, 5, 6, 7].map(id => makeItem({ id }))];
    expect(buildFlatRows(more, 'image').slice(0, 1).map(row => row.key)).toEqual(buildFlatRows(items, 'image').map(row => row.key));
  });
});

describe('Archive: long-press starts multi-selection (the same as Home)', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockStore.clear();
  });

  const topBar = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByProps({ testID: 'selection-top-bar' });

  it('long-press selects the link and shows the selection header; a tap chooses another without opening it', async () => {
    serve(links(3));
    const renderer = await renderScreen();
    const first = renderRow(renderer, rows(renderer).find(candidate => candidate.kind === 'flatItem')!);
    const onLongPress = first.root.findByType(SwipeableItemRow).props.onLongPress;
    expect(topBar(renderer)).toHaveLength(0);

    await act(async () => onLongPress());

    expect(topBar(renderer).length).toBeGreaterThan(0);
    expect(renderer.root.findByProps({ testID: 'selection-count' }).props.children).toBe(i18n.t('selection.selectedCount', { count: 1 }));
    const second = renderRow(renderer, rows(renderer).filter(candidate => candidate.kind === 'flatItem')[1]);
    const selection = second.root.findByType(SwipeableItemRow).props.selection;
    expect(selection.selected).toBe(false);
    await act(async () => selection.onToggle());
    expect(renderer.root.findByProps({ testID: 'selection-count' }).props.children).toBe(i18n.t('selection.selectedCount', { count: 2 }));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('전체 선택 chooses what is loaded; the close button ends selection', async () => {
    serve(links(3));
    const renderer = await renderScreen();
    const first = renderRow(renderer, rows(renderer).find(candidate => candidate.kind === 'flatItem')!);
    const onLongPress = first.root.findByType(SwipeableItemRow).props.onLongPress;
    await act(async () => onLongPress());

    await act(async () => renderer.root.findByProps({ testID: 'selection-toggle-all' }).props.onPress());
    expect(renderer.root.findByProps({ testID: 'selection-count' }).props.children).toBe(i18n.t('selection.selectedCount', { count: 3 }));

    await act(async () => renderer.root.findByProps({ testID: 'selection-exit' }).props.onPress());
    expect(topBar(renderer)).toHaveLength(0);
  });
});

describe('DateHistoryScreen fixed header', () => {
  it('keeps the title row and search outside the scrolling list; the list is the only scroller', async () => {
    serve(links(3));
    const renderer = await renderScreen();
    const fixed = renderer.root.findAll(node => node.props.testID === 'history-fixed-header' && typeof node.type === 'string')[0];
    expect(fixed.findAll(node => node.props.testID === 'history-search').length).toBeGreaterThan(0);
    expect(fixed.findAllByType(FlatList)).toHaveLength(0);
    expect(getList(renderer).findAll(node => node.props.testID === 'history-search')).toHaveLength(0);
  });
});

describe('DateHistoryScreen pinned search line', () => {
  it('centers the search field and never stretches the view switch (it keeps its own 40dp height once the title has collapsed)', async () => {
    serve(links(3));
    const renderer = await renderScreen();
    const frame = renderer.root.findAll(node => node.props.testID === 'history-fixed-header' && typeof node.type === 'string')[0];
    const line = frame.findAll(node => typeof node.type === 'string' && node.findAll(inner => inner.props.testID === 'history-search').length > 0 && StyleSheet.flatten(node.props.style)?.flexDirection === 'row')[0];
    expect(StyleSheet.flatten(line.props.style)).toMatchObject({ alignItems: 'center', flexDirection: 'row' });
    // The gap below the line is the line's (not the field's), so it cannot take part in the vertical centering.
    expect(StyleSheet.flatten(line.props.style).marginBottom).toBe(12);
    const field = line.children[0] as ReactTestRenderer.ReactTestInstance;
    expect(StyleSheet.flatten(field.props.style).marginBottom).toBeUndefined();
  });
});
