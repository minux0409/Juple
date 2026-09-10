import ReactTestRenderer, { act } from 'react-test-renderer';
import { Alert, FlatList } from 'react-native';
import i18n from '../../i18n';
import { DailyInboxScreen } from '../DailyInboxScreen';

// The react-native-localize jest mock (see jest.config.js) reports "en-US", so i18n would
// otherwise resolve to English by default - pinned to Korean so this file's label assertions are
// deterministic regardless of that mock's default locale.
beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
import { deleteItem, getItemHistoryByDate, type ItemHistoryEntry } from '../../items/api/itemsApi';
import { shareItem } from '../../items/shareItem';

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

jest.mock('../../share/useIncomingShare', () => ({
  useIncomingShare: () => ({ pendingShare: null, acknowledgePendingShare: jest.fn() }),
}));

jest.mock('../../inbox/api/inboxApi', () => ({
  saveInboxEntry: jest.fn(),
}));

jest.mock('../../items/api/itemsApi', () => ({
  getItemHistoryByDate: jest.fn(),
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

function setUpItems(items: readonly ItemHistoryEntry[]): void {
  jest.mocked(getItemHistoryByDate).mockResolvedValue({
    date: '2026-09-10',
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

  it('asks for confirmation before deleting, and only deletes after confirming', async () => {
    const item = makeItem({ id: 9, title: 'Deletable' });
    setUpItems([item]);
    jest.mocked(deleteItem).mockResolvedValue(undefined);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const confirmButton = buttons?.find(button => button.style === 'destructive');
      confirmButton?.onPress?.();
    });
    const renderer = await renderScreen();

    const row = getRowElement(renderer, item);
    const deleteAction = row.root.findAll(node => node.props.accessibilityLabel === '삭제')[0];
    await act(async () => {
      deleteAction.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalled();
    expect(deleteItem).toHaveBeenCalledWith(expect.anything(), item.id);

    alertSpy.mockRestore();
  });

  it('does not delete when the confirmation is cancelled', async () => {
    const item = makeItem({ id: 11, title: 'Kept' });
    setUpItems([item]);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const cancelButton = buttons?.find(button => button.style === 'cancel');
      cancelButton?.onPress?.();
    });
    const renderer = await renderScreen();

    const row = getRowElement(renderer, item);
    const deleteAction = row.root.findAll(node => node.props.accessibilityLabel === '삭제')[0];
    await act(async () => {
      deleteAction.props.onPress();
    });

    expect(deleteItem).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });
});
