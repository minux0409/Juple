import { BrokenLinkIcon } from '../../icons/BrokenLinkIcon';
import { InfoIcon } from '../../icons/InfoIcon';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Dimensions, FlatList, Modal, StyleSheet, type ListViewToken } from 'react-native';
import i18n from '../../i18n';
import { LinkSortChips } from '../../components/LinkSortChips';
import { ViewModeToggle } from '../../components/ViewModeToggle';
import { ActionMenuDialog } from '../../components/ActionMenuDialog';
import { SwipeableItemRow } from '../../components/SwipeableItemRow';
import { buildFlatRows } from '../DateHistoryScreen';
import {
  buildHistoryRows,
  DateHistoryScreen,
  FIRST_PAGE_SKELETON_ROWS,
  NEXT_PAGE_SKELETON_ROWS,
  type HistoryRow,
} from '../DateHistoryScreen';

// The react-native-localize jest mock (see jest.config.js) reports "en-US", so i18n would
// otherwise resolve to English by default - pinned to Korean so this file's label assertions are
// deterministic regardless of that mock's default locale.
beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
import {
  deleteItem,
  getItemHistory,
  getItemHistorySections,
  restoreItem,
  type GetItemHistoryOptions,
  type ItemHistoryEntry,
  type ItemHistorySection,
} from '../../items/api/itemsApi';
import { shareItem } from '../../items/shareItem';
import { HISTORY_SECTION_PAGE_SIZE, type HistorySectionPage } from '../../items/useHistorySections';
import { UndoToast } from '../../components/UndoToast';
import { AppToastProvider } from '../../components/AppToast';
import { CenteredEmptyState } from '../../components/CenteredEmptyState';
import { DateSectionHeader } from '../../components/DateAccordion';
import { SavedLinkGridCell } from '../../components/SavedLinkGridCard';
import { SavedLinkRow } from '../../components/SavedLinkRow';
import { SearchField } from '../../components/SearchField';
import { ARCHIVE_SEARCH_DEBOUNCE_MS } from '../../items/useArchiveSearch';
import { Text, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  // Runs once on mount, like a first focus - History's summary load and useToastBottomAnchor.
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => {
      return callback();
    }, [callback]);
  },
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  useBottomTabBarHeight: () => 80,
}));

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

jest.mock('../../items/shareItem', () => ({
  shareItem: jest.fn(),
}));


function makeItem(overrides: Partial<ItemHistoryEntry>): ItemHistoryEntry {
  return {
    id: 1,
    url: 'https://example.com',
    title: 'Example',
    memo: null,
    savedAtUtc: new Date().toISOString(),
    representativeImage: null,
    previewImageUrl: null,
    coverImage: null,
    ...overrides,
  };
}

// Section windows only need to be distinct - the screen never re-derives dates from them.
const WINDOWS: Record<string, { fromUtc: string; toUtc: string | null }> = {
  today: { fromUtc: '2026-09-29T15:00:00+00:00', toUtc: null },
  yesterday: { fromUtc: '2026-09-28T15:00:00+00:00', toUtc: '2026-09-29T15:00:00+00:00' },
  thisWeek: { fromUtc: '2026-09-26T15:00:00+00:00', toUtc: '2026-09-28T15:00:00+00:00' },
  'month:2026-09': { fromUtc: '2026-08-31T15:00:00+00:00', toUtc: '2026-09-26T15:00:00+00:00' },
  'month:2026-08': { fromUtc: '2026-07-31T15:00:00+00:00', toUtc: '2026-08-31T15:00:00+00:00' },
  'month:2026-07': { fromUtc: '2026-06-30T15:00:00+00:00', toUtc: '2026-07-31T15:00:00+00:00' },
};

function makeSection(kind: ItemHistorySection['kind'], key: string, count: number): ItemHistorySection {
  const window = WINDOWS[kind === 'month' ? key : kind];
  const [year, month] = kind === 'month' ? key.slice('month:'.length).split('-').map(Number) : [null, null];
  return { key, kind, year, month, fromUtc: window.fromUtc, toUtc: window.toUtc, count };
}

/**
 * A tiny in-memory stand-in for the two History endpoints: the summary (only non-empty sections,
 * with their exact counts) and one section's page by window + offset cursor. Delete/restore
 * change it too, so a refresh sees what the server would.
 */
interface FakeSection {
  readonly section: ItemHistorySection;
  items: ItemHistoryEntry[];
}
let fake: FakeSection[] = [];
const deleted = new Map<number, string>();

function installFakeServer(entries: readonly { kind: ItemHistorySection['kind']; key: string; items: ItemHistoryEntry[] }[]) {
  fake = entries.map(entry => ({ section: makeSection(entry.kind, entry.key, entry.items.length), items: [...entry.items] }));
  deleted.clear();
  jest.mocked(getItemHistorySections).mockImplementation(async () =>
    fake.filter(entry => entry.items.length > 0).map(entry => ({ ...entry.section, count: entry.items.length })),
  );
  jest.mocked(getItemHistory).mockImplementation(async (_request, options: GetItemHistoryOptions = {}) => serveHistoryPage(options));
  jest.mocked(deleteItem).mockImplementation(async (_request, itemId) => {
    const owner = fake.find(entry => entry.items.some(item => item.id === itemId));
    if (owner) {
      deleted.set(itemId, owner.section.key);
      owner.items = owner.items.filter(item => item.id !== itemId);
    }
  });
}

function serveHistoryPage(options: GetItemHistoryOptions) {
  const entry = fake.find(candidate => candidate.section.fromUtc === options.fromUtc);
  const offset = options.cursor ? Number(options.cursor) : 0;
  const limit = options.limit ?? 50;
  const items = entry ? entry.items.slice(offset, offset + limit) : [];
  const nextCursor = entry && offset + limit < entry.items.length ? String(offset + limit) : null;
  return { items, nextCursor };
}

function itemsFor(prefix: number, count: number, title = 'Link'): ItemHistoryEntry[] {
  return Array.from({ length: count }, (_, index) => makeItem({ id: prefix + index, title: `${title} ${prefix + index}` }));
}

function sectionCalls(section: Pick<ItemHistorySection, 'fromUtc'>) {
  return jest.mocked(getItemHistory).mock.calls.filter(([, options]) => options?.fromUtc === section.fromUtc);
}

// Wrapped in the real AppToastProvider (not mocked) - Delete Undo shows via the global AppToast
// Host (see useAppToast), so these tests exercise the real Provider exactly as a real screen does.
async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <AppToastProvider>
        <DateHistoryScreen />
      </AppToastProvider>,
    );
  });
  return renderer;
}

function getList(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.findByType(FlatList);
}

function getRows(renderer: ReactTestRenderer.ReactTestRenderer): readonly HistoryRow[] {
  return getList(renderer).props.data;
}

function rowsOf(renderer: ReactTestRenderer.ReactTestRenderer, sectionKey: string, kind?: HistoryRow['kind']) {
  return getRows(renderer).filter(row => row.section.key === sectionKey && row.kind !== 'header' && (kind === undefined || row.kind === kind));
}

async function toggleSection(renderer: ReactTestRenderer.ReactTestRenderer, sectionKey: string) {
  const header = getRows(renderer).find(row => row.kind === 'header' && row.section.key === sectionKey)!;
  const element = getList(renderer).props.renderItem({ item: header, index: 0 });
  await act(async () => {
    element.props.onPress();
  });
}

/** Reports the given rows as on screen, as the FlatList would while the user scrolls. */
async function showRows(renderer: ReactTestRenderer.ReactTestRenderer, rows: readonly HistoryRow[]) {
  const viewableItems: ListViewToken[] = rows.map(row => ({ item: row, key: row.key, index: getRows(renderer).indexOf(row), isViewable: true }));
  await act(async () => {
    getList(renderer).props.onViewableItemsChanged({ viewableItems, changed: viewableItems });
  });
}

/** Renders one list row on its own - any row, mounted by the list or not. */
function renderRow(renderer: ReactTestRenderer.ReactTestRenderer, row: HistoryRow) {
  const element = getList(renderer).props.renderItem({ item: row, index: 0 });
  let rowRenderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    rowRenderer = ReactTestRenderer.create(element);
  });
  return rowRenderer;
}

function getItemRow(renderer: ReactTestRenderer.ReactTestRenderer, itemId: number) {
  const row = getRows(renderer).find(candidate => candidate.kind === 'item' && candidate.item.id === itemId)!;
  return renderRow(renderer, row);
}

function headerCount(renderer: ReactTestRenderer.ReactTestRenderer, sectionKey: string): number | undefined {
  const header = getRows(renderer).find(row => row.kind === 'header' && row.section.key === sectionKey);
  return header?.section.count;
}

