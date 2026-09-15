import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Modal, TextInput } from 'react-native';
import i18n from '../../i18n';
import { DailyInboxScreen } from '../DailyInboxScreen';

// The react-native-localize jest mock (see jest.config.js) reports "en-US", so i18n would
// otherwise resolve to English by default - pinned to Korean so this file's label assertions are
// deterministic regardless of that mock's default locale.
beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
import { deleteItem, getItemHistory, updateItemDetails, type ItemHistoryEntry } from '../../items/api/itemsApi';
import { shareItem } from '../../items/shareItem';
import { resolveUrlMetadata } from '../../urlMetadata/api/urlMetadataApi';
import { saveInboxEntry } from '../../inbox/api/inboxApi';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => {
      return callback();
    }, [callback]);
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../inbox/api/inboxApi', () => ({
  saveInboxEntry: jest.fn(),
}));

jest.mock('../../items/api/itemsApi', () => ({
  getItemHistory: jest.fn(),
  deleteItem: jest.fn(),
  updateItemDetails: jest.fn(),
  setItemPreviewImage: jest.fn(),
}));

jest.mock('../../items/shareItem', () => ({
  shareItem: jest.fn(),
}));

jest.mock('../../urlMetadata/api/urlMetadataApi', () => ({
  resolveUrlMetadata: jest.fn(),
}));

/** Drains a handful of pending microtask ticks - used to let the fire-and-forget metadata enrichment chain (resolveUrlMetadata -> updateItemDetails -> loadToday) settle after Save, without relying on fake timers. */
async function flushMicrotasks(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

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

function setUpItems(items: readonly ItemHistoryEntry[]): void {
  jest.mocked(getItemHistory).mockResolvedValue({
    items,
    nextCursor: null,
  });
}

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<DailyInboxScreen />);
  });
  return renderer;
}

function getRowElement(renderer: ReactTestRenderer.ReactTestRenderer, item: ItemHistoryEntry) {
  const flatList = renderer.root.findByType(FlatList);
  const element = flatList.props.renderItem({ item });
  let rowRenderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    rowRenderer = ReactTestRenderer.create(element);
  });
  return rowRenderer;
}

/** The screen's single ConfirmDialog (a Modal) - scoping queries to it avoids colliding with the FlatList's own real (unrelated) swipe-action buttons that happen to share the same accessibilityLabel text ("삭제"). */
function getConfirmDialogButton(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  const dialog = renderer.root.findByType(Modal);
  return dialog.findAll(node => node.props.accessibilityLabel === label)[0];
}

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

/** Home's Save button doesn't set accessibilityLabel, so it's found by its label Text, walking up to the nearest onPress-bearing ancestor - mirrors NewLinkReviewScreen.test.tsx's own pressSaveButton helper. */
function pressHomeSaveButton(renderer: ReactTestRenderer.ReactTestRenderer) {
  let node: ReactTestRenderer.ReactTestInstance | null = renderer.root.findAll(
    n => n.props.children === i18n.t('common.save'),
  )[0];
  while (node && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  node!.props.onPress();
}

describe('DailyInboxScreen direct URL save', () => {
  beforeEach(() => {
    setUpItems([]);
    jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: null, source: null, previewImageUrl: null });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('saves the URL and best-effort resolves URL metadata (Home never collects a title itself)', async () => {
    jest.mocked(saveInboxEntry).mockResolvedValue({
      id: 21,
      url: 'https://example.com',
      savedAtUtc: '2026-01-01T00:00:00Z',
    });
    const renderer = await renderScreen();

    const urlInput = renderer.root.findByType(TextInput);
    await act(async () => {
      urlInput.props.onChangeText('https://example.com');
    });

    await act(async () => {
      pressHomeSaveButton(renderer);
      await flushMicrotasks();
    });

    expect(saveInboxEntry).toHaveBeenCalledWith(expect.anything(), 'https://example.com');
    expect(resolveUrlMetadata).toHaveBeenCalledWith(expect.anything(), 'https://example.com');
  });

  it('applies a title resolved from URL metadata in the background, without Save waiting on it', async () => {
    jest.mocked(saveInboxEntry).mockResolvedValue({
      id: 22,
      url: 'https://example.com',
      savedAtUtc: '2026-01-01T00:00:00Z',
    });
    jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: 'Metadata Title', source: 'openGraph', previewImageUrl: null });
    jest.mocked(updateItemDetails).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    const urlInput = renderer.root.findByType(TextInput);
    await act(async () => {
      urlInput.props.onChangeText('https://example.com');
    });

    await act(async () => {
      pressHomeSaveButton(renderer);
      await flushMicrotasks();
    });

    expect(updateItemDetails).toHaveBeenCalledWith(expect.anything(), 22, {
      title: 'Metadata Title',
      memo: '',
    });
  });

  it('save succeeds even when URL metadata resolution fails', async () => {
    jest.mocked(saveInboxEntry).mockResolvedValue({
      id: 23,
      url: 'https://example.com',
      savedAtUtc: '2026-01-01T00:00:00Z',
    });
    jest.mocked(resolveUrlMetadata).mockRejectedValue(new Error('network down'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const renderer = await renderScreen();

    const urlInput = renderer.root.findByType(TextInput);
    await act(async () => {
      urlInput.props.onChangeText('https://example.com');
    });

    await act(async () => {
      pressHomeSaveButton(renderer);
      await flushMicrotasks();
    });

    expect(saveInboxEntry).toHaveBeenCalled();
    expect(updateItemDetails).not.toHaveBeenCalled();
    warnSpy.mockRestore();
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

  it('the recent-saved count reflects the loaded item count', async () => {
    setUpItems([makeItem({ id: 1 }), makeItem({ id: 2 }), makeItem({ id: 3 })]);
    const renderer = await renderScreen();

    expect(renderer.root.findByProps({ children: '3개' })).toBeTruthy();
  });
});

describe('DailyInboxScreen recent-items data source', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // Regression test for the "History shows 3, Home shows 0" bug: Home used to call a dedicated
  // server-side-date-filtered endpoint whose window depended on the User's stored TimeZoneId and
  // could silently return nothing even though items were genuinely saved today. Home now calls the
  // exact same plain, unfiltered feed History uses (getItemHistory), and filters "today" itself -
  // so any item History's own "오늘" section would show must also render here.
  it('fetches from the plain getItemHistory feed (the same source History uses), not a date-scoped endpoint', async () => {
    setUpItems([makeItem({ id: 1 })]);
    await renderScreen();

    expect(getItemHistory).toHaveBeenCalledWith(expect.anything(), { limit: 50 });
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

  // The plain feed is not itself date-filtered server-side, so Home must filter client-side - this
  // is what actually keeps Home in sync with History's own client-side "오늘" bucketing instead of
  // trusting a server date window that (as confirmed for this bug) can be wrong.
  it('excludes items whose SavedAtUtc is not today, even though the feed itself returns them', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const items = [
      makeItem({ id: 1, title: 'Today item' }),
      makeItem({ id: 2, title: 'Yesterday item', savedAtUtc: yesterday.toISOString() }),
    ];
    setUpItems(items);
    const renderer = await renderScreen();

    expect(renderer.root.findByProps({ children: '1개' })).toBeTruthy();
    expect(renderer.root.findAllByProps({ children: 'Today item' }).length).toBeGreaterThan(0);
    expect(renderer.root.findAllByProps({ children: 'Yesterday item' })).toHaveLength(0);
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
