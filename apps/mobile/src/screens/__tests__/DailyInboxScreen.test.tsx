jest.mock('../../api/apiConfig', () => ({ apiConfig: { baseUrl: 'https://api.test' } }));
import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Modal, TextInput } from 'react-native';
import i18n from '../../i18n';
import { DailyInboxScreen } from '../DailyInboxScreen';
import { UndoToast } from '../../components/UndoToast';
import { AppToastProvider } from '../../components/AppToast';

// The react-native-localize jest mock (see jest.config.js) reports "en-US", so i18n would
// otherwise resolve to English by default - pinned to Korean so this file's label assertions are
// deterministic regardless of that mock's default locale.
beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
import { deleteItem, getItemHistory, restoreItem, type ItemHistoryEntry } from '../../items/api/itemsApi';
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

function setUpItems(items: readonly ItemHistoryEntry[]): void {
  jest.mocked(getItemHistory).mockResolvedValue({
    items,
    nextCursor: null,
  });
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

describe('DailyInboxScreen delete undo', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  async function deleteViaSwipe(renderer: ReactTestRenderer.ReactTestRenderer, item: ItemHistoryEntry) {
    const row = getRowElement(renderer, item);
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
