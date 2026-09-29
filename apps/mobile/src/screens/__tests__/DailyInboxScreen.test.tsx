jest.mock('../../api/apiConfig', () => ({ apiConfig: { baseUrl: 'https://api.test' } }));
import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Modal, TextInput } from 'react-native';
import i18n from '../../i18n';
import { DailyInboxScreen, HOME_FIRST_PAGE_SKELETON_ROWS, HOME_NEXT_PAGE_SKELETON_ROWS, HOME_PAGE_SIZE } from '../DailyInboxScreen';
import { SavedLinkRow } from '../../components/SavedLinkRow';
import { UndoToast } from '../../components/UndoToast';
import { AppToastProvider } from '../../components/AppToast';
import { SavedLinkGridCell } from '../../components/SavedLinkGridCard';

// The react-native-localize jest mock (see jest.config.js) reports "en-US", so i18n would
// otherwise resolve to English by default - pinned to Korean so this file's label assertions are
// deterministic regardless of that mock's default locale.
beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
import { deleteItem, getItemHistory, getItemHistoryCount, restoreItem, type GetItemHistoryOptions, type ItemHistoryEntry } from '../../items/api/itemsApi';
import { shareItem } from '../../items/shareItem';
import { resolveUrlMetadata } from '../../urlMetadata/api/urlMetadataApi';
import { saveInboxEntry } from '../../inbox/api/inboxApi';

// A module-level mock (not a fresh jest.fn() returned from the factory on every call) so tests
// can assert on it directly - matches the pattern already used elsewhere for route-prop screens
// (see CollectionDetailsScreen.test.tsx's own `navigation` constant).
const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
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

jest.mock('../../inbox/api/inboxApi', () => ({
  saveInboxEntry: jest.fn(),
}));

jest.mock('../../items/api/itemsApi', () => ({
  getItemHistory: jest.fn(),
  getItemHistoryCount: jest.fn(),
  deleteItem: jest.fn(),
  restoreItem: jest.fn(),
  updateItemDetails: jest.fn(),
  setItemPreviewImage: jest.fn(),
}));

jest.mock('../../items/shareItem', () => ({
  shareItem: jest.fn(),
}));

jest.mock('../../urlMetadata/api/urlMetadataApi', () => ({
  resolveUrlMetadata: jest.fn(),
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

/**
 * Stands in for the server's today window: getItemHistory pages through `items` (already only
 * today's - the server filters by the window) with an offset cursor, and getItemHistoryCount
 * answers the whole day's total (`total`, by default every item).
 */
function setUpItems(items: readonly ItemHistoryEntry[], total: number = items.length): void {
  jest.mocked(getItemHistory).mockImplementation(async (_request, options: GetItemHistoryOptions = {}) => servePage(items, options));
  jest.mocked(getItemHistoryCount).mockResolvedValue(total);
}

function servePage(items: readonly ItemHistoryEntry[], options: GetItemHistoryOptions) {
  const offset = options.cursor ? Number(options.cursor) : 0;
  const limit = options.limit ?? 50;
  return {
    items: items.slice(offset, offset + limit),
    nextCursor: offset + limit < items.length ? String(offset + limit) : null,
  };
}

function manyItems(count: number): ItemHistoryEntry[] {
  return Array.from({ length: count }, (_, index) => makeItem({ id: index + 1, title: `Link ${index + 1}` }));
}

/** Today's local midnight as the UTC instant Home sends as fromUtc. */
function localMidnightUtc(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

// Wrapped in the real AppToastProvider (not mocked) - Delete Undo now shows via the global
// AppToast Host (see useAppToast), so these tests exercise the real Provider and assert on the
// actual UndoToast/ConfirmDialog it renders, exactly as a real app screen would.
const mountedRenderers: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => {
    mountedRenderers.splice(0).forEach(renderer => renderer.unmount());
  });
});

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <AppToastProvider>
        <DailyInboxScreen />
      </AppToastProvider>,
    );
  });
  mountedRenderers.push(renderer);
  return renderer;
}

function getRowElement(renderer: ReactTestRenderer.ReactTestRenderer, item: ItemHistoryEntry) {
  const flatList = renderer.root.findByType(FlatList);
  const element = flatList.props.renderItem({ item });
  let rowRenderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    rowRenderer = ReactTestRenderer.create(element);
  });
  mountedRenderers.push(rowRenderer);
  return rowRenderer;
}

