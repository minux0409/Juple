import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Text } from 'react-native';
import i18n from '../../i18n';
import { CollectionsScreen } from '../CollectionsScreen';
import {
  getCollections,
  setCollectionFavorite,
  type Collection,
  type GetCollectionsOptions,
} from '../../collections/api/collectionsApi';
import { ChevronIcon } from '../../icons/ChevronIcon';

// A module-level mock (not a fresh `jest.fn()` returned from the factory on every call) so tests
// can assert on it directly - matches the pattern already used for route-prop screens
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

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
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
  });

  it('shows only the "all" tab data by default, never both lists at once', async () => {
    setUpGetCollectionsMock();
    const renderer = await renderScreen();

    const flatList = renderer.root.findByType(FlatList);
    expect(flatList.props.data).toEqual(allCollections);
  });

  it('switches to the favorites tab data without triggering a new network call', async () => {
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
        return label === '즐겨찾기' || label === 'Favorites';
      });
    expect(segmentPressables.length).toBeGreaterThan(0);

    await act(async () => {
      segmentPressables[0].props.onPress();
    });

    const flatList = renderer.root.findByType(FlatList);
    expect(flatList.props.data).toEqual(favoriteCollections);
    // Switching tabs reuses the already-loaded favorites state - no additional getCollections call.
    expect(jest.mocked(getCollections).mock.calls.length).toBe(callCountBeforeSwitch);
  });
});

/** The whole-row Pressable (name + item count), not the separate favorite-star Pressable next to it. */
function findRowPressableByName(renderer: ReactTestRenderer.ReactTestRenderer, name: string) {
  return renderer.root
    .findAll(node => typeof node.props.onPress === 'function')
    .find(node => node.findAllByType(Text).some(textNode => textNode.props.children === name));
}

describe('CollectionsScreen row', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders no chevron disclosure icon on any row - the whole row is already the navigation target', async () => {
    setUpGetCollectionsMock();
    const renderer = await renderScreen();

    expect(renderer.root.findAllByType(ChevronIcon)).toHaveLength(0);
  });

  it('tapping a row navigates to that Collection\'s details', async () => {
    setUpGetCollectionsMock();
    const renderer = await renderScreen();

    await act(async () => {
      findRowPressableByName(renderer, 'All B')?.props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('CollectionDetails', { collectionId: 2 });
  });

  it('tapping the favorite star toggles favorite state without navigating', async () => {
    setUpGetCollectionsMock();
    jest.mocked(setCollectionFavorite).mockResolvedValue({ ...allCollections[1], isFavorite: true });
    const renderer = await renderScreen();

    const starButton = renderer.root.findAll(
      node => node.props.accessibilityLabel === i18n.t('collections.addFavorite'),
    )[0];

    await act(async () => {
      await starButton.props.onPress();
    });

    expect(setCollectionFavorite).toHaveBeenCalledWith(expect.anything(), 2, true);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