/** Every section header's props (label, count, isExpanded) - from the list data, mounted or not. */
function headerProps(renderer: ReactTestRenderer.ReactTestRenderer) {
  return getRows(renderer)
    .filter(row => row.kind === 'header')
    .map(row => getList(renderer).props.renderItem({ item: row, index: 0 }).props as { label: string; count: number; isExpanded: boolean });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

// Minimal fake GestureResponderEvent - see SwipeableItemRow.test.tsx's identical constant for why
// this is enough for PanResponder's internal TouchHistoryMath calls to run without throwing.
const FAKE_RESPONDER_EVENT = {
  touchHistory: { touchBank: [], numberActiveTouches: 0, indexOfSingleActiveTouch: -1, mostRecentTimeStamp: 0 },
  nativeEvent: {},
};

/** The share/delete swipe actions are only mounted once a swipe is actually underway (see
 * SwipeableItemRow's own isRevealed remarks) - fires the same onResponderGrant a real gesture
 * would, so tests can reach those buttons without simulating full drag coordinates. */
function revealRow(row: ReactTestRenderer.ReactTestRenderer): void {
  const contentLayer = row.root.findAll(node => Array.isArray(node.props.accessibilityActions))[0];
  ReactTestRenderer.act(() => {
    contentLayer.props.onResponderGrant(FAKE_RESPONDER_EVENT);
  });
}

/** The screen's single ConfirmDialog (a Modal) - scoping queries to it avoids colliding with the list's own swipe-action buttons sharing the same accessibilityLabel ("삭제"). */
function getConfirmDialogButton(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  const dialog = renderer.root.findByType(Modal);
  return dialog.findAll(node => node.props.accessibilityLabel === label)[0];
}

async function deleteViaSwipe(renderer: ReactTestRenderer.ReactTestRenderer, itemId: number) {
  const row = getItemRow(renderer, itemId);
  revealRow(row);
  const deleteAction = row.root.findAll(node => node.props.accessibilityLabel === '삭제')[0];
  await act(async () => {
    deleteAction.props.onPress();
  });
  await act(async () => {
    getConfirmDialogButton(renderer, '삭제').props.onPress();
  });
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('DateHistoryScreen header', () => {
  it('puts 보관함 alone on its title row, then [시간순 | 이름순] at the start and the List/Grid/Image switch at the end of ONE controls row, then the search', async () => {
    installFakeServer([{ kind: 'today', key: '2026-09-30', items: itemsFor(1, 3) }]);
    const renderer = await renderScreen();

    expect(i18n.t('history.title')).toBe('보관함');
    const header = renderPart(getList(renderer).props.ListHeaderComponent);
    const title = header.root.findAll(node => node.props.children === '보관함' && typeof node.type === 'string')[0];
    const titleRow = header.root.findAll(node => node.findAll(inner => inner === title).length > 0 && StyleSheet.flatten(node.props.style)?.justifyContent === 'space-between')[0];
    expect(StyleSheet.flatten(titleRow.props.style).marginBottom).toBeGreaterThan(0);
    expect(StyleSheet.flatten(title.props.style).marginBottom).toBeUndefined();
    expect(titleRow.findAllByType(ViewModeToggle)).toHaveLength(0);

    const chips = header.root.findByType(LinkSortChips);
    const viewToggle = header.root.findByType(ViewModeToggle);
    const controls = viewToggle.parent!;
    expect(controls).toBe(chips.parent);
    expect(StyleSheet.flatten(controls.props.style)).toMatchObject({ flexDirection: 'row', alignItems: 'center' });
    const children = controls.children as ReactTestRenderer.ReactTestInstance[];
    expect(children[0]).toBe(chips);
    expect(children[children.length - 1]).toBe(viewToggle);
    expect(viewToggle.props.showImage).toBe(true);
    // Order: controls THEN search (the Collection's order too) - and no 날짜별 / 전체 anywhere.
    const everything = header.root.findAll(() => true);
    expect(everything.findIndex(node => node.type === LinkSortChips)).toBeLessThan(everything.findIndex(node => node.type === SearchField));
    expect(header.root.findAllByType(Text).some(node => ['날짜별', '전체'].includes(String(node.props.children)))).toBe(false);
  });
});

function renderPart(element: React.ReactElement) {
  let part!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    part = ReactTestRenderer.create(element);
  });
  return part;
}

describe('DateHistoryScreen loading', () => {
  it('opens with the section summary only, and loads just the expanded section\'s first page', async () => {
    installFakeServer([
      { kind: 'today', key: '2026-09-30', items: itemsFor(1, 3) },
      { kind: 'month', key: 'month:2026-08', items: itemsFor(1000, 470) },
    ]);
    const renderer = await renderScreen();

    expect(getItemHistorySections).toHaveBeenCalledTimes(1);
    // 오늘 is expanded by default and asks for one page of its own window; the collapsed month asks for nothing.
    expect(getItemHistory).toHaveBeenCalledTimes(1);
    expect(getItemHistory).toHaveBeenCalledWith(expect.anything(), { limit: HISTORY_SECTION_PAGE_SIZE, fromUtc: WINDOWS.today.fromUtc, toUtc: null });
    expect(rowsOf(renderer, 'month:2026-08')).toHaveLength(0);
    expect(rowsOf(renderer, '2026-09-30', 'item')).toHaveLength(3);
  });

  it('expanding a section fetches only that section\'s first page, bounded to its window', async () => {
    installFakeServer([
      { kind: 'today', key: '2026-09-30', items: itemsFor(1, 3) },
      { kind: 'month', key: 'month:2026-08', items: itemsFor(1000, 470) },
    ]);
    const renderer = await renderScreen();

    await toggleSection(renderer, 'month:2026-08');

    const monthWindow = WINDOWS['month:2026-08'];
    expect(sectionCalls(monthWindow)).toEqual([[expect.anything(), { limit: HISTORY_SECTION_PAGE_SIZE, fromUtc: monthWindow.fromUtc, toUtc: monthWindow.toUtc }]]);
    expect(rowsOf(renderer, 'month:2026-08', 'item')).toHaveLength(HISTORY_SECTION_PAGE_SIZE);
  });

  it('shows skeleton rows where the first page is about to appear, then replaces them with the links', async () => {
    installFakeServer([{ kind: 'today', key: '2026-09-30', items: itemsFor(1, 40) }]);
    const pending = deferred<ReturnType<typeof serveHistoryPage>>();
    jest.mocked(getItemHistory).mockImplementationOnce(() => pending.promise);
    const renderer = await renderScreen();

    expect(rowsOf(renderer, '2026-09-30', 'skeleton')).toHaveLength(FIRST_PAGE_SKELETON_ROWS);
    expect(rowsOf(renderer, '2026-09-30', 'item')).toHaveLength(0);
    expect(renderer.root.findAll(node => node.props.testID === 'history-skeleton' && typeof node.type === 'string').length).toBeGreaterThan(0);
    // The header already carries the real total.
    expect(renderer.root.findAllByType(DateSectionHeader)[0].props.count).toBe(40);

    await act(async () => {
      pending.resolve(serveHistoryPage({ limit: HISTORY_SECTION_PAGE_SIZE, fromUtc: WINDOWS.today.fromUtc }));
    });

    expect(rowsOf(renderer, '2026-09-30', 'item')).toHaveLength(HISTORY_SECTION_PAGE_SIZE);
    // More is left, but nothing is being requested yet - so no skeleton (and never a "more" button).
    expect(rowsOf(renderer, '2026-09-30', 'skeleton')).toHaveLength(0);
  });

  it('never shows more first-page skeletons than the section holds', async () => {
    installFakeServer([{ kind: 'today', key: '2026-09-30', items: itemsFor(1, 2) }]);
    jest.mocked(getItemHistory).mockImplementationOnce(() => new Promise(() => undefined));
    const renderer = await renderScreen();

    expect(rowsOf(renderer, '2026-09-30', 'skeleton')).toHaveLength(2);
  });

  it('loads the next page of a section once its end comes on screen - once, and never past its last page', async () => {
    installFakeServer([{ kind: 'today', key: '2026-09-30', items: itemsFor(1, 30) }]);
    const renderer = await renderScreen();
    expect(sectionCalls(WINDOWS.today)).toHaveLength(1);

    // Rows far from the loaded end do not ask for anything.
    await showRows(renderer, rowsOf(renderer, '2026-09-30', 'item').slice(0, 5));
    expect(sectionCalls(WINDOWS.today)).toHaveLength(1);

    const pending = deferred<ReturnType<typeof serveHistoryPage>>();
    jest.mocked(getItemHistory).mockImplementationOnce(() => pending.promise);
    const nearEnd = rowsOf(renderer, '2026-09-30').slice(-4);
    await showRows(renderer, nearEnd);
    // Skeletons below the loaded rows only while that page is actually on its way.
    expect(rowsOf(renderer, '2026-09-30', 'skeleton')).toHaveLength(NEXT_PAGE_SKELETON_ROWS);
    // The same rows reported again while that page is in flight - no second request.
    await showRows(renderer, nearEnd);
    expect(sectionCalls(WINDOWS.today)).toHaveLength(2);
    expect(sectionCalls(WINDOWS.today)[1][1]).toEqual({ limit: HISTORY_SECTION_PAGE_SIZE, cursor: '25', fromUtc: WINDOWS.today.fromUtc, toUtc: null });

    await act(async () => {
      pending.resolve(serveHistoryPage({ limit: HISTORY_SECTION_PAGE_SIZE, cursor: '25', fromUtc: WINDOWS.today.fromUtc }));
    });
    expect(rowsOf(renderer, '2026-09-30', 'item').map(row => (row.kind === 'item' ? row.item.id : 0))).toEqual(itemsFor(1, 30).map(item => item.id));
    expect(rowsOf(renderer, '2026-09-30', 'skeleton')).toHaveLength(0);

    // The last page is in - scrolling to the end asks for nothing more.
    await showRows(renderer, rowsOf(renderer, '2026-09-30').slice(-3));
    expect(sectionCalls(WINDOWS.today)).toHaveLength(2);
  });

  it('only the section whose end is on screen pages - a neighbouring open section does not', async () => {
    installFakeServer([
      { kind: 'today', key: '2026-09-30', items: itemsFor(1, 60) },
      { kind: 'yesterday', key: '2026-09-29', items: itemsFor(500, 60) },
    ]);
    const renderer = await renderScreen();
    await toggleSection(renderer, '2026-09-29');

    await showRows(renderer, rowsOf(renderer, '2026-09-29').slice(-2));

    expect(sectionCalls(WINDOWS.today)).toHaveLength(1);
    expect(sectionCalls(WINDOWS.yesterday)).toHaveLength(2);
  });

  it('shows a retry row when a section fails to load, and retrying loads it', async () => {
    installFakeServer([{ kind: 'today', key: '2026-09-30', items: itemsFor(1, 5) }]);
    jest.mocked(getItemHistory).mockRejectedValueOnce(new Error('offline'));
    const renderer = await renderScreen();

    expect(rowsOf(renderer, '2026-09-30', 'error')).toHaveLength(1);
    const retry = renderer.root.findAll(node => node.props.testID === 'history-section-retry-2026-09-30' && typeof node.props.onPress === 'function')[0];
    expect(retry.findByProps({ children: i18n.t('importantState.retry') })).toBeTruthy();

    await act(async () => {
      retry.props.onPress();
    });

    expect(rowsOf(renderer, '2026-09-30', 'error')).toHaveLength(0);
    expect(rowsOf(renderer, '2026-09-30', 'item')).toHaveLength(5);
  });

  it('shows the empty state (and requests no links) when there is no history', async () => {
    installFakeServer([]);
    const renderer = await renderScreen();

    expect(getRows(renderer)).toHaveLength(0);
    expect(renderer.root.findByType(CenteredEmptyState).props.message).toBe(i18n.t('history.empty'));
    expect(getItemHistory).not.toHaveBeenCalled();
  });
});