// Minimal fake GestureResponderEvent - see SwipeableItemRow.test.tsx's identical constant for why
// this is enough for PanResponder's internal TouchHistoryMath calls to run without throwing.
const FAKE_RESPONDER_EVENT = {
  touchHistory: { touchBank: [], numberActiveTouches: 0, indexOfSingleActiveTouch: -1, mostRecentTimeStamp: 0 },
  nativeEvent: {},
};

/** The share/delete swipe actions are only mounted once a swipe is actually underway (see
 * SwipeableItemRow's own isRevealed remarks - a real-device fix for a persistent color-bleed bug
 * at rest) - fires the same onResponderGrant a real gesture would, so tests can reach those
 * buttons without simulating full drag coordinates. */
function revealRow(row: ReactTestRenderer.ReactTestRenderer): void {
  const contentLayer = row.root.findAll(node => Array.isArray(node.props.accessibilityActions))[0];
  ReactTestRenderer.act(() => {
    contentLayer.props.onResponderGrant(FAKE_RESPONDER_EVENT);
  });
}

/** The screen's single ConfirmDialog (a Modal) - scoping queries to it avoids colliding with the FlatList's own real (unrelated) swipe-action buttons that happen to share the same accessibilityLabel text ("삭제"). */
function getConfirmDialogButton(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  const dialog = renderer.root.findByType(Modal);
  return dialog.findAll(node => node.props.accessibilityLabel === label)[0];
}

describe('DailyInboxScreen grid', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders grid items with the same shared SavedLinkGridCell History uses, never a Home-only size variant", async () => {
    const items = [makeItem({ id: 1, title: 'Hi' }), makeItem({ id: 2, title: 'A much longer title that wraps onto a second line' })];
    setUpItems(items);
    const renderer = await renderScreen();
    const gridToggle = renderer.root.findAll(node => node.props.accessibilityLabel === 'Grid view' && typeof node.props.onPress === 'function')[0];
    await act(async () => {
      gridToggle.props.onPress();
    });

    const cells = renderer.root.findAllByType(SavedLinkGridCell);
    expect(cells.map(cell => cell.props.item.id)).toEqual([1, 2]);
    expect(renderer.root.findByType(FlatList).props.numColumns).toBe(2);
    expect(Object.keys(cells[0].props).sort()).toEqual(Object.keys(cells[1].props).sort());
  });
});

describe('DailyInboxScreen swipe actions', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // Regression test: SwipeableItemRow's contentPressable used to force flexDirection: 'row' on
  // itself, which stopped the wrapped row content (title/URL/memo) from stretching to full width
  // - the title was still technically in the tree but rendered at an effectively invisible width.
  // This confirms the title text actually reaches the rendered tree through the wrapper.
  it('renders the row content (title) through the SwipeableItemRow wrapper', async () => {
    const item = makeItem({ id: 5, title: 'Visible title' });
    setUpItems([item]);
    const renderer = await renderScreen();

    const row = getRowElement(renderer, item);
    expect(row.root.findByProps({ children: 'Visible title' })).toBeTruthy();
  });

  it('shows a domain fallback (not the raw URL) as the primary text for items without a title', async () => {
    const item = makeItem({ id: 6, title: null, url: 'https://www.youtube.com/watch?v=abc' });
    setUpItems([item]);
    const renderer = await renderScreen();

    const row = getRowElement(renderer, item);
    expect(row.root.findByProps({ children: 'youtube.com' })).toBeTruthy();
  });

  it('shares the item via the swipe share action', async () => {
    const item = makeItem({ id: 7, title: 'Shareable' });
    setUpItems([item]);
    jest.mocked(shareItem).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    const row = getRowElement(renderer, item);
    revealRow(row);
    const shareAction = row.root.findAll(node => node.props.accessibilityLabel === '공유')[0];
    await act(async () => {
      shareAction.props.onPress();
    });

    expect(shareItem).toHaveBeenCalledWith(item.url, item.title);
  });

  it('asks for confirmation (via the shared ConfirmDialog) before deleting, and only deletes after confirming', async () => {
    const item = makeItem({ id: 9, title: 'Deletable' });
    setUpItems([item]);
    jest.mocked(deleteItem).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    const row = getRowElement(renderer, item);
    revealRow(row);
    const deleteAction = row.root.findAll(node => node.props.accessibilityLabel === '삭제')[0];
    await act(async () => {
      deleteAction.props.onPress();
    });

    expect(deleteItem).not.toHaveBeenCalled();

    await act(async () => {
      getConfirmDialogButton(renderer, '삭제').props.onPress();
    });

    expect(deleteItem).toHaveBeenCalledWith(expect.anything(), item.id);
  });

  it('does not delete when the ConfirmDialog is cancelled', async () => {
    const item = makeItem({ id: 11, title: 'Kept' });
    setUpItems([item]);
    const renderer = await renderScreen();

    const row = getRowElement(renderer, item);
    revealRow(row);
    const deleteAction = row.root.findAll(node => node.props.accessibilityLabel === '삭제')[0];
    await act(async () => {
      deleteAction.props.onPress();
    });

    await act(async () => {
      getConfirmDialogButton(renderer, '취소').props.onPress();
    });

    expect(deleteItem).not.toHaveBeenCalled();
  });
});

