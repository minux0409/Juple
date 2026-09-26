import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Text, TextInput } from 'react-native';
import i18n from '../../i18n';
import { CollectionsScreen } from '../CollectionsScreen';
import {
  createCollection,
  getCollections,
  setCollectionFavorite,
  type Collection,
  type GetCollectionsOptions,
} from '../../collections/api/collectionsApi';
import { HeartIcon } from '../../icons/HeartIcon';
import { ChevronIcon } from '../../icons/ChevronIcon';
import { FolderIcon } from '../../icons/FolderIcon';

// A module-level mock (not a fresh `jest.fn()` returned from the factory on every call) so tests
// can assert on it directly - matches the pattern already used for route-prop screens
// (see CollectionDetailsScreen.test.tsx's own `navigation` constant).
const mockNavigate = jest.fn();
const mockSetParams = jest.fn();
const mockNavigation = { navigate: mockNavigate, setParams: mockSetParams };
let mockRouteParams: { refreshToken?: number } | undefined;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: mockRouteParams }),
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

jest.mock('../../collections/api/collectionsApi');

function makeCollection(overrides: Partial<Collection>): Collection {
  return {
    id: 1,
    name: 'Collection',
    isFavorite: false,
    itemCount: 0,
    createdAtUtc: new Date().toISOString(),
    updatedAtUtc: new Date().toISOString(),
    icon: 'Folder',
    color: null,
    ...overrides,
  };
}

const allCollections = [
  makeCollection({ id: 1, name: 'All A', isFavorite: true }),
  makeCollection({ id: 2, name: 'All B', isFavorite: false }),
];
const favoriteCollections = [allCollections[0]];

function setUpGetCollectionsMock(): void {
  jest.mocked(getCollections).mockImplementation(
    async (_request, options: GetCollectionsOptions = {}) => {
      if (options.isFavorite) {
        return { items: favoriteCollections, nextCursor: null };
      }
      return { items: allCollections, nextCursor: null };
    },
  );
}

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<CollectionsScreen />);
  });
  return renderer;
}

describe('CollectionsScreen segmented tabs', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockRouteParams = undefined;
  });

  it('shows only the favorites tab data by default, never both lists at once', async () => {
    setUpGetCollectionsMock();
    const renderer = await renderScreen();

    const flatList = renderer.root.findByType(FlatList);
    expect(flatList.props.data).toEqual(favoriteCollections);
  });

  it('switches to the all tab data without triggering a new network call', async () => {
    setUpGetCollectionsMock();
    const renderer = await renderScreen();

    const callCountBeforeSwitch = jest.mocked(getCollections).mock.calls.length;

    // Matches by the presence of an onPress prop rather than findAllByType(Pressable) - RN's
    // Pressable export and the JSX element's resolved type are not always the exact same
    // reference under this app's Jest/Babel setup, so type-based matching silently returns nothing.
    const segmentPressables = renderer.root
      .findAll(node => typeof node.props.onPress === 'function')
      .filter(node => {
        const label = node.findAllByType(Text)[0]?.props.children;
        return label === '전체 카테고리' || label === 'All categories';
      });
    expect(segmentPressables.length).toBeGreaterThan(0);

    await act(async () => {
      segmentPressables[0].props.onPress();
    });

    const flatList = renderer.root.findByType(FlatList);
    expect(flatList.props.data).toEqual(allCollections);
    // Switching tabs reuses the already-loaded state - no additional getCollections call.
    expect(jest.mocked(getCollections).mock.calls.length).toBe(callCountBeforeSwitch);
  });
});

/** The whole-row Pressable (name + item count), not the separate favorite-star Pressable next to it. */
function findRowPressableByName(renderer: ReactTestRenderer.ReactTestRenderer, name: string) {
  return renderer.root
    .findAll(node => typeof node.props.onPress === 'function')
    .find(node => node.findAllByType(Text).some(textNode => textNode.props.children === name));
}

/** Switches off the default favorites tab to the "all" tab, where non-favorite rows (e.g. All B) render. */
async function switchToAllTab(renderer: ReactTestRenderer.ReactTestRenderer) {
  const allTabPressable = renderer.root
    .findAll(node => typeof node.props.onPress === 'function')
    .find(node => {
      const label = node.findAllByType(Text)[0]?.props.children;
      return label === '전체 카테고리' || label === 'All categories';
    });
  await act(async () => {
    allTabPressable?.props.onPress();
  });
}

