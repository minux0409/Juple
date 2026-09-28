import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Image, StyleSheet, Text, TextInput } from 'react-native';
import { collectionFilterColors } from '../../theme/tokens';
import { resolveCollectionColorTile } from '../../collections/collectionColors';
import i18n from '../../i18n';
import { CollectionsScreen } from '../CollectionsScreen';
import {
  createCollection,
  getCollections,
  setCollectionFavorite,
  type Collection,
  type GetCollectionsOptions,
} from '../../collections/api/collectionsApi';
import {
  acceptCollectionInvitation,
  declineCollectionInvitation,
  getReceivedCollectionInvitations,
  type ReceivedCollectionInvitation,
} from '../../collections/api/collaborationApi';
import { ApiError } from '../../api/ApiError';
import { ReceivedInvitationsSheet } from '../../collections/ReceivedInvitationsSheet';
import { emitSocialPushEvent } from '../../push/pushEvents';
import { HeartIcon } from '../../icons/HeartIcon';
import { ChevronIcon } from '../../icons/ChevronIcon';
import { FolderIcon } from '../../icons/FolderIcon';

// A module-level mock (not a fresh `jest.fn()` returned from the factory on every call) so tests
// can assert on it directly - matches the pattern already used for route-prop screens
// (see CollectionDetailsScreen.test.tsx's own `navigation` constant).
const mockNavigate = jest.fn();
const mockSetParams = jest.fn();
const mockNavigation = { navigate: mockNavigate, setParams: mockSetParams };
let mockRouteParams: { refreshToken?: number; filter?: 'shared'; openShareRequests?: boolean } | undefined;

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
jest.mock('../../collections/api/collaborationApi', () => ({
  ...jest.requireActual('../../collections/api/collaborationApi'),
  getReceivedCollectionInvitations: jest.fn().mockResolvedValue([]),
  acceptCollectionInvitation: jest.fn(),
  declineCollectionInvitation: jest.fn(),
}));

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

const ownedCollection = makeCollection({ id: 1, name: 'All A', isFavorite: true, accessRole: 'owner' });
const sharedCollection = makeCollection({
  id: 2,
  name: 'All B',
  isFavorite: false,
  accessRole: 'contributor',
  ownerJupleId: 'K7MP4Q8N',
  participantPreview: [
    { jupleId: 'K7MP4Q8N', displayName: '피카츄', role: 'owner' },
    { jupleId: 'CNTRB234', displayName: null, role: 'contributor' },
  ],
  otherParticipantCount: 4,
});
const allCollections = [ownedCollection, sharedCollection];
const favoriteCollections = [ownedCollection];

/** The server does the scoping - the screen only ever asks for one scope per filter. */
function setUpGetCollectionsMock(): void {
  jest.mocked(getCollections).mockImplementation(
    async (_request, options: GetCollectionsOptions = {}) => {
      switch (options.scope) {
        case 'favorites':
          return { items: favoriteCollections, nextCursor: null };
        case 'owned':
          return { items: [ownedCollection], nextCursor: null };
        case 'shared':
          return { items: [sharedCollection], nextCursor: null };
        default:
          return { items: allCollections, nextCursor: null };
      }
    },
  );
}

async function selectFilter(renderer: ReactTestRenderer.ReactTestRenderer, filter: string) {
  await act(async () => {
    renderer.root.findByProps({ testID: `collections-filter-${filter}` }).props.onPress();
  });
}

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<CollectionsScreen />);
  });
  return renderer;
}