describe('DateHistoryScreen accordion', () => {
  it('expands 오늘 by default (the newest section when there is none) and keeps every header count the server total', async () => {
    installFakeServer([
      { kind: 'yesterday', key: '2026-09-29', items: itemsFor(1, 31) },
      { kind: 'month', key: 'month:2026-08', items: itemsFor(1000, 470) },
    ]);
    const renderer = await renderScreen();

    expect(headerProps(renderer).map(header => [header.label, header.count, header.isExpanded])).toEqual([
      [i18n.t('history.yesterday'), 31, true],
      [expect.any(String), 470, false],
    ]);
    // 25 of 31 loaded - the count is still 31.
    expect(rowsOf(renderer, '2026-09-29', 'item')).toHaveLength(HISTORY_SECTION_PAGE_SIZE);
  });

  it('collapsing a section unmounts its rows; reopening shows the cached rows without fetching again', async () => {
    installFakeServer([{ kind: 'today', key: '2026-09-30', items: itemsFor(1, 30) }]);
    const renderer = await renderScreen();
    await showRows(renderer, rowsOf(renderer, '2026-09-30').slice(-2));
    expect(rowsOf(renderer, '2026-09-30', 'item')).toHaveLength(30);

    await toggleSection(renderer, '2026-09-30');
    expect(rowsOf(renderer, '2026-09-30')).toHaveLength(0);
    expect(renderer.root.findAllByType(SavedLinkRow)).toHaveLength(0);

    await toggleSection(renderer, '2026-09-30');
    expect(rowsOf(renderer, '2026-09-30', 'item')).toHaveLength(30);
    expect(sectionCalls(WINDOWS.today)).toHaveLength(2);
  });

  it('keeps each section open or closed across a refresh, reloading an open section in place', async () => {
    installFakeServer([
      { kind: 'today', key: '2026-09-30', items: itemsFor(1, 3) },
      { kind: 'yesterday', key: '2026-09-29', items: itemsFor(500, 40) },
      { kind: 'month', key: 'month:2026-08', items: itemsFor(1000, 10) },
    ]);
    const renderer = await renderScreen();
    await toggleSection(renderer, '2026-09-30');
    await toggleSection(renderer, '2026-09-29');
    await showRows(renderer, rowsOf(renderer, '2026-09-29').slice(-2));
    expect(rowsOf(renderer, '2026-09-29', 'item')).toHaveLength(40);
    jest.mocked(getItemHistory).mockClear();

    await act(async () => {
      getList(renderer).props.refreshControl.props.onRefresh();
    });

    expect(headerProps(renderer).map(header => header.isExpanded)).toEqual([false, true, false]);
    // The open section reloads as many rows as it showed, in one request; the closed ones load nothing.
    expect(getItemHistory).toHaveBeenCalledTimes(1);
    expect(sectionCalls(WINDOWS.yesterday)[0][1]).toEqual(expect.objectContaining({ limit: 40 }));
    expect(rowsOf(renderer, '2026-09-29', 'item')).toHaveLength(40);
  });
});

describe('DateHistoryScreen large history (1,200 links)', () => {
  function installLargeHistory() {
    installFakeServer([
      { kind: 'today', key: '2026-09-30', items: itemsFor(1, 12) },
      { kind: 'yesterday', key: '2026-09-29', items: itemsFor(100, 31) },
      { kind: 'thisWeek', key: 'thisWeek', items: itemsFor(200, 84) },
      { kind: 'month', key: 'month:2026-09', items: itemsFor(1000, 153) },
      { kind: 'month', key: 'month:2026-08', items: itemsFor(2000, 470) },
      { kind: 'month', key: 'month:2026-07', items: itemsFor(3000, 450) },
    ]);
  }

  it('shows every section with its exact total while loading one page per opened section', async () => {
    installLargeHistory();
    const renderer = await renderScreen();

    expect(headerProps(renderer).map(header => header.count)).toEqual([12, 31, 84, 153, 470, 450]);
    // Only the rows near the viewport are mounted - the headers further down are not, yet.
    expect(renderer.root.findAllByType(DateSectionHeader).length).toBeLessThan(6);
    expect(getItemHistory).toHaveBeenCalledTimes(1);

    for (const key of ['2026-09-29', 'thisWeek', 'month:2026-09', 'month:2026-08', 'month:2026-07']) {
      await toggleSection(renderer, key);
    }

    // One request per opened section (never one per link), each for one page.
    expect(getItemHistory).toHaveBeenCalledTimes(6);
    expect(jest.mocked(getItemHistory).mock.calls.every(([, options]) => options?.limit === HISTORY_SECTION_PAGE_SIZE && !options.cursor)).toBe(true);
    const itemRows = getRows(renderer).filter(row => row.kind === 'item');
    expect(itemRows).toHaveLength(12 + 25 * 5);
    // The list itself only mounts what is near the viewport - nowhere near every loaded row.
    expect(renderer.root.findAllByType(SavedLinkRow).length).toBeLessThanOrEqual(getList(renderer).props.initialNumToRender);
  });

  it('pages through a 470-link month without gaps or duplicates', async () => {
    installLargeHistory();
    const renderer = await renderScreen();
    await toggleSection(renderer, 'month:2026-08');

    for (let guard = 0; guard < 30 && rowsOf(renderer, 'month:2026-08', 'item').length < 470; guard++) {
      await showRows(renderer, rowsOf(renderer, 'month:2026-08').slice(-2));
    }

    const ids = rowsOf(renderer, 'month:2026-08', 'item').map(row => (row.kind === 'item' ? row.item.id : 0));
    expect(ids).toEqual(itemsFor(2000, 470).map(item => item.id));
    expect(sectionCalls(WINDOWS['month:2026-08'])).toHaveLength(Math.ceil(470 / HISTORY_SECTION_PAGE_SIZE));
    expect(headerCount(renderer, 'month:2026-08')).toBe(470);
  });
});

describe('DateHistoryScreen grid', () => {
  async function switchToGrid(renderer: ReactTestRenderer.ReactTestRenderer) {
    const gridToggle = renderer.root.findAll(node => node.props.accessibilityLabel === 'Grid view' && typeof node.props.onPress === 'function')[0];
    await act(async () => {
      gridToggle.props.onPress();
    });
  }

  it('lays an expanded section out as virtualized rows of two shared SavedLinkGridCells, one card per date', async () => {
    installFakeServer([
      { kind: 'today', key: '2026-09-30', items: [makeItem({ id: 1, title: 'Hi' }), makeItem({ id: 3, title: 'A much longer title that wraps onto a second line in a grid card' }), makeItem({ id: 4 })] },
      { kind: 'yesterday', key: '2026-09-29', items: [makeItem({ id: 2 })] },
    ]);
    const renderer = await renderScreen();
    await switchToGrid(renderer);

    const gridRows = rowsOf(renderer, '2026-09-30', 'gridRow');
    expect(gridRows.map(row => (row.kind === 'gridRow' ? row.items.map(item => item.id) : []))).toEqual([[1, 3], [4]]);
    expect(rowsOf(renderer, '2026-09-29')).toHaveLength(0);

    const cells = renderer.root.findAllByType(SavedLinkGridCell);
    expect(cells.map(cell => cell.props.item.id)).toEqual([1, 3, 4]);
    expect(Object.keys(cells[0].props).sort()).toEqual(Object.keys(cells[1].props).sort());
    expect(cells.every(cell => cell.props.preferEffectiveThumbnail === true)).toBe(true);
    // 오늘 is a one-day section -> time only, the same rule as its list rows.
    expect(cells.every(cell => cell.props.dateDisplayMode === 'time')).toBe(true);

    // The first line opens the body under the header, the last closes the card.
    const first = StyleSheet.flatten(renderer.root.find(node => node.props.testID === 'history-grid-row-2026-09-30-0' && typeof node.type === 'string').props.style);
    const last = StyleSheet.flatten(renderer.root.find(node => node.props.testID === 'history-grid-row-2026-09-30-2' && typeof node.type === 'string').props.style);
    expect(first).toEqual(expect.objectContaining({ borderLeftWidth: 1, borderRightWidth: 1, borderTopWidth: 1 }));
    expect(first.borderBottomWidth).toBeUndefined();
    expect(last).toEqual(expect.objectContaining({ borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1 }));
    expect(last.borderBottomLeftRadius).toBeGreaterThan(0);
    expect(last.paddingHorizontal).toBeGreaterThan(0);
  });

  describe('on a wider window (responsive Grid)', () => {
    // Inside act: a window change reaches every renderer a file left mounted, and those updates must not run outside act.
    const setWindow = (width: number, height: number) => act(() => { Dimensions.set({ window: { ...Dimensions.get('window'), width, height } }); });
    const PHONE_PORTRAIT = [411, 1334] as const;
    afterEach(() => setWindow(...PHONE_PORTRAIT));

    const gridRowIds = (renderer: ReactTestRenderer.ReactTestRenderer) =>
      rowsOf(renderer, '2026-09-30', 'gridRow').map(row => (row.kind === 'gridRow' ? row.items.map(item => item.id) : []));

    it.each([
      ['phone portrait', 411, 891, 2, [[1, 2], [3, 4], [5]]],
      ['phone LANDSCAPE keeps the phone layout', 891, 411, 2, [[1, 2], [3, 4], [5]]],
      ['7in tablet portrait', 600, 960, 3, [[1, 2, 3], [4, 5]]],
      ['10in tablet portrait', 800, 1280, 4, [[1, 2, 3, 4], [5]]],
      ['10in tablet landscape', 1280, 800, 6, [[1, 2, 3, 4, 5]]],
    ])('%s (%p x %p dp): a section tiles are laid out in rows of the matching column count', async (_name, width, height, columns, expected) => {
      installFakeServer([{ kind: 'today', key: '2026-09-30', items: itemsFor(1, 5) }]);
      setWindow(width, height);
      const renderer = await renderScreen();
      await switchToGrid(renderer);

      expect(gridRowIds(renderer)).toEqual(expected);
      const basis = `${100 / columns}%`;
      const cell = renderer.root.findAllByType(SavedLinkGridCell)[0];
      const frame = StyleSheet.flatten(cell.findAll(node => typeof node.type === 'string')[0].props.style);
      expect(frame).toEqual(expect.objectContaining({ flexBasis: basis, maxWidth: basis }));
    });

    it('re-lays the rows out when the window is rotated, without losing the links or the Grid mode', async () => {
      installFakeServer([{ kind: 'today', key: '2026-09-30', items: itemsFor(1, 5) }]);
      const renderer = await renderScreen();
      await switchToGrid(renderer);
      expect(gridRowIds(renderer)).toEqual([[1, 2], [3, 4], [5]]);

      await act(async () => {
        setWindow(1280, 800);
      });
      expect(gridRowIds(renderer)).toEqual([[1, 2, 3, 4, 5]]);
      expect(renderer.root.findAllByType(SavedLinkGridCell).map(cell => cell.props.item.id)).toEqual([1, 2, 3, 4, 5]);

      await act(async () => {
        setWindow(...PHONE_PORTRAIT);
      });
      expect(gridRowIds(renderer)).toEqual([[1, 2], [3, 4], [5]]);
    });
  });

  it('shows grid skeleton lines while a section\'s first page loads', async () => {
    installFakeServer([
      { kind: 'today', key: '2026-09-30', items: itemsFor(1, 5) },
      { kind: 'yesterday', key: '2026-09-29', items: itemsFor(100, 9) },
    ]);
    const renderer = await renderScreen();
    await switchToGrid(renderer);
    jest.mocked(getItemHistory).mockImplementationOnce(() => new Promise(() => undefined));
    await toggleSection(renderer, '2026-09-29');

    const skeletons = rowsOf(renderer, '2026-09-29', 'skeleton');
    expect(skeletons).toHaveLength(Math.ceil(FIRST_PAGE_SKELETON_ROWS / 2));
    expect(skeletons.every(row => row.kind === 'skeleton' && row.grid)).toBe(true);
  });
});

