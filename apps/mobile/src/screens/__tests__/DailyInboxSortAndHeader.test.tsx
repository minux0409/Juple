jest.mock('../../api/apiConfig', () => ({ apiConfig: { baseUrl: 'https://api.test' } }));
import AsyncStorage from '@react-native-async-storage/async-storage';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, StyleSheet, Text } from 'react-native';
import i18n from '../../i18n';
import { AppToastProvider } from '../../components/AppToast';
import { LinkSortChips } from '../../components/LinkSortChips';
import { ViewModeToggle } from '../../components/ViewModeToggle';
import { getItemHistory, getItemHistoryCount, type GetItemHistoryOptions, type ItemHistoryEntry } from '../../items/api/itemsApi';
import { LINK_CONTROLS_BOTTOM_GAP, LINK_CONTROLS_TOP_GAP, TITLE_COUNT_GAP } from '../../components/savedLinkLayout';
import { DailyInboxScreen } from '../DailyInboxScreen';

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
  },
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
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
  getItemHistory: jest.fn(),
  getItemHistoryCount: jest.fn(),
  deleteItem: jest.fn(),
  restoreItem: jest.fn(),
}));
jest.mock('../../items/shareItem', () => ({ shareItem: jest.fn() }));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
beforeEach(() => mockStore.clear());

const NOW = new Date();
const item = (id: number, title: string | null, minutesAgo: number): ItemHistoryEntry => ({
  id,
  url: `https://example.com/${id}`,
  title,
  memo: null,
  savedAtUtc: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
  representativeImage: null,
  previewImageUrl: null,
  coverImage: null,
});
// The server's own order: newest first.
const ITEMS = [item(1, 'Cherry', 1), item(2, 'apple', 2), item(3, null, 3), item(4, 'Banana', 4)];

function serve(items: readonly ItemHistoryEntry[]) {
  jest.mocked(getItemHistory).mockImplementation(async (_request, options: GetItemHistoryOptions = {}) => {
    const offset = options.cursor ? Number(options.cursor) : 0;
    const limit = options.limit ?? 50;
    return { items: items.slice(offset, offset + limit), nextCursor: offset + limit < items.length ? String(offset + limit) : null };
  });
  jest.mocked(getItemHistoryCount).mockResolvedValue(items.length);
}

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => mounted.splice(0).forEach(renderer => renderer.unmount()));
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
  mounted.push(renderer);
  return renderer;
}
const order = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  (renderer.root.findByType(FlatList).props.data as ItemHistoryEntry[]).map(entry => entry.id);
const press = async (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => {
  await act(async () => {
    renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0].props.onPress();
  });
};

describe('Home header', () => {
  it('keeps only the title and count on the 최근 저장 row; the sort chips are at the start and List/Grid at the far end of the next row (as in a Collection)', async () => {
    serve(ITEMS);
    const renderer = await renderScreen();

    const toggle = renderer.root.findByType(ViewModeToggle);
    const controlsRow = toggle.parent!;
    expect(StyleSheet.flatten(controlsRow.props.style)).toMatchObject({ flexDirection: 'row', marginTop: LINK_CONTROLS_TOP_GAP, marginBottom: LINK_CONTROLS_BOTTOM_GAP });
    const children = controlsRow.children as ReactTestRenderer.ReactTestInstance[];
    expect(children[0].type).toBe(LinkSortChips);
    expect(children[children.length - 1]).toBe(toggle);

    // The title row holds the label and count only - no toggle.
    const titleRow = renderer.root.findAll(node => node.props.children === i18n.t('inbox.recentSaved') && typeof node.type === 'string')[0].parent!.parent!;
    expect(titleRow.findAllByType(ViewModeToggle)).toHaveLength(0);
    const texts = titleRow.findAll(node => typeof node.props.children === 'string').map(node => node.props.children);
    expect(texts).toEqual(expect.arrayContaining([i18n.t('inbox.recentSaved'), i18n.t('inbox.recentSavedCount', { count: 4 })]));
  });
});

