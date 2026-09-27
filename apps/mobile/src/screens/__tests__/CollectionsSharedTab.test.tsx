import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Text } from 'react-native';
import i18n from '../../i18n';
import { CollectionsScreen } from '../CollectionsScreen';
import { getCollections, type Collection, type GetCollectionsOptions } from '../../collections/api/collectionsApi';

const mockNavigate = jest.fn();
const mockViewMode = { current: 'grid' as 'grid' | 'list' };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, setParams: jest.fn() }),
  useRoute: () => ({ params: undefined }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
  useBottomTabBarHeight: () => 80,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../../settings/viewModePreference', () => ({
  useViewModePreference: () => ({ viewMode: mockViewMode.current, changeViewMode: jest.fn() }),
}));

jest.mock('../../collections/api/collectionsApi');
jest.mock('../../categories/categorySnapshotSync', () => ({
  syncCategorySnapshotToNative: jest.fn().mockResolvedValue(undefined),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

function makeCollection(overrides: Partial<Collection>): Collection {
  return {
    id: 1,
    name: 'Collection',
    isFavorite: false,
    itemCount: 0,
    createdAtUtc: '2026-01-01T00:00:00Z',
    updatedAtUtc: '2026-01-01T00:00:00Z',
    icon: 'Folder',
    color: null,
    ...overrides,
  };
}

const ownedPlain = makeCollection({ id: 1, name: 'Mine plain', isFavorite: true, accessRole: 'owner' });
const ownedLockedShared = makeCollection({ id: 2, name: 'Mine locked', isFavorite: true, accessRole: 'owner', isLocked: true, hasCollaborators: true });
// Same name as an owned one on purpose - names are only unique per owner.
const sharedLocked = makeCollection({ id: 10, name: 'Mine plain', itemCount: 7, accessRole: 'contributor', isLocked: true, ownerJupleId: 'K7MP4Q8N' });
const sharedOpen = makeCollection({
  id: 11,
  name: 'Trip',
  itemCount: 3,
  accessRole: 'contributor',
  isLocked: false,
  ownerJupleId: 'ABCD2345',
  participantPreview: [{ jupleId: 'ABCD2345', displayName: null, role: 'owner' }],
  otherParticipantCount: 1,
});

function mockLists(shared: readonly Collection[] = [sharedLocked, sharedOpen]) {
  jest.mocked(getCollections).mockImplementation(async (_request, options: GetCollectionsOptions = {}) => {
    const owned = [ownedPlain, ownedLockedShared];
    switch (options.scope) {
      case 'shared':
        return { items: shared, nextCursor: null };
      case 'owned':
        return { items: owned, nextCursor: null };
      case 'favorites':
        return { items: [...owned, ...shared].filter(entry => entry.isFavorite), nextCursor: null };
      default:
        return { items: [...owned, ...shared], nextCursor: null };
    }
  });
}

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<CollectionsScreen />);
  });
  return renderer;
}

async function openFilter(renderer: ReactTestRenderer.ReactTestRenderer, filter: 'owned' | 'shared') {
  await act(async () => {
    renderer.root.findByProps({ testID: `collections-filter-${filter}` }).props.onPress();
  });
}

const openSharedTab = (renderer: ReactTestRenderer.ReactTestRenderer) => openFilter(renderer, 'shared');

function renderRow(renderer: ReactTestRenderer.ReactTestRenderer, item: Collection) {
  const element = renderer.root.findByType(FlatList).props.renderItem({ item, index: 0 });
  let row!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    row = ReactTestRenderer.create(element);
  });
  return row;
}

describe('CollectionsScreen 내 카테고리 / 공유 카테고리', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockViewMode.current = 'grid';
  });

  it('내 카테고리 shows only Categories the server reports as owned (scope=owned)', async () => {
    mockLists();
    const renderer = await renderScreen();
    await openFilter(renderer, 'owned');

    expect(renderer.root.findByProps({ testID: 'collections-filter-owned' }).props.accessibilityState).toEqual({ selected: true });
    const data = renderer.root.findByType(FlatList).props.data as Collection[];
    expect(data.every(entry => entry.accessRole === 'owner')).toBe(true);
    expect(jest.mocked(getCollections)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scope: 'owned' }));
  });

  it('공유 카테고리 lists only Collections shared with me (asked for with scope=shared), including a same-named one', async () => {
    mockLists();
    const renderer = await renderScreen();
    await openSharedTab(renderer);

    expect(renderer.root.findByType(FlatList).props.data).toEqual([sharedLocked, sharedOpen]);
    expect(jest.mocked(getCollections)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scope: 'shared' }));
  });

  it('shows the empty state when nothing is shared with me', async () => {
    mockLists([]);
    const renderer = await renderScreen();
    await openSharedTab(renderer);

    expect(renderer.root.findAllByType(Text).some(node => node.props.children === '공유받은 컬렉션이 없습니다')).toBe(true);
  });

  it.each(['grid', 'list'] as const)('%s: a shared tile shows who else is in it and the item count, and the caller\'s own favorite star', async mode => {
    mockViewMode.current = mode;
    mockLists();
    const renderer = await renderScreen();
    await openSharedTab(renderer);

    const row = renderRow(renderer, sharedOpen);
    const texts = row.root.findAllByType(Text).map(node => node.props.children);
    // No display name set: the Owner's Juple ID stands in.
    expect(texts).toContain('ABCD-2345');
    expect(texts.some(text => String(text).includes('3'))).toBe(true);
    expect(row.root.findAll(node => node.props.accessibilityLabel === i18n.t('collections.addFavorite') && typeof node.props.onPress === 'function')).toHaveLength(1);
  });

  it.each(['grid', 'list'] as const)('%s: lock marker only / shared marker only / both', async mode => {
    mockViewMode.current = mode;
    mockLists();
    const renderer = await renderScreen();

    const badges = (item: Collection) => {
      const row = renderRow(renderer, item);
      return {
        locked: row.root.findAll(node => node.props.testID === 'collection-badge-locked').length > 0,
        shared: row.root.findAll(node => node.props.testID === 'collection-badge-shared').length > 0,
      };
    };

    expect(badges(ownedPlain)).toEqual({ locked: false, shared: false });
    expect(badges(makeCollection({ id: 3, accessRole: 'owner', isLocked: true }))).toEqual({ locked: true, shared: false });
    expect(badges(sharedOpen)).toEqual({ locked: false, shared: true });
    expect(badges(sharedLocked)).toEqual({ locked: true, shared: true });
    expect(badges(ownedLockedShared)).toEqual({ locked: true, shared: true });
  });

  it('opens a shared Category into the same details screen', async () => {
    mockLists();
    const renderer = await renderScreen();
    await openSharedTab(renderer);

    const row = renderRow(renderer, sharedOpen);
    act(() => {
      row.root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function')[0].props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('CollectionDetails', { collectionId: 11 });
  });
});
