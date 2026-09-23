import { useState } from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Modal, SectionList } from 'react-native';
import i18n from '../../i18n';
import { DateHistoryScreen } from '../DateHistoryScreen';

// The react-native-localize jest mock (see jest.config.js) reports "en-US", so i18n would
// otherwise resolve to English by default - pinned to Korean so this file's label assertions are
// deterministic regardless of that mock's default locale.
beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
import { useItemHistory, type UseItemHistoryResult } from '../../items/useItemHistory';
import { deleteItem, restoreItem, type ItemHistoryEntry } from '../../items/api/itemsApi';
import { shareItem } from '../../items/shareItem';
import { UndoToast } from '../../components/UndoToast';
import { AppToastProvider } from '../../components/AppToast';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  // Only useToastBottomAnchor (via useAppToast) needs this now - DateHistoryScreen itself has no
  // other focus-driven effect (its data comes from the separately-mocked useItemHistory hook).
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

jest.mock('../../items/useItemHistory');

jest.mock('../../items/api/itemsApi', () => ({
  ...jest.requireActual('../../items/api/itemsApi'),
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

/** Static snapshot - use for tests that never delete/mutate items. */
function mockUseItemHistory(items: readonly ItemHistoryEntry[]): void {
  jest.mocked(useItemHistory).mockReturnValue({
    items,
    isLoading: false,
    isRefreshing: false,
    isLoadingMore: false,
    error: null,
    refresh: jest.fn(),
    loadMore: jest.fn(),
    removeItem: jest.fn(),
  } satisfies UseItemHistoryResult);
}

/**
 * Backed by real useState so removeItem actually re-renders the screen with a shorter list - for
 * tests exercising delete's on-screen effect. `refreshItems` (defaults to `initialItems`) is what
 * `refresh()` sets the list back to - it stands in for a real refetch picking the restored item
 * back up, exactly like undoDelete's own `await refresh()` call does against the live server.
 */
function mockUseItemHistoryStateful(
  initialItems: readonly ItemHistoryEntry[],
  refreshItems: readonly ItemHistoryEntry[] = initialItems,
): void {
  jest.mocked(useItemHistory).mockImplementation(() => {
    const [items, setItems] = useState(initialItems);
    return {
      items,
      isLoading: false,
      isRefreshing: false,
      isLoadingMore: false,
      error: null,
      refresh: jest.fn(async () => { setItems(refreshItems); }),
      loadMore: jest.fn(),
      removeItem: (itemId: number) =>
        setItems(previous => previous.filter(item => item.id !== itemId)),
    };
  });
}

// Wrapped in the real AppToastProvider (not mocked) - Delete Undo now shows via the global
// AppToast Host (see useAppToast), so these tests exercise the real Provider and assert on the
// actual UndoToast/ConfirmDialog it renders, exactly as a real app screen would.
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

function getRowElement(renderer: ReactTestRenderer.ReactTestRenderer, item: ItemHistoryEntry) {
  const sectionList = renderer.root.findByType(SectionList);
  // index/section only matter to DateHistoryScreen for the last-item-in-its-section corner
  // rounding (see historyCardLast) - treating every test item as the lone/last item in a
  // single-item section is fine here, since these tests aren't about that rounding.
  const element = sectionList.props.renderItem({ item, index: 0, section: { data: [item] } });
  let rowRenderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    rowRenderer = ReactTestRenderer.create(element);
  });
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

/** The screen's single ConfirmDialog (a Modal) - scoping queries to it avoids colliding with the SectionList's own real (unrelated) swipe-action buttons that happen to share the same accessibilityLabel text ("삭제"). */
function getConfirmDialogButton(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  const dialog = renderer.root.findByType(Modal);
  return dialog.findAll(node => node.props.accessibilityLabel === label)[0];
}

describe('DateHistoryScreen accordion', () => {
  const now = new Date();
  const todayItem = makeItem({ id: 1, title: 'Today item', savedAtUtc: now.toISOString() });
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
  const yesterdayItem = makeItem({ id: 2, title: 'Yesterday item', savedAtUtc: yesterday.toISOString() });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("expands today's section and collapses other sections by default, while always keeping the header count correct", async () => {
    mockUseItemHistory([todayItem, yesterdayItem]);
    const renderer = await renderScreen();

    const sectionList = renderer.root.findByType(SectionList);
    const [todaySection, yesterdaySection] = sectionList.props.sections;

    expect(todaySection.items).toHaveLength(1);
    expect(todaySection.data).toHaveLength(1); // expanded by default
    expect(yesterdaySection.items).toHaveLength(1);
    expect(yesterdaySection.data).toHaveLength(0); // collapsed by default, but count is unaffected
  });

  it('toggles each date section independently', async () => {
    mockUseItemHistory([todayItem, yesterdayItem]);
    const renderer = await renderScreen();

    let sectionList = renderer.root.findByType(SectionList);
    let [todaySection, yesterdaySection] = sectionList.props.sections;

    // Expand yesterday's section without affecting today's.
    const yesterdayHeader = sectionList.props.renderSectionHeader({ section: yesterdaySection });
    await act(async () => {
      yesterdayHeader.props.onPress();
    });

    sectionList = renderer.root.findByType(SectionList);
    [todaySection, yesterdaySection] = sectionList.props.sections;
    expect(todaySection.data).toHaveLength(1);
    expect(yesterdaySection.data).toHaveLength(1);

    // Collapse today's section without affecting yesterday's (now expanded).
    const todayHeader = sectionList.props.renderSectionHeader({ section: todaySection });
    await act(async () => {
      todayHeader.props.onPress();
    });

    sectionList = renderer.root.findByType(SectionList);
    [todaySection, yesterdaySection] = sectionList.props.sections;
    expect(todaySection.data).toHaveLength(0);
    expect(yesterdaySection.data).toHaveLength(1);
  });
});

describe('DateHistoryScreen swipe actions', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // Regression test: SwipeableItemRow's contentPressable used to force flexDirection: 'row' on
  // itself, which stopped the wrapped row content (title/URL/time) from stretching to full width
  // - the title was still technically in the tree but rendered at an effectively invisible width.
  // This confirms the title text actually reaches the rendered tree through the wrapper.
  it('renders the row content (title) through the SwipeableItemRow wrapper', async () => {
    const item = makeItem({ id: 25, title: 'Visible title' });
    mockUseItemHistory([item]);
    const renderer = await renderScreen();

    const row = getRowElement(renderer, item);
    expect(row.root.findByProps({ children: 'Visible title' })).toBeTruthy();
  });

  // Home and History both render saved links through the same SavedLinkRow, so History must get
  // exactly the same domain fallback for title-less items as Home does.
  it('shows a domain fallback (not the raw URL) as the primary text for items without a title', async () => {
    const item = makeItem({ id: 26, title: null, url: 'https://www.youtube.com/watch?v=abc' });
    mockUseItemHistory([item]);
    const renderer = await renderScreen();

    const row = getRowElement(renderer, item);
    expect(row.root.findByProps({ children: 'youtube.com' })).toBeTruthy();
  });

  // History shares SavedLinkRow with Home and now opts into the same effective-thumbnail
  // priority (see DateHistoryScreen's own preferEffectiveThumbnail prop) - a cover set via
  // ItemDetails' drag reorder must be reflected here too, not just on Home, or it would look
  // "undone" the moment the user opens History for the same Item.
  it('prefers the cover image over the first-uploaded representativeImage, matching Home', async () => {
    const item = makeItem({
      id: 27,
      representativeImage: { id: 1, readUrl: 'https://blob.example/first-uploaded.jpg' },
      coverImage: { id: 2, readUrl: 'https://blob.example/cover.jpg' },
    });
    mockUseItemHistory([item]);
    const renderer = await renderScreen();

    const row = getRowElement(renderer, item);
    const images = row.root.findAllByType(require('react-native').Image);
    expect(images.some(node => node.props.source?.uri === 'https://blob.example/cover.jpg')).toBe(true);
    expect(images.some(node => node.props.source?.uri === 'https://blob.example/first-uploaded.jpg')).toBe(false);
  });

  it('shares the item via the swipe share action', async () => {
    const item = makeItem({ id: 21, title: 'Shareable' });
    mockUseItemHistory([item]);
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

  it('deletes only after the ConfirmDialog is accepted, and removes it from the in-memory list immediately', async () => {
    const now = new Date();
    const onlyTodayItem = makeItem({ id: 31, title: 'Only today item', savedAtUtc: now.toISOString() });
    mockUseItemHistoryStateful([onlyTodayItem]);
    jest.mocked(deleteItem).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    const row = getRowElement(renderer, onlyTodayItem);
    revealRow(row);
    const deleteAction = row.root.findAll(node => node.props.accessibilityLabel === '삭제')[0];
    await act(async () => {
      deleteAction.props.onPress();
    });

    expect(deleteItem).not.toHaveBeenCalled();

    await act(async () => {
      getConfirmDialogButton(renderer, '삭제').props.onPress();
    });

    expect(deleteItem).toHaveBeenCalledWith(expect.anything(), onlyTodayItem.id);

    // Deleting the only item in Today's section removes that section entirely rather than
    // leaving an empty one, and the section list no longer carries any data for it.
    const sectionList = renderer.root.findByType(SectionList);
    expect(sectionList.props.sections).toHaveLength(0);
  });

  it('does not delete when the ConfirmDialog is cancelled', async () => {
    const item = makeItem({ id: 41, title: 'Kept' });
    mockUseItemHistory([item]);
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

describe('DateHistoryScreen delete undo', () => {
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

  it('shows the undo toast after a successful delete', async () => {
    const item = makeItem({ id: 51, title: 'Removable' });
    mockUseItemHistoryStateful([item]);
    jest.mocked(deleteItem).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    await deleteViaSwipe(renderer, item);

    expect(renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') })).toBeTruthy();
    // AppToastHost renders above NavigationContainer (root coordinate space), not inside this
    // screen's own scene, so the toast's bottomOffset must be the actual tab bar height (mocked
    // to 80 above), not 0 - 0 would put the toast under the tab bar.
    expect(renderer.root.findByType(UndoToast).props.bottomOffset).toBe(80);
  });

  it('restores the row (via refresh, matching the date section it was saved under) after undo succeeds', async () => {
    const item = makeItem({ id: 52, title: 'Restorable' });
    mockUseItemHistoryStateful([item], [item]);
    jest.mocked(deleteItem).mockResolvedValue(undefined);
    jest.mocked(restoreItem).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    await deleteViaSwipe(renderer, item);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress();
      await Promise.resolve();
    });

    expect(restoreItem).toHaveBeenCalledWith(expect.anything(), item.id);
    const sectionList = renderer.root.findByType(SectionList);
    expect(sectionList.props.sections).toHaveLength(1);
    expect(renderer.root.findAllByProps({ accessibilityLabel: i18n.t('toast.undoAction') })).toHaveLength(0);
  });

  it('keeps the deleted state and shows the shared notice dialog when undo fails', async () => {
    const item = makeItem({ id: 53, title: 'Stuck deleted' });
    mockUseItemHistoryStateful([item]);
    jest.mocked(deleteItem).mockResolvedValue(undefined);
    jest.mocked(restoreItem).mockRejectedValue(new Error('no'));
    const renderer = await renderScreen();

    await deleteViaSwipe(renderer, item);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress();
      await Promise.resolve();
    });

    const sectionList = renderer.root.findByType(SectionList);
    expect(sectionList.props.sections).toHaveLength(0);
    expect(renderer.root.findByProps({ children: i18n.t('toast.undoDeleteError') })).toBeTruthy();
  });

  it('does not send a second restore request while the first undo is still pending', async () => {
    const item = makeItem({ id: 54, title: 'Double tap' });
    mockUseItemHistoryStateful([item]);
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