describe('DateHistoryScreen swipe actions', () => {
  // The same long-press menu Home has (useSavedLinkActions): 링크 열기 / 수정 / 컬렉션 변경 / 삭제 last.
  it('long-pressing a link opens the shared link menu - 삭제 last and destructive - and a locked card has none', async () => {
    installFakeServer([{ kind: 'today', key: '2026-09-30', items: [makeItem({ id: 40, title: 'Menu link' }), makeItem({ id: 41, title: null, url: '', isCollectionLocked: true })] }]);
    const renderer = await renderScreen();

    const row = getItemRow(renderer, 40).root.findAllByType(SwipeableItemRow)[0];
    await act(async () => row.props.onLongPress());

    const menu = renderer.root.findAllByType(ActionMenuDialog)[0];
    expect((menu.props.actions as { label: string }[]).map(action => action.label)).toEqual(['링크 열기', '수정', '컬렉션 변경', '삭제']);
    expect((menu.props.actions as { destructive?: boolean }[]).at(-1)!.destructive).toBe(true);

    const locked = getItemRow(renderer, 41).root.findAllByType(SwipeableItemRow)[0];
    expect(locked.props.onLongPress).toBeUndefined();
  });

  // Regression test: SwipeableItemRow's contentPressable used to force flexDirection: 'row' on
  // itself, which stopped the wrapped row content (title/URL/time) from stretching to full width.
  it('renders the row content (title) through the SwipeableItemRow wrapper', async () => {
    installFakeServer([{ kind: 'today', key: '2026-09-30', items: [makeItem({ id: 25, title: 'Visible title' })] }]);
    const renderer = await renderScreen();

    expect(getItemRow(renderer, 25).root.findByProps({ children: 'Visible title' })).toBeTruthy();
  });

  // Home and History both render saved links through the same SavedLinkRow, so History must get
  // exactly the same domain fallback for title-less items as Home does.
  it('shows a domain fallback (not the raw URL) as the primary text for items without a title', async () => {
    installFakeServer([{ kind: 'today', key: '2026-09-30', items: [makeItem({ id: 26, title: null, url: 'https://www.youtube.com/watch?v=abc' })] }]);
    const renderer = await renderScreen();

    expect(getItemRow(renderer, 26).root.findByProps({ children: 'youtube.com' })).toBeTruthy();
  });

  // A cover set via ItemDetails' drag reorder must be reflected here too, not just on Home.
  it('prefers the cover image over the first-uploaded representativeImage, matching Home', async () => {
    installFakeServer([{
      kind: 'today',
      key: '2026-09-30',
      items: [makeItem({
        id: 27,
        representativeImage: { id: 1, readUrl: 'https://blob.example/first-uploaded.jpg' },
        coverImage: { id: 2, readUrl: 'https://blob.example/cover.jpg' },
      })],
    }]);
    const renderer = await renderScreen();

    const images = getItemRow(renderer, 27).root.findAllByType(require('react-native').Image);
    expect(images.some(node => node.props.source?.uri === 'https://blob.example/cover.jpg')).toBe(true);
    expect(images.some(node => node.props.source?.uri === 'https://blob.example/first-uploaded.jpg')).toBe(false);
  });

  it('shows the full date in multi-day sections and the time only in 오늘/어제', async () => {
    installFakeServer([
      { kind: 'today', key: '2026-09-30', items: [makeItem({ id: 1 })] },
      { kind: 'month', key: 'month:2026-08', items: [makeItem({ id: 2 })] },
    ]);
    const renderer = await renderScreen();
    await toggleSection(renderer, 'month:2026-08');

    const rows = renderer.root.findAllByType(SavedLinkRow);
    expect(rows.map(row => [row.props.item.id, row.props.dateDisplayMode])).toEqual([[1, 'time'], [2, 'dateTime']]);
  });

  it('shares the item via the swipe share action', async () => {
    const item = makeItem({ id: 21, title: 'Shareable' });
    installFakeServer([{ kind: 'today', key: '2026-09-30', items: [item] }]);
    jest.mocked(shareItem).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    const row = getItemRow(renderer, 21);
    revealRow(row);
    const shareAction = row.root.findAll(node => node.props.accessibilityLabel === '공유')[0];
    await act(async () => {
      shareAction.props.onPress();
    });

    expect(shareItem).toHaveBeenCalledWith(item.url, item.title);
  });

  it('deletes only after the ConfirmDialog is accepted; the count drops and an emptied section goes', async () => {
    installFakeServer([
      { kind: 'today', key: '2026-09-30', items: [makeItem({ id: 31 })] },
      { kind: 'yesterday', key: '2026-09-29', items: itemsFor(500, 3) },
    ]);
    const renderer = await renderScreen();
    await toggleSection(renderer, '2026-09-29');

    const row = getItemRow(renderer, 500);
    revealRow(row);
    await act(async () => {
      row.root.findAll(node => node.props.accessibilityLabel === '삭제')[0].props.onPress();
    });
    expect(deleteItem).not.toHaveBeenCalled();
    await act(async () => {
      getConfirmDialogButton(renderer, '삭제').props.onPress();
    });

    expect(deleteItem).toHaveBeenCalledWith(expect.anything(), 500);
    expect(headerCount(renderer, '2026-09-29')).toBe(2);
    expect(rowsOf(renderer, '2026-09-29', 'item')).toHaveLength(2);

    // Deleting the only link of 오늘 removes the whole section, header included.
    await deleteViaSwipe(renderer, 31);
    expect(headerCount(renderer, '2026-09-30')).toBeUndefined();
    expect(getRows(renderer).some(candidate => candidate.section.key === '2026-09-30')).toBe(false);
    // No summary refetch was needed for either.
    expect(getItemHistorySections).toHaveBeenCalledTimes(1);
  });

  it('does not delete when the ConfirmDialog is cancelled', async () => {
    installFakeServer([{ kind: 'today', key: '2026-09-30', items: [makeItem({ id: 41, title: 'Kept' })] }]);
    const renderer = await renderScreen();

    const row = getItemRow(renderer, 41);
    revealRow(row);
    await act(async () => {
      row.root.findAll(node => node.props.accessibilityLabel === '삭제')[0].props.onPress();
    });
    await act(async () => {
      getConfirmDialogButton(renderer, '취소').props.onPress();
    });

    expect(deleteItem).not.toHaveBeenCalled();
    expect(headerCount(renderer, '2026-09-30')).toBe(1);
  });
});

describe('DateHistoryScreen delete undo', () => {
  function restoreIntoFake() {
    jest.mocked(restoreItem).mockImplementation(async (_request, itemId) => {
      const owner = fake.find(entry => entry.section.key === deleted.get(itemId));
      owner?.items.unshift(makeItem({ id: itemId, title: 'Restorable' }));
    });
  }

  it('shows the undo toast after a successful delete', async () => {
    installFakeServer([{ kind: 'today', key: '2026-09-30', items: [makeItem({ id: 51, title: 'Removable' })] }]);
    const renderer = await renderScreen();

    await deleteViaSwipe(renderer, 51);

    expect(renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') })).toBeTruthy();
    // AppToastHost renders above NavigationContainer (root coordinate space), so the toast's
    // bottomOffset must be the actual tab bar height (mocked to 80 above), not 0.
    expect(renderer.root.findByType(UndoToast).props.bottomOffset).toBe(80);
  });

  it('restores the row (via refresh, back in the section it was saved under) after undo succeeds', async () => {
    installFakeServer([{ kind: 'today', key: '2026-09-30', items: [makeItem({ id: 52, title: 'Restorable' }), makeItem({ id: 53 })] }]);
    restoreIntoFake();
    const renderer = await renderScreen();

    await deleteViaSwipe(renderer, 52);
    expect(headerCount(renderer, '2026-09-30')).toBe(1);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress();
      await Promise.resolve();
    });

    expect(restoreItem).toHaveBeenCalledWith(expect.anything(), 52);
    expect(headerCount(renderer, '2026-09-30')).toBe(2);
    expect(rowsOf(renderer, '2026-09-30', 'item').map(row => (row.kind === 'item' ? row.item.id : 0))).toEqual([52, 53]);
    expect(renderer.root.findAllByProps({ accessibilityLabel: i18n.t('toast.undoAction') })).toHaveLength(0);
  });

  it('keeps the deleted state and shows the shared notice dialog when undo fails', async () => {
    installFakeServer([{ kind: 'today', key: '2026-09-30', items: [makeItem({ id: 54, title: 'Stuck deleted' })] }]);
    jest.mocked(restoreItem).mockRejectedValue(new Error('no'));
    const renderer = await renderScreen();

    await deleteViaSwipe(renderer, 54);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress();
      await Promise.resolve();
    });

    expect(getRows(renderer)).toHaveLength(0);
    expect(renderer.root.findByProps({ children: i18n.t('toast.undoDeleteError') })).toBeTruthy();
  });

  it('does not send a second restore request while the first undo is still pending', async () => {
    installFakeServer([{ kind: 'today', key: '2026-09-30', items: [makeItem({ id: 55, title: 'Double tap' })] }]);
    const pending = deferred<void>();
    jest.mocked(restoreItem).mockImplementation(() => pending.promise);
    const renderer = await renderScreen();

    await deleteViaSwipe(renderer, 55);

    const undo = renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress;
    await act(async () => {
      undo();
      undo();
    });
    expect(restoreItem).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve();
      await Promise.resolve();
    });
  });
});