describe('Home sorting (the Collection sort control and rules)', () => {
  it('uses the shared sort control, with 시간순 and 이름순', async () => {
    serve(ITEMS);
    const renderer = await renderScreen();

    expect(renderer.root.findAllByType(LinkSortChips)).toHaveLength(1);
    expect(renderer.root.findByType(LinkSortChips).props.dateLabel).toBe('시간순');
    expect(renderer.root.findByType(LinkSortChips).props.nameLabel).toBe(i18n.t('collections.sortName'));
  });

  it('시간순 keeps the server newest-first order by default, and the arrow flips it to oldest first', async () => {
    serve(ITEMS);
    const renderer = await renderScreen();
    expect(order(renderer)).toEqual([1, 2, 3, 4]);

    await press(renderer, 'home-sort-date');
    expect(order(renderer)).toEqual([4, 3, 2, 1]);
    expect(mockStore.get('juple.homeLinkSort')).toBe('oldest');
  });

  it('이름순 uses the Collection rule: locale-aware, title-less links last', async () => {
    serve(ITEMS);
    const renderer = await renderScreen();

    await press(renderer, 'home-sort-name');
    expect(order(renderer)).toEqual([2, 4, 1, 3]);
    expect(mockStore.get('juple.homeLinkSort')).toBe('title');
  });

  it('loads the whole day (largest pages) before showing a name order - never a partial one', async () => {
    const many = Array.from({ length: 60 }, (_, index) => item(index + 1, `Link ${String(index + 1).padStart(2, '0')}`, index + 1));
    serve(many);
    const renderer = await renderScreen();
    expect(order(renderer)).toHaveLength(25);

    await press(renderer, 'home-sort-name');
    expect(jest.mocked(getItemHistory)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ limit: 100 }));
    expect(order(renderer)).toHaveLength(60);
    expect(order(renderer).slice(0, 3)).toEqual([1, 2, 3]);
  });

  it('keeps the sort when the view mode changes: Grid shows the same order as List', async () => {
    serve(ITEMS);
    const renderer = await renderScreen();
    await press(renderer, 'home-sort-name');
    const listOrder = order(renderer);

    await act(async () => {
      renderer.root.findByType(ViewModeToggle).props.onChange('grid');
    });

    expect(renderer.root.findByType(FlatList).props.numColumns).toBe(2);
    expect(order(renderer)).toEqual(listOrder);
    expect(renderer.root.findByType(LinkSortChips).props.sort).toBe('title');
  });

  it('restores the saved sort next to the saved view mode', async () => {
    mockStore.set('juple.homeLinkSort', 'title');
    mockStore.set('juple.homeViewMode', 'grid');
    serve(ITEMS);
    const renderer = await renderScreen();

    expect(renderer.root.findByType(LinkSortChips).props.sort).toBe('title');
    expect(renderer.root.findByType(FlatList).props.numColumns).toBe(2);
    expect(order(renderer)).toEqual([2, 4, 1, 3]);
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('juple.homeLinkSort');
  });
});

describe('Home title and count', () => {
  it('are one row - "최근 저장  3개": the count right after the title, muted, never a line of its own', async () => {
    serve(ITEMS.slice(0, 3));
    const renderer = await renderScreen();

    const textOf = (label: string) => renderer.root.findAllByType(Text).find(node => node.props.children === label)!;
    const title = textOf(i18n.t('inbox.recentSaved'));
    const count = textOf(i18n.t('inbox.recentSavedCount', { count: 3 }));
    expect(count).toBeTruthy();
    // Same parent (compared as a boolean - never print a fiber graph), and that parent is one non-wrapping row.
    const cluster = title.parent!;
    expect(count.parent === cluster).toBe(true);
    const flat = StyleSheet.flatten(cluster.props.style);
    expect(flat).toMatchObject({ flexDirection: 'row', alignItems: 'baseline', columnGap: TITLE_COUNT_GAP });
    expect(flat.flexWrap).not.toBe('wrap');
    const textChildren = cluster.findAllByType(Text).map(node => node.props.children);
    expect(textChildren).toEqual([i18n.t('inbox.recentSaved'), i18n.t('inbox.recentSavedCount', { count: 3 })]);
    // Primary vs secondary, and the count never shrinks away while a long title does.
    expect(StyleSheet.flatten(title.props.style)).toMatchObject({ fontWeight: '700', flexShrink: 1 });
    expect(StyleSheet.flatten(count.props.style)).toMatchObject({ fontWeight: '500', flexShrink: 0 });
  });
});