describe('CollectionsScreen row', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockRouteParams = undefined;
  });

  it('renders no chevron disclosure icon on any row - the whole row is already the navigation target', async () => {
    setUpGetCollectionsMock();
    const renderer = await renderScreen();

    expect(renderer.root.findAllByType(ChevronIcon)).toHaveLength(0);
  });

  it('tapping a row navigates to that Collection\'s details', async () => {
    setUpGetCollectionsMock();
    const renderer = await renderScreen();
    await switchToAllTab(renderer);

    await act(async () => {
      findRowPressableByName(renderer, 'All B')?.props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('CollectionDetails', { collectionId: 2 });
  });

  it('tapping the favorite star toggles favorite state without navigating', async () => {
    setUpGetCollectionsMock();
    jest.mocked(setCollectionFavorite).mockResolvedValue({ ...allCollections[1], isFavorite: true });
    const renderer = await renderScreen();
    await switchToAllTab(renderer);

    const starButton = renderer.root.findAll(
      node => node.props.accessibilityLabel === i18n.t('collections.addFavorite'),
    )[0];

    await act(async () => {
      await starButton.props.onPress();
    });

    expect(setCollectionFavorite).toHaveBeenCalledWith(expect.anything(), 2, true);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('renders each row\'s own chosen icon, not a single hardcoded glyph', async () => {
    setUpGetCollectionsMock();
    jest.mocked(getCollections).mockImplementation(async () => ({
      items: [makeCollection({ id: 1, name: 'Heart one', icon: 'Heart' })],
      nextCursor: null,
    }));
    const renderer = await renderScreen();

    expect(renderer.root.findAllByType(HeartIcon)).toHaveLength(1);
    expect(renderer.root.findAllByType(FolderIcon)).toHaveLength(0);
  });
});

describe('CollectionsScreen item count', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockRouteParams = undefined;
  });

  function mockSingleCollection(overrides: Partial<Collection>) {
    jest.mocked(getCollections).mockImplementation(async () => ({
      items: [makeCollection({ id: 7, name: 'Counted', ...overrides })],
      nextCursor: null,
    }));
  }

  async function switchToListView(renderer: ReactTestRenderer.ReactTestRenderer) {
    const listToggle = renderer.root.findAll(node => node.props.accessibilityLabel === 'List view' && typeof node.props.onPress === 'function')[0];
    await act(async () => {
      listToggle.props.onPress();
    });
  }

  it('Grid: shows the bare link count as a small non-interactive badge on the tile', async () => {
    mockSingleCollection({ itemCount: 5 });
    const renderer = await renderScreen();

    const badge = renderer.root.findByProps({ testID: 'collection-tile-item-count' });
    expect(badge.findByType(Text).props.children).toBe(5);
    expect(badge.props.onPress).toBeUndefined();
    expect(badge.props.accessibilityLabel).toBe(i18n.t('collections.detailItemCount', { count: 5 }));
  });

  it('Grid: shows 0 for an empty category', async () => {
    mockSingleCollection({ itemCount: 0 });
    const renderer = await renderScreen();

    expect(renderer.root.findByProps({ testID: 'collection-tile-item-count' }).findByType(Text).props.children).toBe(0);
  });

  it('List: shows the localized count as trailing text, separate from the favorite button', async () => {
    mockSingleCollection({ itemCount: 5 });
    const renderer = await renderScreen();
    await switchToListView(renderer);

    const count = renderer.root.findByProps({ testID: 'collection-row-item-count' });
    expect(count.props.children).toBe(i18n.t('collections.detailItemCount', { count: 5 }));
    expect(count.props.onPress).toBeUndefined();
    const starButton = renderer.root.findAll(node => node.props.accessibilityLabel === i18n.t('collections.addFavorite') && typeof node.props.onPress === 'function')[0];
    expect(starButton.findAll(node => node.props.testID === 'collection-row-item-count')).toHaveLength(0);
  });

  it('List: shows 0 for an empty category, and the favorite star still toggles without navigating', async () => {
    mockSingleCollection({ itemCount: 0 });
    jest.mocked(setCollectionFavorite).mockResolvedValue(makeCollection({ id: 7, name: 'Counted', isFavorite: true }));
    const renderer = await renderScreen();
    await switchToListView(renderer);

    expect(renderer.root.findByProps({ testID: 'collection-row-item-count' }).props.children).toBe(i18n.t('collections.detailItemCount', { count: 0 }));

    const starButton = renderer.root.findAll(node => node.props.accessibilityLabel === i18n.t('collections.addFavorite') && typeof node.props.onPress === 'function')[0];
    await act(async () => {
      await starButton.props.onPress();
    });
    expect(setCollectionFavorite).toHaveBeenCalledWith(expect.anything(), 7, true);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('CollectionsScreen create form', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockRouteParams = undefined;
  });

  function openCreateForm(renderer: ReactTestRenderer.ReactTestRenderer) {
    const toggleButton = renderer.root.findAll(
      node => node.props.accessibilityLabel === i18n.t('collections.create'),
    )[0];
    act(() => {
      toggleButton.props.onPress();
    });
  }

  function getSubmitButton(renderer: ReactTestRenderer.ReactTestRenderer) {
    return renderer.root.findAll(
      node =>
        typeof node.props.onPress === 'function' &&
        node.props.accessibilityLabel === i18n.t('collections.createAction'),
    )[0];
  }

  it('defaults the icon picker to Folder and creates with it when nothing else is chosen', async () => {
    setUpGetCollectionsMock();
    jest.mocked(createCollection).mockResolvedValue(makeCollection({ id: 9, name: 'New one' }));
    const renderer = await renderScreen();

    openCreateForm(renderer);
    const nameInput = renderer.root.findByType(TextInput);
    act(() => {
      nameInput.props.onChangeText('New one');
    });

    await act(async () => {
      await getSubmitButton(renderer).props.onPress();
    });

    expect(createCollection).toHaveBeenCalledWith(expect.anything(), 'New one', 'Folder', 'Blue');
  });

  it('creates with whichever icon the user picks from the grid', async () => {
    setUpGetCollectionsMock();
    jest.mocked(createCollection).mockResolvedValue(makeCollection({ id: 9, name: 'Trip', icon: 'Plane' }));
    const renderer = await renderScreen();

    openCreateForm(renderer);
    const nameInput = renderer.root.findByType(TextInput);
    act(() => {
      nameInput.props.onChangeText('Trip');
    });

    const planeCell = renderer.root.findByProps({ testID: 'collection-icon-option-Plane' });
    act(() => {
      planeCell.props.onPress();
    });

    await act(async () => {
      await getSubmitButton(renderer).props.onPress();
    });

    expect(createCollection).toHaveBeenCalledWith(expect.anything(), 'Trip', 'Plane', 'Blue');
  });

  it('creates with whichever color the user picks from the swatch row', async () => {
    setUpGetCollectionsMock();
    jest.mocked(createCollection).mockResolvedValue(makeCollection({ id: 9, name: 'Trip', color: 'Mint' }));
    const renderer = await renderScreen();

    openCreateForm(renderer);
    const nameInput = renderer.root.findByType(TextInput);
    act(() => {
      nameInput.props.onChangeText('Trip');
    });

    const mintSwatch = renderer.root.findByProps({ testID: 'collection-color-option-Mint' });
    act(() => {
      mintSwatch.props.onPress();
    });

    await act(async () => {
      await getSubmitButton(renderer).props.onPress();
    });

    expect(createCollection).toHaveBeenCalledWith(expect.anything(), 'Trip', 'Folder', 'Mint');
  });

  it('resets the icon picker back to Folder after a successful create', async () => {
    setUpGetCollectionsMock();
    jest.mocked(createCollection).mockResolvedValue(makeCollection({ id: 9, name: 'Trip', icon: 'Plane' }));
    const renderer = await renderScreen();

    openCreateForm(renderer);
    let nameInput = renderer.root.findByType(TextInput);
    act(() => {
      nameInput.props.onChangeText('Trip');
    });
    act(() => {
      renderer.root.findByProps({ testID: 'collection-icon-option-Plane' }).props.onPress();
    });
    await act(async () => {
      await getSubmitButton(renderer).props.onPress();
    });

    openCreateForm(renderer);
    nameInput = renderer.root.findByType(TextInput);
    act(() => {
      nameInput.props.onChangeText('Second');
    });
    await act(async () => {
      await getSubmitButton(renderer).props.onPress();
    });

    expect(createCollection).toHaveBeenLastCalledWith(expect.anything(), 'Second', 'Folder', 'Blue');
  });

  it('cancels the create dialog, resetting the draft name/icon/color', async () => {
    setUpGetCollectionsMock();
    const renderer = await renderScreen();

    openCreateForm(renderer);
    let nameInput = renderer.root.findByType(TextInput);
    act(() => {
      nameInput.props.onChangeText('Abandoned');
    });
    act(() => {
      renderer.root.findByProps({ testID: 'collection-icon-option-Plane' }).props.onPress();
    });

    // The header's "+" button becomes a "×" while the form is open - tapping it cancels rather than
    // just hiding the form, so reopening never resumes the abandoned draft.
    const closeButton = renderer.root.findAll(
      node => node.props.accessibilityLabel === i18n.t('common.cancel'),
    )[0];
    act(() => {
      closeButton.props.onPress();
    });
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);

    openCreateForm(renderer);
    nameInput = renderer.root.findByType(TextInput);
    expect(nameInput.props.value).toBe('');

    expect(renderer.root.findByProps({ testID: 'collection-icon-option-Folder' }).props.accessibilityState.selected).toBe(true);
    expect(createCollection).not.toHaveBeenCalled();
  });
});

// Collection Delete Undo (the global AppToast, restoreCollection call, rapid-tap guard, and
// failure ConfirmDialog) is now owned entirely by CollectionDetailsScreen - see that screen's own
// "collection delete undo" tests. This screen no longer shows any Toast of its own; it only ever
// reacts to the refreshToken route param CollectionDetailsScreen bumps right before navigating
// back here (see MainTabs' own Collections param type).
describe('CollectionsScreen refresh signal', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockRouteParams = undefined;
  });

  it('consumes a refreshToken route param (e.g. after a Collection delete/undo elsewhere) by clearing it and refetching', async () => {
    mockRouteParams = { refreshToken: 123 };
    setUpGetCollectionsMock();

    await renderScreen();

    expect(mockSetParams).toHaveBeenCalledWith({ refreshToken: undefined });
    // Once for the focus-driven initial load, once more for the refreshToken-triggered refetch.
    expect(jest.mocked(getCollections).mock.calls.length).toBeGreaterThan(1);
  });
});