describe('buildHistoryRows', () => {
  const today = makeSection('today', '2026-09-30', 40);
  const month = makeSection('month', 'month:2026-08', 470);
  const loadedPage = (items: readonly ItemHistoryEntry[], nextCursor: string | null, overrides: Partial<HistorySectionPage> = {}): HistorySectionPage => ({
    items,
    nextCursor,
    isLoading: false,
    isLoadingMore: false,
    error: null,
    ...overrides,
  });

  it('lists only headers for collapsed sections, whatever they have loaded', () => {
    const rows = buildHistoryRows([today, month], new Map([['month:2026-08', loadedPage(itemsFor(1, 25), '25')]]), new Set(), 'list');
    expect(rows.map(row => row.key)).toEqual(['h:2026-09-30', 'h:month:2026-08']);
  });

  it('marks only the last body row of a section as closing its card', () => {
    const rows = buildHistoryRows([today], new Map([['2026-09-30', loadedPage(itemsFor(1, 3), null)]]), new Set(['2026-09-30']), 'list');
    expect(rows.map(row => (row.kind === 'item' ? row.isLast : null))).toEqual([null, false, false, true]);
  });

  it('adds next-page skeletons only while that page is loading - not merely because more exist, nor after an error', () => {
    const idle = buildHistoryRows([today], new Map([['2026-09-30', loadedPage(itemsFor(1, 25), '25')]]), new Set(['2026-09-30']), 'list');
    expect(idle.filter(row => row.kind === 'skeleton')).toHaveLength(0);

    const loading = buildHistoryRows([today], new Map([['2026-09-30', loadedPage(itemsFor(1, 25), '25', { isLoadingMore: true })]]), new Set(['2026-09-30']), 'list');
    expect(loading.filter(row => row.kind === 'skeleton')).toHaveLength(NEXT_PAGE_SKELETON_ROWS);
    expect(loading[loading.length - 1]).toEqual(expect.objectContaining({ kind: 'skeleton', isLast: true }));

    const gridLoading = buildHistoryRows([today], new Map([['2026-09-30', loadedPage(itemsFor(1, 25), '25', { isLoadingMore: true })]]), new Set(['2026-09-30']), 'grid');
    expect(gridLoading.filter(row => row.kind === 'skeleton')).toHaveLength(Math.ceil(NEXT_PAGE_SKELETON_ROWS / 2));

    const failed = buildHistoryRows([today], new Map([['2026-09-30', loadedPage(itemsFor(1, 25), '25', { error: 'offline' })]]), new Set(['2026-09-30']), 'list');
    expect(failed.filter(row => row.kind === 'skeleton')).toHaveLength(0);
    expect(failed[failed.length - 1].kind).toBe('error');
  });
});

describe('DateHistoryScreen - search the whole archive', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockNavigate.mockClear();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  /** The server's own search stand-in: matches (title or url) over EVERYTHING, newest first - not only what the screen loaded. */
  function installSearch(all: readonly ItemHistoryEntry[]) {
    installFakeServer([{ kind: 'today', key: '2026-09-30', items: itemsFor(1, 3) }]);
    const normal = jest.mocked(getItemHistory).getMockImplementation()!;
    jest.mocked(getItemHistory).mockImplementation(async (request, options: GetItemHistoryOptions = {}) => {
      if (options.q === undefined) {
        return normal(request, options);
      }
      const term = options.q.toLowerCase();
      const hits = all.filter(item => `${item.title ?? ''} ${item.url}`.toLowerCase().includes(term));
      const offset = options.cursor ? Number(options.cursor) : 0;
      const limit = options.limit ?? 50;
      return { items: hits.slice(offset, offset + limit), nextCursor: offset + limit < hits.length ? String(offset + limit) : null };
    });
  }

  async function typeSearch(renderer: ReactTestRenderer.ReactTestRenderer, text: string) {
    // The header element holds the controlled field; its onChangeText is the screen's own setter.
    const onChangeText = renderPart(getList(renderer).props.ListHeaderComponent).root.findByType(SearchField).props.onChangeText;
    await act(async () => {
      onChangeText(text);
    });
  }
  const searchRowsOf = (renderer: ReactTestRenderer.ReactTestRenderer) => getList(renderer).props.data as { kind: string; item?: ItemHistoryEntry; items?: ItemHistoryEntry[]; status?: string }[];
  const flush = async (ms = ARCHIVE_SEARCH_DEBOUNCE_MS + 10) => {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
  };
  const searchCalls = () => jest.mocked(getItemHistory).mock.calls.filter(([, options]) => options?.q !== undefined);

  it('shows the search field under the title row, and the normal accordion while the text is empty or too short', async () => {
    installSearch(itemsFor(100, 5));
    const renderer = await renderScreen();

    expect(renderPart(getList(renderer).props.ListHeaderComponent).root.findAllByType(TextInput)).toHaveLength(1);
    expect(getRows(renderer).some(row => row.kind === 'header')).toBe(true);
    await typeSearch(renderer, 'a');
    await flush();
    expect(searchCalls()).toHaveLength(0);
    expect(getRows(renderer).some(row => row.kind === 'header')).toBe(true);
  });

  it('shows the 2-character helper only while exactly 1 character is typed - no request, hidden again at 2+ and when cleared', async () => {
    installSearch(itemsFor(100, 5));
    const renderer = await renderScreen();
    const hint = () => renderPart(getList(renderer).props.ListHeaderComponent).root.findAll(node => node.props.testID === 'history-search-hint' && typeof node.type === 'string');

    expect(hint()).toHaveLength(0);
    await typeSearch(renderer, 'a');
    await flush();
    expect(hint()).toHaveLength(1);
    expect(hint()[0].props.children).toBe(i18n.t('history.searchMinHint'));
    expect(searchCalls()).toHaveLength(0);
    expect(getRows(renderer).some(row => row.kind === 'header')).toBe(true);

    await typeSearch(renderer, 'li');
    expect(hint()).toHaveLength(0);
    await flush();
    expect(searchCalls()).toHaveLength(1);

    await typeSearch(renderer, '');
    expect(hint()).toHaveLength(0);
    expect(getRows(renderer).some(row => row.kind === 'header')).toBe(true);
  });

  it('debounces: typing quickly sends ONE request for the final text, trimmed', async () => {
    installSearch(itemsFor(100, 5));
    const renderer = await renderScreen();

    await typeSearch(renderer, 'li');
    await flush(100);
    await typeSearch(renderer, 'lin');
    await flush(100);
    await typeSearch(renderer, '  link 10  ');
    expect(searchCalls()).toHaveLength(0);
    await flush();

    expect(searchCalls()).toHaveLength(1);
    expect(searchCalls()[0][1]).toEqual({ limit: 30, q: 'link 10' });
  });

  it('searches the WHOLE archive (links never loaded by the accordion), as a flat newest-first result list', async () => {
    const all = [...itemsFor(1, 3), ...itemsFor(500, 4, 'Quokka')];
    installSearch(all);
    const renderer = await renderScreen();

    await typeSearch(renderer, 'quokka');
    await flush();

    // One flat list in the server's order (no date labels).
    const rows = searchRowsOf(renderer);
    expect(rows.map(row => row.kind)).toEqual(['flatItem', 'flatItem', 'flatItem', 'flatItem']);
    expect(rows.filter(row => row.item).map(row => row.item!.id)).toEqual([500, 501, 502, 503]);
    expect(getRows(renderer).some(row => row.kind === 'header')).toBe(false);
  });

  it('Grid shows the same results as lines of two tiles; switching List/Grid keeps the search', async () => {
    installSearch(itemsFor(500, 3, 'Quokka'));
    const renderer = await renderScreen();
    await typeSearch(renderer, 'quokka');
    await flush();
    expect(searchRowsOf(renderer).map(row => row.kind)).toEqual(['flatItem', 'flatItem', 'flatItem']);

    const onChange = renderPart(getList(renderer).props.ListHeaderComponent).root.findByType(ViewModeToggle).props.onChange;
    await act(async () => {
      onChange('grid');
    });
    const gridRows = searchRowsOf(renderer);
    expect(gridRows.map(row => row.kind)).toEqual(['flatGridRow', 'flatGridRow']);
    expect(gridRows.filter(row => row.items).map(row => row.items!.length)).toEqual([2, 1]);
    expect(searchCalls()).toHaveLength(1);
  });

  it('a slow answer for an older text never overwrites the newer one', async () => {
    installSearch(itemsFor(500, 3, 'Quokka'));
    const first = deferred<ReturnType<typeof serveHistoryPage>>();
    const original = jest.mocked(getItemHistory).getMockImplementation()!;
    jest.mocked(getItemHistory).mockImplementation(async (request, options: GetItemHistoryOptions = {}) =>
      options.q === 'quo' ? first.promise : original(request, options));
    const renderer = await renderScreen();

    await typeSearch(renderer, 'quo');
    await flush();
    await typeSearch(renderer, 'quokka');
    await flush();
    expect(searchRowsOf(renderer).map(row => row.kind)).toEqual(['flatItem', 'flatItem', 'flatItem']);

    await act(async () => {
      first.resolve({ items: [makeItem({ id: 999, title: 'Stale quo' })], nextCursor: null });
    });
    expect(searchRowsOf(renderer).filter(row => row.item).map(row => row.item?.id)).toEqual([500, 501, 502]);
  });

  it('shows a status while loading, when nothing matches, and when the search fails', async () => {
    installSearch(itemsFor(500, 2, 'Quokka'));
    const renderer = await renderScreen();

    await typeSearch(renderer, 'zzzz');
    expect(searchRowsOf(renderer).map(row => row.status)).toEqual(['loading']);
    await flush();
    expect(searchRowsOf(renderer).map(row => row.status)).toEqual(['empty']);

    const original = jest.mocked(getItemHistory).getMockImplementation()!;
    jest.mocked(getItemHistory).mockImplementation(async (request, options: GetItemHistoryOptions = {}) => {
      if (options.q === 'boom') {
        throw new Error('offline');
      }
      return original(request, options);
    });
    await typeSearch(renderer, 'boom');
    await flush();
    expect(searchRowsOf(renderer).map(row => row.status)).toEqual(['error']);
  });

  it('clearing the text returns to the normal accordion at once, and a result opens its details', async () => {
    installSearch(itemsFor(500, 2, 'Quokka'));
    const renderer = await renderScreen();
    await typeSearch(renderer, 'quokka');
    await flush();

    const tappedRow = searchRowsOf(renderer).find(row => row.kind === 'flatItem')!;
    const tapped = tappedRow.item!;
    const element = getList(renderer).props.renderItem({ item: tappedRow, index: 0 });
    await act(async () => {
      element.props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('ItemDetails', { itemId: tapped.id });

    await typeSearch(renderer, '');
    expect(getRows(renderer).some(row => row.kind === 'header')).toBe(true);
  });

  it('opens on all records without a date control', async () => {
    installFakeServer([{ kind: 'today', key: '2026-09-30', items: itemsFor(1, 3) }]);
    const renderer = await renderScreen();
    expect(getRows(renderer).some(row => row.kind === 'header')).toBe(true);
    expect(renderPart(getList(renderer).props.ListHeaderComponent).root.findAll(node => String(node.props.testID ?? '').startsWith('history-date-filter'))).toHaveLength(0);
  });
});

describe('DateHistoryScreen load failure placement', () => {
  it('a failed load sits below search with the standard wording', async () => {
    installFakeServer([]);
    jest.mocked(getItemHistorySections).mockRejectedValue(new Error('offline'));
    const renderer = await renderScreen();

    const header = renderPart(getList(renderer).props.ListHeaderComponent);
    const order = header.root
      .findAll(node => typeof node.type === 'string' && ['history-search', 'history-sections-error'].includes(node.props.testID))
      .map(node => node.props.testID as string)
      .filter((id, index, all) => all.indexOf(id) === index);
    expect(order).toEqual(['history-search', 'history-sections-error']);

    const texts = header.root.findAll(node => node.props.testID === 'history-sections-error' && typeof node.type === 'string')[0]
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children as string);
    expect(texts).toEqual(expect.arrayContaining([i18n.t('importantState.loadFailedTitle'), i18n.t('importantState.loadFailedMessage'), i18n.t('importantState.retry')]));
    const failure = header.root.findAll(node => node.props.testID === 'history-sections-error')[0];
    expect(failure.findAllByType(BrokenLinkIcon)).toHaveLength(1);
    expect(failure.findAllByType(InfoIcon)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 시간순 / 이름순 x List / Grid / Image. 시간순 is the date accordion (오늘 / 어제 / 이번 주 / months); 이름순 is the WHOLE
// archive A-Z as ONE flat list from the server (an order no client could produce over only the loaded pages).
// ---------------------------------------------------------------------------------------------------------------
const mockSortStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockSortStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockSortStore.set(key, value);
  }),
}));
// Preferences (view mode, sort) must not leak from one test into the next.
beforeEach(() => {
  mockSortStore.clear();
  jest.mocked(AsyncStorage.getItem).mockImplementation(async (key: string) => mockSortStore.get(key) ?? null);
});

