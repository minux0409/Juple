import ReactTestRenderer, { act } from 'react-test-renderer';
import { SectionList } from 'react-native';
import '../../i18n';
import { DateHistoryScreen } from '../DateHistoryScreen';
import { useItemHistory, type UseItemHistoryResult } from '../../items/useItemHistory';
import type { ItemHistoryEntry } from '../../items/api/itemsApi';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../items/useItemHistory');

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

function mockUseItemHistory(items: readonly ItemHistoryEntry[]): void {
  jest.mocked(useItemHistory).mockReturnValue({
    items,
    isLoading: false,
    isRefreshing: false,
    isLoadingMore: false,
    error: null,
    refresh: jest.fn(),
    loadMore: jest.fn(),
  } satisfies UseItemHistoryResult);
}

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<DateHistoryScreen />);
  });
  return renderer;
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