describe('CollectionsScreen filters', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockRouteParams = undefined;
  });

  it('shows four same-level filters and opens on 즐겨찾기 (favorites), asking the server for scope=favorites', async () => {
    setUpGetCollectionsMock();
    const renderer = await renderScreen();

    for (const filter of ['all', 'favorites', 'owned', 'shared']) {
      expect(renderer.root.findByProps({ testID: `collections-filter-${filter}` })).toBeTruthy();
    }
    expect(renderer.root.findByProps({ testID: 'collections-filter-favorites' }).props.accessibilityState).toEqual({ selected: true });
    expect(renderer.root.findByProps({ testID: 'collections-filter-all' }).props.accessibilityState).toEqual({ selected: false });
    expect(getCollections).toHaveBeenCalledTimes(1);
    expect(getCollections).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scope: 'favorites' }));
    expect(renderer.root.findByType(FlatList).props.data).toEqual(favoriteCollections);
  });

  it('a filter the user picks stays picked - a refocus or re-render never jumps back to 즐겨찾기', async () => {
    setUpGetCollectionsMock();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<CollectionsScreen />);
    });
    await selectFilter(renderer, 'all');
    expect(renderer.root.findByType(FlatList).props.data).toEqual(allCollections);

    await act(async () => {
      renderer.update(<CollectionsScreen />);
    });
    mockRouteParams = { refreshToken: 1 };
    await act(async () => {
      renderer.update(<CollectionsScreen />);
    });

    expect(renderer.root.findByProps({ testID: 'collections-filter-all' }).props.accessibilityState).toEqual({ selected: true });
    expect(getCollections).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ scope: 'all' }));
    expect(renderer.root.findByType(FlatList).props.data).toEqual(allCollections);
  });

  it.each([['all'], ['owned'], ['shared']])(
    'coming back from a Collection (focus, then the delete refreshToken) keeps %s selected and reloads that scope',
    async selected => {
      setUpGetCollectionsMock();
      const renderer = await renderScreen();
      await selectFilter(renderer, selected);

      // CollectionDetails' delete returns to this same screen instance with a refreshToken.
      mockRouteParams = { refreshToken: Date.now() };
      await act(async () => {
        renderer.update(<CollectionsScreen />);
      });

      expect(renderer.root.findByProps({ testID: `collections-filter-${selected}` }).props.accessibilityState).toEqual({ selected: true });
      expect(renderer.root.findByProps({ testID: 'collections-filter-favorites' }).props.accessibilityState).toEqual({ selected: false });
      expect(getCollections).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ scope: selected }));
    },
  );

  it.each([
    ['favorites'],
    ['all'],
    ['owned'],
    ['shared'],
  ])('only the selected filter (%s) is the Collection blue - every other cell light gray - and it still asks for its own scope', async selected => {
    setUpGetCollectionsMock();
    const renderer = await renderScreen();
    const cellStyle = (filter: string) =>
      StyleSheet.flatten(renderer.root.findByProps({ testID: `collections-filter-${filter}` }).props.style);
    const labelStyle = (filter: string) =>
      StyleSheet.flatten(renderer.root.findByProps({ testID: `collections-filter-${filter}` }).findByType(Text).props.style);

    if (selected !== 'favorites') {
      await selectFilter(renderer, selected);
      expect(getCollections).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ scope: selected }));
    }

    for (const filter of ['favorites', 'all', 'owned', 'shared']) {
      const isSelected = filter === selected;
      expect(renderer.root.findByProps({ testID: `collections-filter-${filter}` }).props.accessibilityState).toEqual({ selected: isSelected });
      expect(cellStyle(filter).backgroundColor).toBe(isSelected ? '#EAF1FE' : '#F1F2F4');
      expect(labelStyle(filter).color).toBe(isSelected ? '#5478B0' : '#5F6368');
      expect(labelStyle(filter).fontWeight).toBe(isSelected ? '700' : '600');
    }
    // The selected color is the existing blue Collection tile token (the 'Blue' preset / palette
    // slot 0), resolved from the palette - never looked up from any Collection's name or data.
    expect(cellStyle(selected).backgroundColor).toBe(collectionFilterColors.selectedBackground);
    expect(collectionFilterColors.selectedBackground).toBe(resolveCollectionColorTile('Blue').background);
    expect(collectionFilterColors.selectedText).toBe(resolveCollectionColorTile('Blue').icon);
    // The selected cell is outlined in the default blue folder glyph's color; the others keep the gray border.
    expect(cellStyle(selected).borderColor).toBe(resolveCollectionColorTile('Blue').icon);
    expect(cellStyle(selected).borderColor).toBe('#5478B0');
    expect(cellStyle(selected).borderWidth).toBe(cellStyle(selected === 'favorites' ? 'all' : 'favorites').borderWidth);
    expect(cellStyle(selected === 'favorites' ? 'all' : 'favorites').borderColor).toBe(collectionFilterColors.unselectedBorder);
  });

  it('lays the four filters out as a 2x2 grid of equal cells whose labels may wrap to two lines (never shrunk)', async () => {
    setUpGetCollectionsMock();
    const renderer = await renderScreen();

    const cells = ['favorites', 'all', 'owned', 'shared'].map(filter => renderer.root.findByProps({ testID: `collections-filter-${filter}` }));
    // Row 1: 즐겨찾기 | 전체, row 2: 내 카테고리 | 공유 카테고리 - same parent per row, in that order.
    expect(cells[0].parent).toBe(cells[1].parent);
    expect(cells[2].parent).toBe(cells[3].parent);
    expect(cells[0].parent).not.toBe(cells[2].parent);
    const order = (row: ReactTestRenderer.ReactTestInstance) =>
      row.children.map(child => (typeof child === 'string' ? child : child.props.testID));
    expect(order(cells[0].parent!)).toEqual(['collections-filter-favorites', 'collections-filter-all']);
    expect(order(cells[2].parent!)).toEqual(['collections-filter-owned', 'collections-filter-shared']);
    // 즐겨찾기 is first and the default selection.
    expect(cells[0].props.accessibilityState).toEqual({ selected: true });
    expect(cells[1].props.accessibilityState).toEqual({ selected: false });
    for (const cell of cells) {
      const label = cell.findByType(Text);
      expect(label.props.numberOfLines).toBe(2);
      expect(label.props.adjustsFontSizeToFit).toBeUndefined();
    }
  });

  it('long translations still show all four labels in full (Japanese)', async () => {
    await i18n.changeLanguage('ja');
    try {
      setUpGetCollectionsMock();
      const renderer = await renderScreen();
      const labels = ['all', 'favorites', 'owned', 'shared'].map(filter =>
        renderer.root.findByProps({ testID: `collections-filter-${filter}` }).findByType(Text).props.children);
      expect(labels).toEqual([
        i18n.t('collections.filterAll'),
        i18n.t('collections.favoritesTitle'),
        i18n.t('collections.myCategoriesTab'),
        i18n.t('collections.sharedCategoriesTab'),
      ]);
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('each filter is its own server scope - owned and shared rows are never merged on the client', async () => {
    setUpGetCollectionsMock();
    const renderer = await renderScreen();

    await selectFilter(renderer, 'favorites');
    expect(getCollections).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ scope: 'favorites' }));
    expect(renderer.root.findByType(FlatList).props.data).toEqual(favoriteCollections);

    await selectFilter(renderer, 'owned');
    expect(renderer.root.findByType(FlatList).props.data).toEqual([ownedCollection]);

    await selectFilter(renderer, 'shared');
    expect(getCollections).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ scope: 'shared' }));
    expect(renderer.root.findByType(FlatList).props.data).toEqual([sharedCollection]);
  });

  it('switching back to an already-loaded filter reuses it without another request', async () => {
    setUpGetCollectionsMock();
    const renderer = await renderScreen();
    await selectFilter(renderer, 'shared');
    const calls = jest.mocked(getCollections).mock.calls.length;

    await selectFilter(renderer, 'favorites');

    expect(renderer.root.findByType(FlatList).props.data).toEqual(favoriteCollections);
    expect(jest.mocked(getCollections).mock.calls.length).toBe(calls);
  });

  it('a collaborative Category card no longer lists its participants - only the shared marker says it is shared', async () => {
    setUpGetCollectionsMock();
    const renderer = await renderScreen();
    await selectFilter(renderer, 'all');

    expect(renderer.root.findAll(node => node.props.testID === 'collection-tile-participants')).toHaveLength(0);
    expect(renderer.root.findAllByType(Text).some(node => String(node.props.children).includes('피카츄'))).toBe(false);
    expect(renderer.root.findAll(node => node.props.testID === 'collection-badge-shared').length).toBeGreaterThan(0);
  });

  it('a Contributor can favorite a shared Category too (their own mark)', async () => {
    setUpGetCollectionsMock();
    jest.mocked(setCollectionFavorite).mockResolvedValue({ ...sharedCollection, isFavorite: true });
    const renderer = await renderScreen();
    await selectFilter(renderer, 'shared');

    const star = renderer.root.findAll(
      node => node.props.accessibilityLabel === i18n.t('collections.addFavorite') && typeof node.props.onPress === 'function',
    )[0];
    await act(async () => {
      await star.props.onPress();
    });

    expect(setCollectionFavorite).toHaveBeenCalledWith(expect.anything(), 2, true);
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
    await selectFilter(renderer, 'all');

    await act(async () => {
      findRowPressableByName(renderer, 'All B')?.props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('CollectionDetails', { collectionId: 2 });
  });

  it('tapping the favorite star toggles favorite state without navigating', async () => {
    setUpGetCollectionsMock();
    jest.mocked(setCollectionFavorite).mockResolvedValue({ ...allCollections[1], isFavorite: true });
    const renderer = await renderScreen();
    await selectFilter(renderer, 'all');

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

describe('CollectionsScreen card contents', () => {
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

  const sharedLockedFavorite: Partial<Collection> = {
    itemCount: 5,
    isFavorite: true,
    isLocked: true,
    accessRole: 'contributor',
    ownerJupleId: 'K7MP4Q8N',
    participantPreview: [{ jupleId: 'K7MP4Q8N', displayName: '피카츄', role: 'owner' }],
    otherParticipantCount: 1,
  };

  const texts = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children));

  it.each(['grid', 'list'] as const)('%s: a card shows only icon, name and the favorite / shared / lock markers - no link count, no participant names', async mode => {
    mockSingleCollection(sharedLockedFavorite);
    const renderer = await renderScreen();
    if (mode === 'list') {
      await switchToListView(renderer);
    }

    expect(texts(renderer)).toContain('Counted');
    expect(texts(renderer)).not.toContain('5');
    expect(texts(renderer).some(text => text.includes('피카츄'))).toBe(false);
    expect(texts(renderer)).not.toContain(i18n.t('collections.detailItemCount', { count: 5 }));
    for (const testID of ['collection-tile-item-count', 'collection-row-item-count', 'collection-tile-participants', 'collection-row-participants']) {
      expect(renderer.root.findAll(node => node.props.testID === testID)).toHaveLength(0);
    }
    expect(renderer.root.findAll(node => node.props.testID === 'collection-badge-shared').length).toBeGreaterThan(0);
    expect(renderer.root.findAll(node => node.props.testID === 'collection-badge-locked').length).toBeGreaterThan(0);
    expect(renderer.root.findAll(node => node.props.accessibilityLabel === i18n.t('collections.removeFavorite')).length).toBeGreaterThan(0);
  });

  it.each(['grid', 'list'] as const)('%s: a Collection with its own photo shows the photo as its icon; without one, the built-in icon', async mode => {
    jest.mocked(getCollections).mockImplementation(async () => ({
      items: [
        makeCollection({ id: 7, name: 'With photo', iconImageUrl: 'https://blob.example.test/icon.jpg' }),
        makeCollection({ id: 8, name: 'Without photo' }),
      ],
      nextCursor: null,
    }));
    const renderer = await renderScreen();
    if (mode === 'list') {
      await switchToListView(renderer);
    }

    const images = renderer.root.findAll(node => node.type === Image && node.props.source?.uri === 'https://blob.example.test/icon.jpg');
    expect(images).toHaveLength(1);
    expect(renderer.root.findAll(node => typeof node.type === 'string' && node.props.testID === 'collection-icon-image')).toHaveLength(1);
  });

  it('the favorite star still toggles without navigating', async () => {
    mockSingleCollection({ itemCount: 0 });
    jest.mocked(setCollectionFavorite).mockResolvedValue(makeCollection({ id: 7, name: 'Counted', isFavorite: true }));
    const renderer = await renderScreen();
    await switchToListView(renderer);

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

describe('CollectionsScreen 공유 요청 (received collaboration invitations)', () => {
  const invitation = (invitationId: number, overrides: Partial<ReceivedCollectionInvitation> = {}): ReceivedCollectionInvitation => ({
    invitationId,
    collectionId: 40 + invitationId,
    collectionName: `Trip ${invitationId}`,
    icon: 'Plane',
    color: null,
    ownerJupleId: 'WNER2345',
    ownerDisplayName: null,
    role: 'Contributor',
    createdAtUtc: '2026-01-01T00:00:00Z',
    expiresAtUtc: '2026-01-15T00:00:00Z',
    ...overrides,
  });

  const shareRequestsRow = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root.findAll(node => node.props.testID === 'collections-share-requests' && typeof node.props.onPress === 'function');

  const sheet = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findByType(ReceivedInvitationsSheet);

  async function openShareRequests(renderer: ReactTestRenderer.ReactTestRenderer) {
    await act(async () => {
      shareRequestsRow(renderer)[0].props.onPress();
    });
  }

  beforeEach(() => {
    setUpGetCollectionsMock();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.mocked(getReceivedCollectionInvitations).mockResolvedValue([]);
  });

  it('the 공유 컬렉션 filter carries the pending request count (hidden at 0, 99+ past 99), from the same list as 공유 요청', async () => {
    const badge = (renderer: ReactTestRenderer.ReactTestRenderer) =>
      renderer.root.findAll(node => node.props.testID === 'collections-filter-shared-badge' && typeof node.type === 'string');

    let renderer = await renderScreen();
    expect(badge(renderer)).toHaveLength(0);

    jest.mocked(getReceivedCollectionInvitations).mockResolvedValue([invitation(3), invitation(4)]);
    renderer = await renderScreen();
    expect(badge(renderer)[0].findByType(Text).props.children).toBe('2');

    jest.mocked(getReceivedCollectionInvitations).mockResolvedValue(Array.from({ length: 120 }, (_, index) => invitation(index + 1)));
    renderer = await renderScreen();
    expect(badge(renderer)[0].findByType(Text).props.children).toBe('99+');
  });

  it('a Push while the screen is open refreshes link counts and the request badge - without opening a Collection', async () => {
    const renderer = await renderScreen();
    const collectionsCalls = jest.mocked(getCollections).mock.calls.length;
    const invitationCalls = jest.mocked(getReceivedCollectionInvitations).mock.calls.length;

    await act(async () => {
      emitSocialPushEvent({ type: 'collectionContentChanged', collectionId: 1 });
    });
    expect(jest.mocked(getCollections).mock.calls.length).toBeGreaterThan(collectionsCalls);
    expect(jest.mocked(getReceivedCollectionInvitations).mock.calls.length).toBeGreaterThan(invitationCalls);

    const afterRefresh = jest.mocked(getCollections).mock.calls.length;
    await act(async () => {
      emitSocialPushEvent({ type: 'friendRequest', collectionId: null }); // not this screen's concern
    });
    expect(jest.mocked(getCollections).mock.calls.length).toBe(afterRefresh);
    expect(renderer.root.findAll(node => node.props.testID === 'collections-filter-shared').length).toBeGreaterThan(0);
  });

  it('a tapped invitation Push lands on 공유 컬렉션 with 공유 요청 open', async () => {
    jest.mocked(getReceivedCollectionInvitations).mockResolvedValue([invitation(3)]);
    mockRouteParams = { refreshToken: 5, filter: 'shared', openShareRequests: true };
    const renderer = await renderScreen();

    expect(renderer.root.findByProps({ testID: 'collections-filter-shared' }).props.accessibilityState.selected).toBe(true);
    expect(sheet(renderer).props.visible).toBe(true);
    mockRouteParams = undefined;
  });

  it('with nothing to answer, 공유 카테고리 shows no 공유 요청 row at all', async () => {
    const renderer = await renderScreen();
    await selectFilter(renderer, 'shared');

    expect(shareRequestsRow(renderer)).toHaveLength(0);
  });

  it('shows 공유 요청 with the count at the top of 공유 카테고리 only', async () => {
    jest.mocked(getReceivedCollectionInvitations).mockResolvedValue([invitation(3), invitation(4)]);
    const renderer = await renderScreen();

    expect(shareRequestsRow(renderer)).toHaveLength(0); // not on 전체
    await selectFilter(renderer, 'shared');

    expect(shareRequestsRow(renderer)).toHaveLength(1);
    expect(renderer.root.findByProps({ testID: 'collections-share-requests-count' }).props.children).toBe(2);
    expect(shareRequestsRow(renderer)[0].props.accessibilityLabel).toBe(i18n.t('collections.shareRequestCount', { count: 2 }));
  });

  it('tapping it opens the requests as a sheet: Category, Owner and role, with 거절/수락', async () => {
    jest.mocked(getReceivedCollectionInvitations).mockResolvedValue([invitation(3, { ownerDisplayName: '피카츄' })]);
    const renderer = await renderScreen();
    await selectFilter(renderer, 'shared');
    expect(sheet(renderer).props.visible).toBe(false);

    await openShareRequests(renderer);

    expect(sheet(renderer).props.visible).toBe(true);
    const card = renderer.root.findByProps({ testID: 'share-request-3' });
    const shown = card.findAllByType(Text).map(node => node.props.children);
    expect(shown).toEqual(expect.arrayContaining([
      'Trip 3',
      i18n.t('collections.sharedByOwner', { jupleId: '피카츄' }),
      i18n.t('collaboration.roleContributor'),
    ]));
    expect(renderer.root.findByProps({ testID: 'share-request-accept-3' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: 'share-request-decline-3' })).toBeTruthy();
  });

  it('says what accepting grants: view-only, or collaboration', async () => {
    jest.mocked(getReceivedCollectionInvitations).mockResolvedValue([
      invitation(3, { role: 'Viewer' }),
      invitation(4, { role: 'Contributor' }),
    ]);
    const renderer = await renderScreen();
    await selectFilter(renderer, 'shared');
    await openShareRequests(renderer);

    expect(renderer.root.findByProps({ testID: 'share-request-role-3' }).props.children).toBe(i18n.t('collaboration.roleViewer'));
    expect(renderer.root.findByProps({ testID: 'share-request-role-4' }).props.children).toBe(i18n.t('collaboration.roleContributor'));
    // Plain 읽기 전용 / 링크 추가 가능 - never a "공동작업" concept, an internal role name, or a
    // stronger promise (편집/수정 가능) than a Contributor actually has.
    expect(i18n.getFixedT('ko')('collaboration.roleViewer')).toBe('읽기 전용');
    expect(i18n.getFixedT('ko')('collaboration.roleContributor')).toBe('링크 추가 가능');
  });

  it('a Collection shared view-only shows the shared marker and can be favorited like any other', async () => {
    const viewOnly = makeCollection({ id: 9, name: 'View only', accessRole: 'viewer', ownerJupleId: 'WNER2345' });
    jest.mocked(getCollections).mockImplementation(async () => ({ items: [viewOnly], nextCursor: null }));
    jest.mocked(setCollectionFavorite).mockResolvedValue({ ...viewOnly, isFavorite: true });
    const renderer = await renderScreen();
    await selectFilter(renderer, 'shared');

    expect(renderer.root.findAll(node => node.props.testID === 'collection-badge-shared').length).toBeGreaterThan(0);
    const star = renderer.root.findAll(
      node => node.props.accessibilityLabel === i18n.t('collections.addFavorite') && typeof node.props.onPress === 'function',
    )[0];
    await act(async () => {
      await star.props.onPress();
    });
    expect(setCollectionFavorite).toHaveBeenCalledWith(expect.anything(), 9, true);
  });

  it('accepting removes the request, lowers the count and reloads 공유 카테고리 so the Category shows at once', async () => {
    jest.mocked(getReceivedCollectionInvitations).mockResolvedValue([invitation(3), invitation(4)]);
    jest.mocked(acceptCollectionInvitation).mockResolvedValue(undefined);
    const renderer = await renderScreen();
    await selectFilter(renderer, 'shared');
    await openShareRequests(renderer);

    const joined = makeCollection({ id: 43, name: 'Trip 3', accessRole: 'contributor' });
    jest.mocked(getCollections).mockImplementation(async (_request, options: GetCollectionsOptions = {}) =>
      options.scope === 'shared' ? { items: [sharedCollection, joined], nextCursor: null } : { items: allCollections, nextCursor: null });
    const sharedCallsBefore = jest.mocked(getCollections).mock.calls.filter(call => call[1]?.scope === 'shared').length;

    await act(async () => {
      await renderer.root.findByProps({ testID: 'share-request-accept-3' }).props.onPress();
    });

    expect(acceptCollectionInvitation).toHaveBeenCalledWith(expect.anything(), 3);
    expect(renderer.root.findAll(node => node.props.testID === 'share-request-3')).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: 'collections-share-requests-count' }).props.children).toBe(1);
    expect(jest.mocked(getCollections).mock.calls.filter(call => call[1]?.scope === 'shared').length).toBe(sharedCallsBefore + 1);
    expect(renderer.root.findByType(FlatList).props.data).toEqual([sharedCollection, joined]);
    expect(sheet(renderer).props.visible).toBe(true); // one more to answer
  });

  it('declining the last request removes it, closes the sheet and hides the row', async () => {
    jest.mocked(getReceivedCollectionInvitations).mockResolvedValue([invitation(4)]);
    jest.mocked(declineCollectionInvitation).mockResolvedValue(undefined);
    const renderer = await renderScreen();
    await selectFilter(renderer, 'shared');
    await openShareRequests(renderer);
    const sharedCallsBefore = jest.mocked(getCollections).mock.calls.length;

    await act(async () => {
      await renderer.root.findByProps({ testID: 'share-request-decline-4' }).props.onPress();
    });

    expect(declineCollectionInvitation).toHaveBeenCalledWith(expect.anything(), 4);
    expect(acceptCollectionInvitation).not.toHaveBeenCalled();
    expect(sheet(renderer).props.visible).toBe(false);
    expect(shareRequestsRow(renderer)).toHaveLength(0);
    expect(jest.mocked(getCollections).mock.calls.length).toBe(sharedCallsBefore); // nothing joined, nothing to reload
  });

  it('an invitation that is no longer valid says so and the list is reloaded', async () => {
    jest.mocked(getReceivedCollectionInvitations).mockResolvedValue([invitation(3)]);
    jest.mocked(acceptCollectionInvitation).mockRejectedValue(new ApiError('conflict', 409, 'invitationNotPending'));
    const renderer = await renderScreen();
    await selectFilter(renderer, 'shared');
    await openShareRequests(renderer);
    const loadsBefore = jest.mocked(getReceivedCollectionInvitations).mock.calls.length;

    await act(async () => {
      await renderer.root.findByProps({ testID: 'share-request-accept-3' }).props.onPress();
    });

    expect(renderer.root.findByProps({ testID: 'share-requests-sheet' }).findAllByType(Text).map(node => node.props.children))
      .toContain(i18n.t('collaboration.invitationNoLongerValid'));
    expect(jest.mocked(getReceivedCollectionInvitations).mock.calls.length).toBe(loadsBefore + 1);
  });
});
