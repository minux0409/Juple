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
import { deleteItem, type ItemHistoryEntry } from '../../items/api/itemsApi';
import { shareItem } from '../../items/shareItem';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../items/useItemHistory');

jest.mock('../../items/api/itemsApi', () => ({
  ...jest.requireActual('../../items/api/itemsApi'),
  deleteItem: jest.fn(),
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

/** Backed by real useState so removeItem actually re-renders the screen with a shorter list - for tests exercising delete's on-screen effect. */
function mockUseItemHistoryStateful(initialItems: readonly ItemHistoryEntry[]): void {
  jest.mocked(useItemHistory).mockImplementation(() => {
    const [items, setItems] = useState(initialItems);
    return {
      items,
      isLoading: false,
      isRefreshing: false,
      isLoadingMore: false,
      error: null,
      refresh: jest.fn(),
      loadMore: jest.fn(),
      removeItem: (itemId: number) =>
        setItems(previous => previous.filter(item => item.id !== itemId)),
    };
  });
}

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<DateHistoryScreen />);
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

  it('shares the item via the swipe share action', async () => {
    const item = makeItem({ id: 21, title: 'Shareable' });
    mockUseItemHistory([item]);
    jest.mocked(shareItem).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    const row = getRowElement(renderer, item);
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