describe('DateHistoryScreen - 시간순 / 이름순', () => {
  type Row = { kind: string; key: string; item?: ItemHistoryEntry; items?: ItemHistoryEntry[]; status?: string; section?: { key: string } };
  const listRows = (renderer: ReactTestRenderer.ReactTestRenderer) => getList(renderer).props.data as Row[];
  const idsOf = (rowsIn: readonly Row[]) => rowsIn.flatMap(row => (row.item ? [row.item.id] : row.items ? row.items.map(item => item.id) : []));
  const header = (renderer: ReactTestRenderer.ReactTestRenderer) => renderPart(getList(renderer).props.ListHeaderComponent);
  const tilesOf = (view: ReactTestRenderer.ReactTestRenderer) =>
    view.root.findAll(node => String(node.props.testID).startsWith('saved-link-image-tile') && typeof node.props.onPress === 'function');
  const renderOne = (renderer: ReactTestRenderer.ReactTestRenderer, row: Row) => renderPart(getList(renderer).props.renderItem({ item: row, index: 1 }));

  async function pressSort(renderer: ReactTestRenderer.ReactTestRenderer, which: 'date' | 'name') {
    const chip = header(renderer).root.find(node => node.props.testID === `history-sort-${which}` && typeof node.props.onPress === 'function');
    await act(async () => {
      chip.props.onPress();
    });
    await act(async () => {
      await new Promise<void>(resolve => setImmediate(() => resolve()));
    });
  }
  async function setView(renderer: ReactTestRenderer.ReactTestRenderer, mode: 'list' | 'grid' | 'image') {
    const toggle = header(renderer).root.findByType(ViewModeToggle);
    await act(async () => {
      toggle.props.onChange(mode);
    });
  }
  const nameCalls = () => jest.mocked(getItemHistory).mock.calls.filter(([, options]) => options?.sort === 'name');
  const flushIo = async () => {
    await act(async () => {
      await new Promise<void>(resolve => setImmediate(() => resolve()));
    });
  };
  const reachEnd = async (renderer: ReactTestRenderer.ReactTestRenderer) => {
    await act(async () => {
      getList(renderer).props.onEndReached?.();
    });
    await flushIo();
  };

  /**
   * The server's name order stand-in over EVERYTHING (not only what the screen loaded): titled links by title, then
   * title-less ones by site, then locked ones last; q filters; limit/cursor page it. It can serve short pages (pageCap).
   */
  function installNameServer(all: readonly ItemHistoryEntry[], pageCap = 1000) {
    installFakeServer([{ kind: 'today', key: '2026-09-30', items: itemsFor(1, 3) }]);
    const normal = jest.mocked(getItemHistory).getMockImplementation()!;
    const key = (item: ItemHistoryEntry) => (item.isCollectionLocked ? [2, ''] : item.title ? [0, item.title.toLowerCase()] : [1, new URL(item.url).host]);
    jest.mocked(getItemHistory).mockImplementation(async (request, options: GetItemHistoryOptions = {}) => {
      if (options.sort !== 'name' && options.q === undefined) {
        return normal(request, options);
      }
      const term = options.q?.toLowerCase();
      const hits = all.filter(item => !term || `${item.title ?? ''} ${item.url}`.toLowerCase().includes(term));
      const ordered = options.sort === 'name'
        ? [...hits].sort((a, b) => { const [ba, ka] = key(a) as [number, string]; const [bb, kb] = key(b) as [number, string]; return ba - bb || ka.localeCompare(kb) || b.id - a.id; })
        : hits;
      const offset = options.cursor ? Number(options.cursor) : 0;
      const limit = Math.min(options.limit ?? 50, pageCap);
      return { items: ordered.slice(offset, offset + limit), nextCursor: offset + limit < ordered.length ? String(offset + limit) : null };
    });
  }
  const named = (count: number, from = 1000) => Array.from({ length: count }, (_, index) => makeItem({ id: from + index, title: `Item ${String(index).padStart(3, '0')}` }));

  describe('controls and preferences', () => {
    it('offers 시간순 and 이름순 (the shared chips), defaults to 시간순, and keeps 날짜별 / 전체 out of the screen', async () => {
      installFakeServer([{ kind: 'today', key: '2026-09-30', items: itemsFor(1, 3) }]);
      const renderer = await renderScreen();
      const chips = header(renderer).root.findByType(LinkSortChips);

      expect(chips.props.sort).toBe('newest');
      expect(chips.props.dateLabel).toBe('시간순');
      expect(chips.props.nameLabel).toBe('이름순');
      expect(getRows(renderer).some(row => row.kind === 'header')).toBe(true);
      expect(i18n.exists('history.groupByDate')).toBe(false);
      expect(i18n.exists('history.groupAll')).toBe(false);
    });

    it('persists the choice under the Archive\'s own key, independent of the view mode, and restores it', async () => {
      installNameServer(named(5));
      const renderer = await renderScreen();
      await pressSort(renderer, 'name');
      expect(mockSortStore.get('juple.historyLinkSort')).toBe('title');
      expect(mockSortStore.get('juple.collectionDetailsLinkSort')).toBeUndefined();
      expect(mockSortStore.get('juple.homeLinkSort')).toBeUndefined();

      await setView(renderer, 'list');
      expect(header(renderer).root.findByType(LinkSortChips).props.sort).toBe('title');
      await setView(renderer, 'image');
      expect(header(renderer).root.findByType(LinkSortChips).props.sort).toBe('title');
      renderer.unmount();

      // A restart: 이름순 + Image come back, and the grouping key of the old selector is never read.
      mockSortStore.set('juple.historyGroupingMode', 'continuous');
      const restored = await renderScreen();
      expect(header(restored).root.findByType(LinkSortChips).props.sort).toBe('title');
      expect(header(restored).root.findByType(ViewModeToggle).props.value).toBe('image');
      expect(listRows(restored).every(row => row.kind === 'flatImageRow')).toBe(true);
    });

    it('pressing the chosen chip again changes nothing (no direction flip here), and an old stored direction reads as its order', async () => {
      installNameServer(named(3));
      mockSortStore.set('juple.historyLinkSort', 'titleDesc');
      const renderer = await renderScreen();
      expect(header(renderer).root.findByType(LinkSortChips).props.sort).toBe('title');
      const calls = nameCalls().length;
      await pressSort(renderer, 'name');
      expect(header(renderer).root.findByType(LinkSortChips).props.sort).toBe('title');
      expect(nameCalls().length).toBe(calls);
    });
  });

  describe('the stored sort is known BEFORE the first request (hydration)', () => {
    const sectionCalls = () => jest.mocked(getItemHistorySections).mock.calls;
    const historyCalls = () => jest.mocked(getItemHistory).mock.calls;
    const timeCalls = () => historyCalls().filter(([, options]) => options?.sort !== 'name');

    it('stored 시간순: the first and only requests are the date sections and their pages', async () => {
      installNameServer(named(5));
      mockSortStore.set('juple.historyLinkSort', 'newest');
      const renderer = await renderScreen();

      expect(sectionCalls()).toHaveLength(1);
      expect(nameCalls()).toHaveLength(0);
      expect(historyCalls().length).toBeGreaterThan(0);
      expect(timeCalls()).toHaveLength(historyCalls().length);
      expect(header(renderer).root.findByType(LinkSortChips).props.sort).toBe('newest');
      expect(getRows(renderer).some(row => row.kind === 'header')).toBe(true);
    });

    it('stored 이름순: the only requests are name-sorted - no date sections, no throwaway 시간순 request', async () => {
      installNameServer(named(5));
      mockSortStore.set('juple.historyLinkSort', 'title');
      const renderer = await renderScreen();

      expect(sectionCalls()).toHaveLength(0);
      expect(timeCalls()).toHaveLength(0);
      expect(historyCalls().length).toBeGreaterThan(0);
      expect(historyCalls()[0][1]).toMatchObject({ sort: 'name' });
      expect(header(renderer).root.findByType(LinkSortChips).props.sort).toBe('title');
      expect(listRows(renderer).every(row => row.kind === 'flatItem')).toBe(true);
    });

    it('nothing is requested while the stored value is still being read, and the screen shows only its spinner; then 이름순 starts directly', async () => {
      installNameServer(named(5));
      mockSortStore.set('juple.historyLinkSort', 'title');
      let release!: (value: string | null) => void;
      // Only the SORT read is held back (the view mode reads through the same storage).
      jest.mocked(AsyncStorage.getItem).mockImplementation((key: string) =>
        key === 'juple.historyLinkSort' ? new Promise<string | null>(resolve => { release = resolve; }) : Promise.resolve(mockSortStore.get(key) ?? null));
      const renderer = await renderScreen();

      expect(sectionCalls()).toHaveLength(0);
      expect(historyCalls()).toHaveLength(0);
      expect(renderer.root.findAllByType(FlatList)).toHaveLength(0);

      await act(async () => {
        release('title');
      });
      await flushIo();

      expect(sectionCalls()).toHaveLength(0);
      expect(timeCalls()).toHaveLength(0);
      expect(nameCalls().length).toBeGreaterThan(0);
      expect(header(renderer).root.findByType(LinkSortChips).props.sort).toBe('title');
    });

    it('a failing read falls back to 시간순 and loads normally (the screen never hangs)', async () => {
      installNameServer(named(5));
      jest.mocked(AsyncStorage.getItem).mockImplementation((key: string) =>
        key === 'juple.historyLinkSort' ? Promise.reject(new Error('storage unavailable')) : Promise.resolve(mockSortStore.get(key) ?? null));
      const renderer = await renderScreen();

      expect(sectionCalls()).toHaveLength(1);
      expect(nameCalls()).toHaveLength(0);
      expect(header(renderer).root.findByType(LinkSortChips).props.sort).toBe('newest');
      expect(getRows(renderer).some(row => row.kind === 'header')).toBe(true);
    });

    it('an unreadable value (not a known sort) is treated as no preference: 시간순', async () => {
      installNameServer(named(5));
      mockSortStore.set('juple.historyLinkSort', 'sideways');
      const renderer = await renderScreen();

      expect(sectionCalls()).toHaveLength(1);
      expect(nameCalls()).toHaveLength(0);
      expect(header(renderer).root.findByType(LinkSortChips).props.sort).toBe('newest');
    });

    it('switching the sort after hydration still works both ways, with one request set per switch', async () => {
      installNameServer(named(5));
      mockSortStore.set('juple.historyLinkSort', 'title');
      const renderer = await renderScreen();
      expect(sectionCalls()).toHaveLength(0);

      await pressSort(renderer, 'date');
      expect(sectionCalls()).toHaveLength(1);
      expect(header(renderer).root.findByType(LinkSortChips).props.sort).toBe('newest');
      expect(getRows(renderer).some(row => row.kind === 'header')).toBe(true);
      expect(mockSortStore.get('juple.historyLinkSort')).toBe('newest');

      const namesBefore = nameCalls().length;
      await pressSort(renderer, 'name');
      expect(nameCalls().length).toBeGreaterThan(namesBefore);
      expect(header(renderer).root.findByType(LinkSortChips).props.sort).toBe('title');
      expect(mockSortStore.get('juple.historyLinkSort')).toBe('title');
    });
  });

  describe('시간순', () => {
    it('keeps the date sections and their counts in List, Grid and Image', async () => {
      for (const view of ['list', 'grid', 'image'] as const) {
        mockSortStore.clear();
        installFakeServer([
          { kind: 'today', key: '2026-09-30', items: itemsFor(1, 4) },
          { kind: 'yesterday', key: '2026-09-29', items: itemsFor(10, 2) },
        ]);
        const renderer = await renderScreen();
        await setView(renderer, view);
        expect(getRows(renderer).filter(row => row.kind === 'header')).toHaveLength(2);
        expect(getRows(renderer).some(row => row.kind === (view === 'list' ? 'item' : view === 'grid' ? 'gridRow' : 'imageRow'))).toBe(true);
        expect(getItemHistorySections).toHaveBeenCalled();
        renderer.unmount();
        jest.clearAllMocks();
      }
    });

    it('REGRESSION (device): 7 links in 오늘 + Image are the header and exactly three lines 3 / 3 / 1 of real tiles - no blank accordion', async () => {
      installFakeServer([{ kind: 'today', key: '2026-09-30', items: itemsFor(1, 7) }]);
      const renderer = await renderScreen();
      await setView(renderer, 'image');

      expect(getRows(renderer).map(row => row.kind)).toEqual(['header', 'imageRow', 'imageRow', 'imageRow']);
      const lines = getRows(renderer).filter(row => row.kind === 'imageRow');
      expect(lines.map(row => (row.kind === 'imageRow' ? row.items.map(item => item.id) : []))).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
      const views = lines.map(row => renderOne(renderer, row as unknown as Row));
      expect(views.map(view => tilesOf(view).length)).toEqual([3, 3, 1]);
      // A column card body and a full-width line, with no fixed height: a row-direction body would collapse the tiles to 0 wide.
      const body = StyleSheet.flatten(views[0].root.find(node => String(node.props.testID).startsWith('history-image-row') && typeof node.type === 'string').props.style);
      const line = StyleSheet.flatten(views[0].root.find(node => String(node.props.testID).startsWith('history-image-line') && typeof node.type === 'string').props.style);
      expect(body.flexDirection).toBe('column');
      expect(body.height).toBeUndefined();
      expect(line).toMatchObject({ flexDirection: 'row', width: '100%' });
    });

    it.each([[1, 1], [2, 1], [3, 1], [4, 2], [7, 3]])('%i links make %i image line(s) in a date card', async (count, lineCount) => {
      installFakeServer([{ kind: 'today', key: '2026-09-30', items: itemsFor(1, count) }]);
      const renderer = await renderScreen();
      await setView(renderer, 'image');
      const lines = getRows(renderer).filter(row => row.kind === 'imageRow');
      expect(lines).toHaveLength(lineCount);
      expect(lines.reduce((total, row) => total + tilesOf(renderOne(renderer, row as unknown as Row)).length, 0)).toBe(count);
    });

    it('a locked link is a lock tile and a picture-less link a fallback tile inside the date card, nothing leaking; a tap opens the details', async () => {
      installFakeServer([{ kind: 'today', key: '2026-09-30', items: [
        makeItem({ id: 1, title: 'Secret title', url: 'https://secret.example.com/x', isCollectionLocked: true, previewImageUrl: 'https://img.example/s.jpg' }),
        makeItem({ id: 2, title: 'Plain', url: 'https://www.youtube.com/watch?v=a' }),
        makeItem({ id: 3, title: 'Other', url: 'https://example.com/a' }),
      ] }]);
      mockNavigate.mockClear();
      const renderer = await renderScreen();
      await setView(renderer, 'image');
      const view = renderOne(renderer, getRows(renderer).find(row => row.kind === 'imageRow') as unknown as Row);

      expect(view.root.findAll(node => node.props.testID === 'saved-link-image-tile-locked' && typeof node.type === 'string')).toHaveLength(1);
      expect(view.root.findAll(node => node.props.testID === 'saved-link-image-tile-fallback' && typeof node.type === 'string')).toHaveLength(2);
      expect(JSON.stringify(view.toJSON())).not.toMatch(/secret|youtube/i);
      await act(async () => {
        tilesOf(view).find(tile => tile.props.accessibilityLabel === 'Plain')!.props.onPress();
      });
      expect(mockNavigate).toHaveBeenCalledWith('ItemDetails', { itemId: 2 });
    });
  });

  describe('이름순', () => {
    it('is ONE flat list from the server (sort=name over the whole archive) in List, Grid and Image - no date headers', async () => {
      for (const view of ['list', 'grid', 'image'] as const) {
        mockSortStore.clear();
        jest.clearAllMocks();
        installNameServer([makeItem({ id: 1, title: 'Mango' }), makeItem({ id: 2, title: 'apple' }), makeItem({ id: 3, title: 'Zebra' }), makeItem({ id: 4, title: null, url: 'https://b.example/x' })]);
        const renderer = await renderScreen();
        await setView(renderer, view);
        await pressSort(renderer, 'name');

        expect(nameCalls()).toHaveLength(1);
        expect(nameCalls()[0][1]).toEqual({ limit: 30, sort: 'name', q: undefined, cursor: undefined });
        expect(idsOf(listRows(renderer))).toEqual([2, 1, 3, 4]);
        expect(listRows(renderer).some(row => row.kind === 'header' || row.kind === 'flatHeader')).toBe(false);
        expect(listRows(renderer).every(row => row.kind === (view === 'list' ? 'flatItem' : view === 'grid' ? 'flatGridRow' : 'flatImageRow'))).toBe(true);
        renderer.unmount();
      }
    });

    it('does not keep loading the date sections while 이름순 is chosen, and 시간순 brings the accordion back', async () => {
      installNameServer(named(4));
      mockSortStore.set('juple.historyLinkSort', 'title');
      const renderer = await renderScreen();
      // (The very first frame is drawn before the stored choice is read, so one early summary request can exist.)
      const afterStart = jest.mocked(getItemHistorySections).mock.calls.length;
      await flushIo();
      await flushIo();
      expect(jest.mocked(getItemHistorySections).mock.calls.length).toBe(afterStart);
      expect(listRows(renderer).some(row => row.kind === 'header')).toBe(false);
      await reachEnd(renderer);
      await setView(renderer, 'grid');
      expect(jest.mocked(getItemHistorySections).mock.calls.length).toBe(afterStart);

      await pressSort(renderer, 'date');
      expect(jest.mocked(getItemHistorySections).mock.calls.length).toBeGreaterThan(afterStart);
      expect(getRows(renderer).some(row => row.kind === 'header')).toBe(true);
    });

    it('pages the whole archive with the server cursor - once per page, appending without repeats', async () => {
      installNameServer(named(70));
      const renderer = await renderScreen();
      await pressSort(renderer, 'name');
      expect(idsOf(listRows(renderer))).toHaveLength(30);

      await reachEnd(renderer);
      expect(idsOf(listRows(renderer))).toHaveLength(60);
      await reachEnd(renderer);
      expect(idsOf(listRows(renderer))).toHaveLength(70);
      expect(new Set(idsOf(listRows(renderer))).size).toBe(70);
      expect(nameCalls().map(([, options]) => options?.cursor)).toEqual([undefined, '30', '60']);
      await reachEnd(renderer);
      expect(nameCalls()).toHaveLength(3);
    });

    it('switching List / Grid / Image never asks the server again; switching the sort asks for the sorted query', async () => {
      installNameServer(named(10));
      const renderer = await renderScreen();
      await pressSort(renderer, 'name');
      const calls = jest.mocked(getItemHistory).mock.calls.length;

      await setView(renderer, 'grid');
      await setView(renderer, 'image');
      await setView(renderer, 'list');
      expect(jest.mocked(getItemHistory).mock.calls.length).toBe(calls);
      expect(idsOf(listRows(renderer))).toEqual(named(10).map(item => item.id));
    });

    it('search + 이름순 is ONE server query with both q and sort=name, flat; clearing returns to the name list; switching view adds no request', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      try {
        installNameServer([makeItem({ id: 1, title: 'quokka zulu' }), makeItem({ id: 2, title: 'quokka alpha' }), makeItem({ id: 3, title: 'unrelated' })]);
        const renderer = await renderScreen();
        await pressSort(renderer, 'name');
        const field = header(renderer).root.findByType(SearchField);
        await act(async () => {
          field.props.onChangeText('quokka');
        });
        await act(async () => {
          jest.advanceTimersByTime(ARCHIVE_SEARCH_DEBOUNCE_MS + 10);
        });
        await act(async () => {
          await Promise.resolve();
        });

        const both = jest.mocked(getItemHistory).mock.calls.filter(([, options]) => options?.q === 'quokka' && options.sort === 'name');
        expect(both).toHaveLength(1);
        expect(idsOf(listRows(renderer))).toEqual([2, 1]);
        const calls = jest.mocked(getItemHistory).mock.calls.length;
        await setView(renderer, 'image');
        expect(jest.mocked(getItemHistory).mock.calls.length).toBe(calls);

        const clearField = header(renderer).root.findByType(SearchField);
        await act(async () => {
          clearField.props.onChangeText('');
        });
        await act(async () => {
          await Promise.resolve();
        });
        await flushIo();
        expect(idsOf(listRows(renderer)).sort()).toEqual([1, 2, 3]);
      } finally {
        jest.useRealTimers();
      }
    });

    it('a locked link in the name list is a lock card / lock tile - the server already placed it last and sent nothing of it', async () => {
      installNameServer([
        makeItem({ id: 1, title: 'Zebra' }),
        makeItem({ id: 2, title: '', url: '', isCollectionLocked: true, memo: null, previewImageUrl: null }),
      ]);
      mockSortStore.set('juple.historyLinkSort', 'title');
      mockSortStore.set('juple.historyViewMode', 'image');
      const renderer = await renderScreen();

      expect(idsOf(listRows(renderer))).toEqual([1, 2]);
      const view = renderOne(renderer, listRows(renderer)[0]);
      expect(view.root.findAll(node => node.props.testID === 'saved-link-image-tile-locked' && typeof node.type === 'string')).toHaveLength(1);
    });

    it('a failed first load shows the standard failure state with a retry; a failed NEXT page keeps the rows and offers the compact retry (no automatic loop)', async () => {
      installNameServer(named(70));
      const working = jest.mocked(getItemHistory).getMockImplementation()!;
      let failing = true;
      jest.mocked(getItemHistory).mockImplementation(async (request, options: GetItemHistoryOptions = {}) => {
        if (failing && options.sort === 'name') {
          throw new Error('offline');
        }
        return working(request, options);
      });
      const renderer = await renderScreen();
      await pressSort(renderer, 'name');
      expect(listRows(renderer).map(row => row.status)).toEqual(['error']);

      failing = false;
      const errorView = renderOne(renderer, listRows(renderer)[0]);
      await act(async () => {
        errorView.root.find(node => typeof node.props.onRetry === 'function').props.onRetry();
      });
      await flushIo();
      expect(idsOf(listRows(renderer))).toHaveLength(30);

      failing = true;
      await reachEnd(renderer);
      const calls = nameCalls().length;
      expect(listRows(renderer).some(row => row.status === 'moreError')).toBe(true);
      expect(idsOf(listRows(renderer))).toHaveLength(30);
      await flushIo();
      await flushIo();
      expect(nameCalls().length).toBe(calls);

      failing = false;
      const notice = renderOne(renderer, listRows(renderer).find(row => row.status === 'moreError')!);
      await act(async () => {
        notice.root.find(node => typeof node.props.onRetry === 'function').props.onRetry();
      });
      await flushIo();
      expect(idsOf(listRows(renderer))).toHaveLength(60);
    });
  });

  describe('the flat list fills the viewport by itself (dense Image lines)', () => {
    const HEADER_HEIGHT = 400;
    const LINE_HEIGHT = { list: 90, grid: 200, image: 110 } as const;
    let reported = new WeakMap<object, number>();
    beforeEach(() => {
      reported = new WeakMap();
    });
    async function layout(renderer: ReactTestRenderer.ReactTestRenderer, viewport: number) {
      await act(async () => {
        getList(renderer).props.onLayout({ nativeEvent: { layout: { height: viewport, width: 360, x: 0, y: 0 } } });
      });
    }
    async function measure(renderer: ReactTestRenderer.ReactTestRenderer, mode: 'list' | 'grid' | 'image', passes = 16) {
      for (let pass = 0; pass < passes; pass++) {
        const height = HEADER_HEIGHT + LINE_HEIGHT[mode] * listRows(renderer).length;
        if (reported.get(renderer) !== height) {
          reported.set(renderer, height);
          await act(async () => {
            getList(renderer).props.onContentSizeChange(360, height);
          });
        }
        await flushIo();
      }
    }

    it('CRITICAL: short pages (7 per request) in 이름순 + Image keep loading until the viewport is full - no scrolling, in order, no repeats', async () => {
      installNameServer(named(60), 7);
      mockSortStore.set('juple.historyLinkSort', 'title');
      mockSortStore.set('juple.historyViewMode', 'image');
      const renderer = await renderScreen();
      expect(idsOf(listRows(renderer))).toHaveLength(7);

      await layout(renderer, 800);
      await measure(renderer, 'image');

      const loaded = idsOf(listRows(renderer));
      expect(loaded.length).toBeGreaterThan(7);
      expect(new Set(loaded).size).toBe(loaded.length);
      expect(loaded).toEqual(named(60).map(item => item.id).slice(0, loaded.length));
      // Each page asked for once.
      const cursors = nameCalls().map(([, options]) => options?.cursor ?? '');
      expect(new Set(cursors).size).toBe(cursors.length);
    });

    it('stops once the viewport is filled, and when there is nothing more', async () => {
      installNameServer(named(12), 7);
      mockSortStore.set('juple.historyLinkSort', 'title');
      mockSortStore.set('juple.historyViewMode', 'image');
      const renderer = await renderScreen();
      await layout(renderer, 9000);
      await measure(renderer, 'image', 20);
      expect(idsOf(listRows(renderer))).toHaveLength(12);
      const calls = nameCalls().length;
      await measure(renderer, 'image', 6);
      expect(nameCalls().length).toBe(calls);

      reported = new WeakMap();
      jest.clearAllMocks();
      installNameServer(named(60), 7);
      const small = await renderScreen();
      await layout(small, 100);
      await measure(small, 'image');
      expect(idsOf(listRows(small)).length).toBeLessThanOrEqual(14);
    });

    it('List, Grid and Image converge to the same sequence', async () => {
      const sequences: number[][] = [];
      for (const view of ['list', 'grid', 'image'] as const) {
        reported = new WeakMap();
        jest.clearAllMocks();
        mockSortStore.clear();
        installNameServer(named(40), 7);
        mockSortStore.set('juple.historyLinkSort', 'title');
        mockSortStore.set('juple.historyViewMode', view);
        const renderer = await renderScreen();
        await layout(renderer, 99999);
        await measure(renderer, view, 24);
        sequences.push(idsOf(listRows(renderer)));
        renderer.unmount();
      }
      expect(sequences[0]).toHaveLength(40);
      expect(sequences[1]).toEqual(sequences[0]);
      expect(sequences[2]).toEqual(sequences[0]);
    });
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
