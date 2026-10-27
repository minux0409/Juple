jest.mock('../../api/apiConfig', () => ({ apiConfig: { baseUrl: 'https://api.test' } }));
import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, StyleSheet, Text } from 'react-native';
import i18n from '../../i18n';
import { AppToastProvider } from '../../components/AppToast';
import { ViewModeToggle } from '../../components/ViewModeToggle';
import { ClockIcon } from '../../icons/ClockIcon';
import { SearchIcon } from '../../icons/SearchIcon';
import { setActiveColorScheme } from '../../theme/tokens';
import { HomeIcon } from '../../icons/HomeIcon';
import { SCREEN_TITLE_ICON_SIZE } from '../../components/ScreenTitle';
import { colors } from '../../theme/tokens';
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

describe('Home header', () => {
  it('keeps only the title and count on the 최근 저장 row; the next row holds just the List/Grid/Image switch at the far end - no sort chips', async () => {
    serve(ITEMS);
    const renderer = await renderScreen();

    const toggle = renderer.root.findByType(ViewModeToggle);
    const controlsRow = renderer.root.findAll(node => node.props.testID === 'home-view-controls' && typeof node.type === 'string')[0];
    expect(StyleSheet.flatten(controlsRow.props.style)).toMatchObject({ flexDirection: 'row', marginTop: LINK_CONTROLS_TOP_GAP, marginBottom: LINK_CONTROLS_BOTTOM_GAP });
    const children = controlsRow.children as ReactTestRenderer.ReactTestInstance[];
    expect(children[children.length - 1]).toBe(toggle);
    expect(renderer.root.findAll(node => String(node.props.testID ?? '').startsWith('home-sort'))).toHaveLength(0);
    expect(renderer.root.findAllByType(Text).some(node => ['시간순', '이름순'].includes(String(node.props.children)))).toBe(false);

    // The title row holds the label and count only - no toggle.
    const titleRow = renderer.root.findAll(node => node.props.children === i18n.t('inbox.recentSaved') && typeof node.type === 'string')[0].parent!.parent!;
    expect(titleRow.findAllByType(ViewModeToggle)).toHaveLength(0);
    const texts = titleRow.findAll(node => typeof node.props.children === 'string').map(node => node.props.children);
    expect(texts).toEqual(expect.arrayContaining([i18n.t('inbox.recentSaved'), i18n.t('inbox.recentSavedCount', { count: 4 })]));
  });
});

describe('Home order - always newest first', () => {
  it('shows the server\'s own newest-first order, whatever an older version stored as a sort', async () => {
    for (const stored of [undefined, 'oldest', 'title', 'titleDesc']) {
      mockStore.clear();
      if (stored) {
        mockStore.set('juple.homeLinkSort', stored);
      }
      serve(ITEMS);
      const renderer = await renderScreen();
      expect(order(renderer)).toEqual([1, 2, 3, 4]);
    }
  });

  it('pages in as the list scrolls (no whole-day load for an order)', async () => {
    const many = Array.from({ length: 60 }, (_, index) => item(index + 1, `Link ${String(index + 1).padStart(2, '0')}`, index + 1));
    serve(many);
    const renderer = await renderScreen();
    expect(order(renderer)).toHaveLength(25);
    expect(jest.mocked(getItemHistory)).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ limit: 100 }));
  });

  it('keeps the order when the view mode changes: Grid shows the same order as List', async () => {
    serve(ITEMS);
    const renderer = await renderScreen();
    const listOrder = order(renderer);

    await act(async () => {
      renderer.root.findByType(ViewModeToggle).props.onChange('grid');
    });

    expect(renderer.root.findByType(FlatList).props.numColumns).toBe(2);
    expect(order(renderer)).toEqual(listOrder);
  });
});

describe('Home title icon', () => {
  it('최근 저장 carries a subtle time icon (the same glyph size as other titles), not the home-navigation icon', async () => {
    serve(ITEMS.slice(0, 3));
    const renderer = await renderScreen();

    expect(renderer.root.findAllByType(ClockIcon).length).toBeGreaterThan(0);
    expect(renderer.root.findAllByType(HomeIcon)).toHaveLength(0);
    const glyph = renderer.root.findByType(ClockIcon);
    expect(glyph.props.size).toBe(SCREEN_TITLE_ICON_SIZE);
    expect(glyph.props.color).toBe(colors.brandText);
  });
});

describe('Home URL magnifier', () => {
  afterEach(() => setActiveColorScheme('light'));

  it.each(['light', 'dark'] as const)('is drawn in the brand violet #6751FC itself (not brandText) in %s, even while the field is empty, and is never dimmed', async scheme => {
    setActiveColorScheme(scheme);
    serve(ITEMS.slice(0, 3));
    const renderer = await renderScreen();

    const icon = renderer.root.findByType(SearchIcon);
    expect(icon.props.color).toBe('#6751FC');
    expect(icon.props.color).not.toBe(colors.brandText);
    const button = renderer.root.findAll(node => node.props.accessibilityLabel === '저장' && node.props.accessibilityRole === 'button')[0];
    expect(button.props.disabled).toBe(true);
    let node: typeof icon.parent = icon.parent;
    while (node) {
      expect(StyleSheet.flatten(node.props.style ?? {}).opacity).toBeUndefined();
      node = node.parent;
    }
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