describe('DailyInboxScreen delete undo', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  async function deleteViaSwipe(renderer: ReactTestRenderer.ReactTestRenderer, item: ItemHistoryEntry) {
    const row = getRowElement(renderer, item);
    revealRow(row);
    const deleteAction = row.root.findAll(node => node.props.accessibilityLabel === '삭제')[0];
    await act(async () => {
      deleteAction.props.onPress();
    });
    await act(async () => {
      getConfirmDialogButton(renderer, '삭제').props.onPress();
    });
  }

  it('removes the row, decreases the count, and shows the undo toast after a successful delete', async () => {
    const item = makeItem({ id: 30, title: 'Removable' });
    setUpItems([item]);
    jest.mocked(deleteItem).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    await deleteViaSwipe(renderer, item);

    expect(renderer.root.findAllByProps({ children: 'Removable' })).toHaveLength(0);
    expect(renderer.root.findByProps({ children: '0개' })).toBeTruthy();
    expect(renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') })).toBeTruthy();
    // AppToastHost renders above NavigationContainer (root coordinate space), not inside this
    // screen's own scene, so the toast's bottomOffset must be the actual tab bar height (mocked
    // to 80 above), not 0 - 0 would put the toast under the tab bar.
    expect(renderer.root.findByType(UndoToast).props.bottomOffset).toBe(80);
  });

  it('restores the row and count after undo succeeds', async () => {
    const item = makeItem({ id: 31, title: 'Restorable' });
    setUpItems([item]);
    jest.mocked(deleteItem).mockResolvedValue(undefined);
    jest.mocked(restoreItem).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    await deleteViaSwipe(renderer, item);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress();
      await Promise.resolve();
    });

    expect(restoreItem).toHaveBeenCalledWith(expect.anything(), item.id);
    expect(renderer.root.findAllByProps({ children: 'Restorable' }).length).toBeGreaterThan(0);
    expect(renderer.root.findByProps({ children: '1개' })).toBeTruthy();
    expect(renderer.root.findAllByProps({ accessibilityLabel: i18n.t('toast.undoAction') })).toHaveLength(0);
  });

  it('keeps the deleted state and shows the shared notice dialog when undo fails', async () => {
    const item = makeItem({ id: 32, title: 'Stuck deleted' });
    setUpItems([item]);
    jest.mocked(deleteItem).mockResolvedValue(undefined);
    jest.mocked(restoreItem).mockRejectedValue(new Error('no'));
    const renderer = await renderScreen();

    await deleteViaSwipe(renderer, item);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress();
      await Promise.resolve();
    });

    expect(renderer.root.findAllByProps({ children: 'Stuck deleted' })).toHaveLength(0);
    expect(renderer.root.findByProps({ children: '0개' })).toBeTruthy();
    expect(renderer.root.findByProps({ children: i18n.t('toast.undoDeleteError') })).toBeTruthy();
  });

  it('does not send a second restore request while the first undo is still pending', async () => {
    const item = makeItem({ id: 33, title: 'Double tap' });
    setUpItems([item]);
    jest.mocked(deleteItem).mockResolvedValue(undefined);
    let resolveRestore!: () => void;
    jest.mocked(restoreItem).mockImplementation(() => new Promise<void>(resolve => { resolveRestore = resolve; }));
    const renderer = await renderScreen();

    await deleteViaSwipe(renderer, item);

    const undo = renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress;
    await act(async () => { undo(); undo(); });
    expect(restoreItem).toHaveBeenCalledTimes(1);

    await act(async () => { resolveRestore(); await Promise.resolve(); });
  });
});

/** Home's Save button is the CheckIcon button trailing the URL input, identified by its accessibilityLabel (icon-only, no visible label Text - see DailyInboxScreen). */
function pressHomeSaveButton(renderer: ReactTestRenderer.ReactTestRenderer) {
  renderer.root.findByProps({ accessibilityLabel: i18n.t('common.save') }).props.onPress();
}

describe('DailyInboxScreen direct URL entry', () => {
  beforeEach(() => {
    setUpItems([]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('never saves anything itself - Check only navigates to NewLinkReview for the user to actually Save', async () => {
    const renderer = await renderScreen();

    const urlInput = renderer.root.findByType(TextInput);
    await act(async () => {
      urlInput.props.onChangeText('https://example.com');
    });

    await act(async () => {
      pressHomeSaveButton(renderer);
    });

    expect(saveInboxEntry).not.toHaveBeenCalled();
    expect(resolveUrlMetadata).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('NewLinkReview', {
      url: 'https://example.com',
      initialTitle: null,
      preselectedCollectionId: null,
    });
  });

  it('does not navigate for an empty/whitespace-only URL', async () => {
    const renderer = await renderScreen();

    const urlInput = renderer.root.findByType(TextInput);
    await act(async () => {
      urlInput.props.onChangeText('   ');
    });

    // The button itself is disabled while empty/whitespace-only, but the guard inside the handler
    // is what actually matters here - not just the disabled prop.
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: i18n.t('common.save') }).props.onPress();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // Regression test for a real-device report: pasting a share-copied clipboard value (description
  // text + URL, e.g. a 당근마켓 share) left the raw prefixed text sitting in NewLinkReview's url
  // field. Check must extract the URL alone (see sharedTextParser.ts's extractFirstHttpUrl) and
  // navigate with that, not the original pasted text.
  it('extracts the URL from pasted "description + URL" text before navigating (당근 share example)', async () => {
    const renderer = await renderScreen();

    const urlInput = renderer.root.findByType(TextInput);
    await act(async () => {
      urlInput.props.onChangeText(
        '당근에서 이 글을 확인해보세요!\r\n\r\nhttps://www.daangn.com/articles/1253314119?share=true',
      );
    });

    await act(async () => {
      pressHomeSaveButton(renderer);
    });

    expect(mockNavigate).toHaveBeenCalledWith('NewLinkReview', {
      url: 'https://www.daangn.com/articles/1253314119?share=true',
      initialTitle: null,
      preselectedCollectionId: null,
    });
  });

  it('rejects a non-http(s) value with the existing bad-request message, never navigating', async () => {
    const renderer = await renderScreen();

    const urlInput = renderer.root.findByType(TextInput);
    await act(async () => {
      urlInput.props.onChangeText('not a url');
    });

    await act(async () => {
      pressHomeSaveButton(renderer);
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ children: i18n.t('inbox.errorBadRequest') })).toBeTruthy();
  });

  it('navigates exactly once on a rapid double-press', async () => {
    const renderer = await renderScreen();

    const urlInput = renderer.root.findByType(TextInput);
    await act(async () => {
      urlInput.props.onChangeText('https://example.com');
    });

    await act(async () => {
      const onPress = renderer.root.findByProps({ accessibilityLabel: i18n.t('common.save') }).props.onPress;
      onPress();
      onPress();
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('shows the Check action as an icon-only button next to the URL input, disabled while empty', async () => {
    const renderer = await renderScreen();

    // The old full-width "저장" text CTA is gone - only the accessibilityLabel identifies the action now.
    expect(renderer.root.findAll(n => n.props.children === i18n.t('common.save'))).toHaveLength(0);
    expect(renderer.root.findByProps({ accessibilityLabel: i18n.t('common.save') }).props.disabled).toBe(true);

    const urlInput = renderer.root.findByType(TextInput);
    await act(async () => { urlInput.props.onChangeText('https://example.com'); });
    expect(renderer.root.findByProps({ accessibilityLabel: i18n.t('common.save') }).props.disabled).toBe(false);
  });
});

describe('DailyInboxScreen header', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('no longer shows the old "오늘 저장한 링크" heading or a date line', async () => {
    setUpItems([makeItem({ id: 1 })]);
    const renderer = await renderScreen();

    expect(renderer.root.findAllByProps({ children: '오늘 저장한 링크' })).toHaveLength(0);
    expect(
      renderer.root.findAll(node => typeof node.props.children === 'string' && node.props.children.includes('2026-')),
    ).toHaveLength(0);
  });

  it('shows "최근 저장" with the current today-count next to it, including zero', async () => {
    setUpItems([]);
    const renderer = await renderScreen();

    expect(renderer.root.findByProps({ children: '최근 저장' })).toBeTruthy();
    expect(renderer.root.findByProps({ children: '0개' })).toBeTruthy();
  });

  it('the recent-saved count is the whole day\'s total from the server, not how many rows are loaded', async () => {
    setUpItems([makeItem({ id: 1 }), makeItem({ id: 2 }), makeItem({ id: 3 })], 40);
    const renderer = await renderScreen();

    expect(renderer.root.findByProps({ children: '40개' })).toBeTruthy();
  });

  it('falls back to the loaded count when only the count request fails', async () => {
    setUpItems([makeItem({ id: 1 }), makeItem({ id: 2 })]);
    jest.mocked(getItemHistoryCount).mockRejectedValue(new Error('offline'));
    const renderer = await renderScreen();

    expect(renderer.root.findByProps({ children: '2개' })).toBeTruthy();
    expect(renderer.root.findAllByProps({ children: 'Example' }).length).toBeGreaterThan(0);
  });
});

describe('DailyInboxScreen recent-items data source', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // Regression guard for the "History shows 3, Home shows 0" bug: Home used to call a dedicated
  // date endpoint whose window came from the User's stored TimeZoneId, which can go stale. Home
  // asks the same History feed for the device's own "today" - from its live local midnight - so the
  // server filters exactly what the device calls today, a page at a time.
  it('asks the History feed for one page of the device\'s own today (from its local midnight) and that day\'s total', async () => {
    setUpItems([makeItem({ id: 1 })]);
    await renderScreen();

    expect(getItemHistory).toHaveBeenCalledTimes(1);
    expect(getItemHistory).toHaveBeenCalledWith(expect.anything(), { limit: HOME_PAGE_SIZE, fromUtc: localMidnightUtc() });
    expect(getItemHistoryCount).toHaveBeenCalledWith(expect.anything(), { fromUtc: localMidnightUtc() });
  });

  it('renders every item the feed returns whose SavedAtUtc falls on today\'s local date', async () => {
    const todayItems = [makeItem({ id: 1, title: 'Today A' }), makeItem({ id: 2, title: 'Today B' }), makeItem({ id: 3, title: 'Today C' })];
    setUpItems(todayItems);
    const renderer = await renderScreen();

    expect(renderer.root.findByProps({ children: '3개' })).toBeTruthy();
    for (const item of todayItems) {
      expect(renderer.root.findAllByProps({ children: item.title }).length).toBeGreaterThan(0);
    }
  });

  it('refetches on (re-)focus and picks up a newly-saved item (e.g. after Quick Save or NewLinkReview)', async () => {
    setUpItems([]);
    const first = await renderScreen();
    expect(first.root.findByProps({ children: '0개' })).toBeTruthy();
    await act(async () => {
      first.unmount();
    });

    // Simulate a save that happened elsewhere (Quick Save ON, or Quick Save OFF -> NewLinkReview ->
    // Save) while Home was unfocused, then the user returning to the Home tab - which remounts
    // (and thus re-fires useFocusEffect on) this screen, exactly like React Navigation does.
    setUpItems([makeItem({ id: 42, title: 'Newly saved' })]);
    const second = await renderScreen();

    expect(second.root.findByProps({ children: '1개' })).toBeTruthy();
    expect(second.root.findAllByProps({ children: 'Newly saved' }).length).toBeGreaterThan(0);
  });
});

describe('DailyInboxScreen paging and virtualization', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  function skeletons(renderer: ReactTestRenderer.ReactTestRenderer) {
    return renderer.root.findAll(node => node.props.testID === 'home-skeleton' && typeof node.type === 'string');
  }

  it('shows skeleton rows (not a full-screen spinner) while the first page loads, then the links', async () => {
    const items = manyItems(3);
    setUpItems(items);
    const pending = deferred<ReturnType<typeof servePage>>();
    jest.mocked(getItemHistory).mockImplementationOnce(() => pending.promise);
    const renderer = await renderScreen();

    // The input and header stay usable while it loads.
    expect(renderer.root.findByType(TextInput)).toBeTruthy();
    expect(skeletons(renderer)).toHaveLength(HOME_FIRST_PAGE_SKELETON_ROWS);

    await act(async () => {
      pending.resolve(servePage(items, { limit: HOME_PAGE_SIZE }));
    });

    expect(skeletons(renderer)).toHaveLength(0);
    expect(renderer.root.findAllByType(SavedLinkRow)).toHaveLength(3);
  });

  it('loads the next page of today as the end comes into reach - once, with skeletons only while it is on its way', async () => {
    const items = manyItems(30);
    setUpItems(items);
    const renderer = await renderScreen();
    // More exist, but nothing is being requested: no skeleton.
    expect(skeletons(renderer)).toHaveLength(0);

    const pending = deferred<ReturnType<typeof servePage>>();
    jest.mocked(getItemHistory).mockImplementationOnce(() => pending.promise);
    await act(async () => {
      renderer.root.findByType(FlatList).props.onEndReached();
      renderer.root.findByType(FlatList).props.onEndReached();
    });

    expect(getItemHistory).toHaveBeenCalledTimes(2);
    expect(jest.mocked(getItemHistory).mock.calls[1][1]).toEqual({ limit: HOME_PAGE_SIZE, cursor: String(HOME_PAGE_SIZE), fromUtc: localMidnightUtc() });
    expect(skeletons(renderer)).toHaveLength(HOME_NEXT_PAGE_SKELETON_ROWS);

    await act(async () => {
      pending.resolve(servePage(items, { limit: HOME_PAGE_SIZE, cursor: String(HOME_PAGE_SIZE) }));
    });
    expect(skeletons(renderer)).toHaveLength(0);
    expect(renderer.root.findByType(FlatList).props.data.map((item: ItemHistoryEntry) => item.id)).toEqual(items.map(item => item.id));

    // The last page is in - reaching the end asks for nothing more.
    await act(async () => {
      renderer.root.findByType(FlatList).props.onEndReached();
    });
    expect(getItemHistory).toHaveBeenCalledTimes(2);
  });

  it('with 1,000 links today, loads one page and mounts only a window of rows, whatever the total', async () => {
    const items = manyItems(1000);
    setUpItems(items);
    const renderer = await renderScreen();

    expect(getItemHistory).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ children: '1000개' })).toBeTruthy();
    const list = renderer.root.findByType(FlatList);
    expect(list.props.data).toHaveLength(HOME_PAGE_SIZE);
    expect(renderer.root.findAllByType(SavedLinkRow).length).toBeLessThanOrEqual(list.props.initialNumToRender);
  });

  it('coming back to Home reloads what was shown in place - as many rows as were loaded, not just the first page', async () => {
    const items = manyItems(60);
    setUpItems(items);
    const renderer = await renderScreen();
    await act(async () => {
      renderer.root.findByType(FlatList).props.onEndReached();
    });
    expect(renderer.root.findByType(FlatList).props.data).toHaveLength(50);
    jest.mocked(getItemHistory).mockClear();

    await act(async () => {
      renderer.root.findByType(FlatList).props.refreshControl.props.onRefresh();
    });

    expect(getItemHistory).toHaveBeenCalledWith(expect.anything(), { limit: 50, fromUtc: localMidnightUtc() });
    expect(renderer.root.findByType(FlatList).props.data).toHaveLength(50);
  });

  it('drops a stale first page that lands after a newer refresh', async () => {
    const items = manyItems(3);
    setUpItems(items);
    const first = deferred<ReturnType<typeof servePage>>();
    jest.mocked(getItemHistory).mockImplementationOnce(() => first.promise);
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByType(FlatList).props.refreshControl.props.onRefresh();
    });
    expect(renderer.root.findByType(FlatList).props.data).toHaveLength(3);

    await act(async () => {
      first.resolve({ items: [makeItem({ id: 999, title: 'Stale' })], nextCursor: null });
    });
    expect(renderer.root.findAllByProps({ children: 'Stale' })).toHaveLength(0);
    expect(renderer.root.findByType(FlatList).props.data).toHaveLength(3);
  });
});
