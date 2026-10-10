import { BrokenLinkIcon } from '../../icons/BrokenLinkIcon';
import { LoadFailureState } from '../../components/LoadFailureState';
import { RefreshFailureNotice } from '../../components/RefreshFailureNotice';
import { InfoIcon } from '../../icons/InfoIcon';
import { KeyIcon } from '../../icons/KeyIcon';
import { ApprovalSubmissionSheet } from '../../collections/ApprovalSubmissionSheet';
import { CollectionStatusBadges } from '../../collections/CollectionStatusBadges';
import { CrownIcon } from '../../icons/CrownIcon';
import { StarIcon } from '../../icons/StarIcon';
import { PendingActionRow } from '../../components/PendingActionRow';
import { radii, spacing } from '../../theme/tokens';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Dimensions, FlatList, Image, StyleSheet, Text, TextInput } from 'react-native';
import { colors } from '../../theme/tokens';
import { collectionFilterColors } from '../../theme/tokens';
import { resolveCollectionColorTile } from '../../collections/collectionColors';
import i18n from '../../i18n';
import { CategoryIconTile } from '../../collections/CategoryIconTile';
import { CollectionsScreen } from '../CollectionsScreen';
import {
  createCollection,
  getCollections,
  getMyPendingSubmissionTotal,
  listMyJoinRequests,
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
import { emitCollectionNewLinksRead } from '../../notifications/notificationState';
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
  jest.mocked(getMyPendingSubmissionTotal).mockResolvedValue(0);
  jest.mocked(listMyJoinRequests).mockResolvedValue([]);
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
    // The only folder glyph left is the screen title's own navigation icon, never a card's.
    expect(renderer.root.findAllByType(FolderIcon)).toHaveLength(1);
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

  it.each(['grid', 'list'] as const)('%s: a share password puts no key badge on the icon - the Collection lock keeps its own badge', async mode => {
    mockSingleCollection({ ...sharedLockedFavorite, accessRole: 'owner', isSharePasswordProtected: true });
    const renderer = await renderScreen();
    if (mode === 'list') {
      await switchToListView(renderer);
    }

    expect(renderer.root.findAllByType(KeyIcon)).toHaveLength(0);
    expect(renderer.root.findAll(node => node.props.testID === 'collection-badge-share-password')).toHaveLength(0);
    expect(renderer.root.findAll(node => typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.includes('공유 비밀번호'))).toHaveLength(0);
    expect(renderer.root.findAll(node => node.props.testID === 'collection-badge-locked').length).toBeGreaterThan(0);
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
    // Plain 읽기 전용 / 링크 추가 - never a "공동작업" concept, an internal role name, or a
    // stronger promise (편집/수정 가능) than a Contributor actually has.
    expect(i18n.getFixedT('ko')('collaboration.roleViewer')).toBe('읽기 전용');
    expect(i18n.getFixedT('ko')('collaboration.roleContributor')).toBe('링크 추가');
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

describe('CollectionsScreen large lists', () => {
  beforeEach(() => {
    // The platform image cache: warming a photo resolves (or fails) on its own.
    jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockRouteParams = undefined;
  });

  /** 300 Collections (every one with a photo), paged by the server like GET /collections: offset cursor, `limit` per page, per scope. */
  const many = Array.from({ length: 300 }, (_, index) => makeCollection({
    id: index + 1,
    name: `Collection ${index + 1}`,
    isFavorite: true,
    itemCount: index,
    iconImageUrl: `https://blob.example/icon-${index + 1}.jpg?sig=${index}`,
    iconImageVersion: `v${index + 1}`,
  }));
  function serveMany(): void {
    jest.mocked(getCollections).mockImplementation(async (_request, options: GetCollectionsOptions = {}) => {
      const offset = options.cursor ? Number(options.cursor) : 0;
      const limit = options.limit ?? 50;
      return { items: many.slice(offset, offset + limit), nextCursor: offset + limit < many.length ? String(offset + limit) : null };
    });
  }
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
      resolve = done;
    });
    return { promise, resolve };
  }
  const list = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findByType(FlatList);
  const skeletons = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root.findAll(node => node.props.testID === 'collections-skeleton' && typeof node.type === 'string');

  const photoImages = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root.findAllByType(Image).filter(node => String(node.props.source?.uri ?? '').startsWith('https://blob.example/'));
  const mountedCards = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root.findAll(node => typeof node.props.collectionId === 'number' && node.props.imageVersion !== undefined && typeof node.type !== 'string');

  it('with 300 Collections, asks for one page of card metadata only and mounts only a window of cards - each photo loads only with its mounted card, nothing prefetched', async () => {
    serveMany();
    const renderer = await renderScreen();

    expect(getCollections).toHaveBeenCalledTimes(1);
    expect(getCollections).toHaveBeenCalledWith(expect.anything(), { scope: 'favorites', limit: 24 });
    expect(list(renderer).props.data).toHaveLength(24);
    // Only a window of cards is mounted (initialNumToRender counts grid rows of 4 cards)...
    expect(mountedCards(renderer).length).toBeLessThanOrEqual(list(renderer).props.initialNumToRender * 4);
    expect(mountedCards(renderer).length).toBeLessThan(24);
    // ...and exactly those cards show their photos - the rest of the page requests nothing.
    expect(photoImages(renderer).map(node => node.props.source.uri).sort())
      .toEqual(mountedCards(renderer).map(node => node.props.imageUrl).sort());
    expect(Image.prefetch).not.toHaveBeenCalled();
  });

  describe('responsive columns (phone 4; tablets grow with the width)', () => {
    // Inside act: a window change reaches every renderer a file left mounted, and those updates must not run outside act.
    const setWindow = (width: number, height: number) => act(() => { Dimensions.set({ window: { ...Dimensions.get('window'), width, height } }); });
    const PHONE_PORTRAIT = [411, 1334] as const;
    afterEach(() => setWindow(...PHONE_PORTRAIT));

    it('the Grid follows the window width live and keeps every Collection (the list remounts for a new column count)', async () => {
      jest.mocked(getMyPendingSubmissionTotal).mockResolvedValue(0); // the focus effect re-runs on a re-render
      serveMany();
      const renderer = await renderScreen();
      expect(list(renderer).props.numColumns).toBe(4);
      const cardsBefore = list(renderer).props.data.length;

      await act(async () => {
        setWindow(891, 411); // phone landscape: still a phone
      });
      expect(list(renderer).props.numColumns).toBe(4);
      await act(async () => {
        setWindow(600, 960);
      });
      expect(list(renderer).props.numColumns).toBe(5);
      await act(async () => {
        setWindow(800, 1280);
      });
      expect(list(renderer).props.numColumns).toBe(6);
      await act(async () => {
        setWindow(1280, 800);
      });
      expect(list(renderer).props.numColumns).toBe(8);
      expect(list(renderer).props.data).toHaveLength(cardsBefore);
      await act(async () => {
        setWindow(...PHONE_PORTRAIT);
      });
      expect(list(renderer).props.numColumns).toBe(4);
    });
  });

  it('scrolling loads the next page of card metadata only - photos still follow the mounted cards, never a whole page ahead', async () => {
    serveMany();
    const renderer = await renderScreen();

    await act(async () => {
      list(renderer).props.onEndReached();
    });

    expect(list(renderer).props.data).toHaveLength(48);
    expect(Image.prefetch).not.toHaveBeenCalled();
    expect(photoImages(renderer).length).toBe(mountedCards(renderer).length);
    expect(photoImages(renderer).length).toBeLessThan(48);
  });

  it('a failing image API can never cost a page of Collections (regression)', async () => {
    jest.mocked(Image.prefetch).mockImplementation(() => {
      throw new Error('image module unavailable');
    });
    serveMany();
    const renderer = await renderScreen();

    await act(async () => {
      list(renderer).props.onEndReached();
    });

    expect(list(renderer).props.data).toHaveLength(48);
    expect(renderer.root.findAllByProps({ children: i18n.t('collections.errorListFallback') })).toHaveLength(0);
  });

  it('loads the next page as the end comes into reach - once, with skeleton cards only while it is on its way, and never past the last page', async () => {
    serveMany();
    const renderer = await renderScreen();
    // More exist, but nothing is being requested: no skeleton.
    expect(skeletons(renderer)).toHaveLength(0);

    const pending = deferred<{ items: Collection[]; nextCursor: string | null }>();
    jest.mocked(getCollections).mockImplementationOnce(() => pending.promise);
    await act(async () => {
      list(renderer).props.onEndReached();
      list(renderer).props.onEndReached();
    });
    expect(getCollections).toHaveBeenCalledTimes(2);
    expect(jest.mocked(getCollections).mock.calls[1][1]).toEqual({ scope: 'favorites', limit: 24, cursor: '24' });
    expect(skeletons(renderer).length).toBeGreaterThan(0);

    await act(async () => {
      pending.resolve({ items: many.slice(24, 48), nextCursor: '48' });
    });
    expect(skeletons(renderer)).toHaveLength(0);
    expect(list(renderer).props.data.map((collection: Collection) => collection.id)).toEqual(many.slice(0, 48).map(collection => collection.id));

    jest.mocked(getCollections).mockResolvedValueOnce({ items: many.slice(48, 60), nextCursor: null });
    await act(async () => {
      list(renderer).props.onEndReached();
    });
    await act(async () => {
      list(renderer).props.onEndReached();
    });
    expect(getCollections).toHaveBeenCalledTimes(3);
  });

  it('switching filters starts that filter from its first page, and a late page of the previous filter never lands on it', async () => {
    serveMany();
    const renderer = await renderScreen();
    const late = deferred<{ items: Collection[]; nextCursor: string | null }>();
    jest.mocked(getCollections).mockImplementationOnce(() => late.promise);
    await act(async () => {
      list(renderer).props.onEndReached();
    });

    await selectFilter(renderer, 'owned');
    const ownedCall = jest.mocked(getCollections).mock.calls.slice(-1)[0][1];
    expect(ownedCall).toEqual({ scope: 'owned', limit: 24 });

    await act(async () => {
      late.resolve({ items: [makeCollection({ id: 999, name: 'Late favorite' })], nextCursor: null });
    });
    expect(list(renderer).props.data.some((collection: Collection) => collection.id === 999)).toBe(false);
    expect(renderer.root.findByProps({ testID: 'collections-filter-owned' }).props.accessibilityState).toEqual({ selected: true });
  });

  it('a refresh reloads as many cards as the filter shows - it never shrinks back to the first page', async () => {
    serveMany();
    const renderer = await renderScreen();
    await act(async () => {
      list(renderer).props.onEndReached();
    });
    expect(list(renderer).props.data).toHaveLength(48);

    await act(async () => {
      list(renderer).props.refreshControl.props.onRefresh();
    });

    expect(jest.mocked(getCollections).mock.calls.slice(-1)[0][1]).toEqual({ scope: 'favorites', limit: 48 });
    expect(list(renderer).props.data).toHaveLength(48);
  });

  it('shows skeleton cards (not a spinner) while a filter\'s first page loads', async () => {
    const pending = deferred<{ items: Collection[]; nextCursor: string | null }>();
    jest.mocked(getCollections).mockImplementationOnce(() => pending.promise);
    const renderer = await renderScreen();

    expect(skeletons(renderer).length).toBeGreaterThan(0);
    await act(async () => {
      pending.resolve({ items: many.slice(0, 3), nextCursor: null });
    });
    expect(skeletons(renderer)).toHaveLength(0);
    expect(list(renderer).props.data).toHaveLength(3);
  });
});

describe('CollectionsScreen attention badge (approvals waiting + unread new links)', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockRouteParams = undefined;
  });

  async function renderIn(mode: 'grid' | 'list', collections: Collection[]) {
    jest.mocked(getCollections).mockImplementation(async () => ({ items: collections, nextCursor: null }));
    const renderer = await renderScreen();
    if (mode === 'list') {
      const listToggle = renderer.root.findAll(node => node.props.accessibilityLabel === 'List view' && typeof node.props.onPress === 'function')[0];
      await act(async () => {
        listToggle.props.onPress();
      });
    }
    return renderer;
  }

  const badgeText = (renderer: ReactTestRenderer.ReactTestRenderer, id: number) =>
    renderer.root
      .findAll(node => node.props.testID === `collection-attention-${id}` && typeof node.type === 'string')
      .flatMap(node => node.findAllByType(Text).map(text => String(text.props.children)));

  it.each(['grid', 'list'] as const)('%s: shows the count (hidden at 0, 99+ past 99) and says the full count', async mode => {
    const renderer = await renderIn(mode, [
      makeCollection({ id: 1, name: 'A', accessRole: 'owner', pendingSubmissionCount: 2, unreadNewLinkCount: 3, attentionCount: 5 }),
      makeCollection({ id: 2, name: 'B', accessRole: 'contributor', unreadNewLinkCount: 1, attentionCount: 1 }),
      makeCollection({ id: 3, name: 'Quiet', accessRole: 'owner', attentionCount: 0 }),
      makeCollection({ id: 4, name: 'Busy', accessRole: 'owner', pendingSubmissionCount: 20, unreadNewLinkCount: 100, attentionCount: 120 }),
    ]);

    expect(badgeText(renderer, 1)).toEqual(['5']);
    expect(badgeText(renderer, 2)).toEqual(['1']);
    expect(badgeText(renderer, 3)).toEqual([]);
    expect(badgeText(renderer, 4)).toEqual(['99+']);
    const labels = renderer.root.findAll(node => typeof node.props.onPress === 'function' && typeof node.props.accessibilityLabel === 'string')
      .map(node => node.props.accessibilityLabel);
    // Owned Collections say so in their spoken label (the crown itself is decorative); one of someone else's stays as it was.
    expect(labels).toContain(`${i18n.t('collections.myCategoriesTab')}, ${i18n.t('collections.attentionA11y', { name: 'Busy', count: 120 })}`);
    expect(labels).toContain(`${i18n.t('collections.myCategoriesTab')}, ${i18n.t('collections.attentionA11y', { name: 'A', count: 5 })}`);
    expect(labels).toContain(i18n.t('collections.attentionA11y', { name: 'B', count: 1 }));
  });

  it('the badge is not a button of its own - tapping the card opens the Collection as before', async () => {
    const renderer = await renderIn('grid', [makeCollection({ id: 1, name: 'A', accessRole: 'owner', attentionCount: 2, unreadNewLinkCount: 2 })]);

    expect(renderer.root.findAll(node => node.props.testID === 'collection-attention-1' && typeof node.props.onPress === 'function')).toHaveLength(0);
    const card = renderer.root.findAll(node => node.props.accessibilityLabel === `${i18n.t('collections.myCategoriesTab')}, ${i18n.t('collections.attentionA11y', { name: 'A', count: 2 })}` && typeof node.props.onPress === 'function')[0];
    await act(async () => {
      card.props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('CollectionDetails', { collectionId: 1 });
  });

  it('opening a Collection clears its new-link part at once; its waiting approvals stay', async () => {
    const renderer = await renderIn('grid', [
      makeCollection({ id: 1, name: 'A', accessRole: 'owner', pendingSubmissionCount: 2, unreadNewLinkCount: 3, attentionCount: 5 }),
      makeCollection({ id: 2, name: 'B', accessRole: 'owner', unreadNewLinkCount: 1, attentionCount: 1 }),
    ]);

    act(() => emitCollectionNewLinksRead(1));
    act(() => emitCollectionNewLinksRead(2));

    expect(badgeText(renderer, 1)).toEqual(['2']);
    expect(badgeText(renderer, 2)).toEqual([]);
  });

  it('a 새 링크 or 승인 요청 Push while open refreshes the badges; a reaction or comment does not', async () => {
    await renderIn('grid', [makeCollection({ id: 1, name: 'A', accessRole: 'owner' })]);
    const before = jest.mocked(getCollections).mock.calls.length;

    act(() => emitSocialPushEvent({ type: 'collectionItemReaction', collectionId: 1 }));
    act(() => emitSocialPushEvent({ type: 'collectionItemComment', collectionId: 1 }));
    expect(jest.mocked(getCollections).mock.calls.length).toBe(before);

    // (Earlier tests' screens may still be mounted - so only 'none' vs 'at least one' is asserted.)
    await act(async () => emitSocialPushEvent({ type: 'collectionLinkSubmission', collectionId: 1 }));
    const afterSubmission = jest.mocked(getCollections).mock.calls.length;
    expect(afterSubmission).toBeGreaterThan(before);
    await act(async () => emitSocialPushEvent({ type: 'collectionItemsAdded', collectionId: 1 }));
    expect(jest.mocked(getCollections).mock.calls.length).toBeGreaterThan(afterSubmission);
  });
});

describe('CollectionsScreen - 내 승인 대기 (a popup of my waiting links, not a filter)', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockRouteParams = undefined;
  });

  const normal = [makeCollection({ id: 1, name: 'Plain', accessRole: 'owner' }), makeCollection({ id: 2, name: 'Shared', accessRole: 'submitter' })];

  async function renderIn(mode: 'grid' | 'list', total: number) {
    jest.mocked(getMyPendingSubmissionTotal).mockResolvedValue(total);
    jest.mocked(getCollections).mockImplementation(async () => ({ items: normal, nextCursor: null }));
    const renderer = await renderScreen();
    if (mode === 'list') {
      const listToggle = renderer.root.findAll(node => node.props.accessibilityLabel === 'List view' && typeof node.props.onPress === 'function')[0];
      await act(async () => {
        listToggle.props.onPress();
      });
    }
    return renderer;
  }
  const button = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root.findAll(node => node.props.testID === 'collections-filter-my-pending' && typeof node.props.onPress === 'function')[0];
  const buttonText = (renderer: ReactTestRenderer.ReactTestRenderer) => button(renderer)?.findAllByType(Text).map(text => String(text.props.children));
  const sheet = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findByType(ApprovalSubmissionSheet);
  // The screen's own list - the open popup has a list of its own (testID approval-sheet-list).
  const shownIds = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    (renderer.root.findAllByType(FlatList).find(list => list.props.testID !== 'approval-sheet-list')!.props.data as Collection[]).map(collection => collection.id);
  const filterCell = (renderer: ReactTestRenderer.ReactTestRenderer, option: string) =>
    renderer.root.findAll(node => node.props.testID === `collections-filter-${option}` && typeof node.props.onPress === 'function')[0];

  it('nothing is attached to the 공유 컬렉션 tab any more - it is the plain tab', async () => {
    const renderer = await renderIn('grid', 5);

    expect(renderer.root.findAll(node => node.props.testID === 'collections-filter-shared-my-pending')).toHaveLength(0);
    expect(filterCell(renderer, 'shared').props.accessibilityLabel).toBeUndefined();
    expect(filterCell(renderer, 'shared').findAllByType(Text).map(text => String(text.props.children))).toEqual([i18n.t('collections.sharedCategoriesTab')]);
  });

  it('a full-width 내 승인 대기 N row sits right under the four filters, in the shared blue 승인 대기 style, a plain button (not a tab), hidden at 0', async () => {
    expect(button(await renderIn('grid', 0))).toBeUndefined();

    const renderer = await renderIn('grid', 3);
    expect(buttonText(renderer)).toEqual([i18n.t('collections.myPendingSubmissions', { count: '3' })]);
    expect(button(renderer).props.accessibilityLabel).toBe(i18n.t('collections.myPendingA11y', { count: 3 }));
    const shared = button(renderer);
    const entry = shared.findAll(node => node.props.accessibilityRole === 'button' && node.props.testID === 'collections-filter-my-pending')[0];
    const style = StyleSheet.flatten(typeof entry.props.style === 'function' ? entry.props.style({ pressed: false }) : entry.props.style);
    // The very same shared row as CollectionDetails' 승인 대기 (light-blue background, blue border, compact one line) ...
    expect(shared.type).toBe(PendingActionRow);
    expect(style).toMatchObject({ backgroundColor: colors.brandSoft, borderColor: colors.brand, borderWidth: 1, borderRadius: radii.md, minHeight: 44, flexDirection: 'row' });
    expect(entry.props.accessibilityRole).toBe('button');
    expect(entry.props.accessibilityState).toBeUndefined();
    expect(entry.findAllByType(Text)).toHaveLength(1);
    expect(StyleSheet.flatten(entry.findAllByType(Text)[0].props.style)).toMatchObject({ color: colors.brand, fontWeight: '700' });
    // ... with its chevron, and no tight or stray spacing: 12dp below it (the filter group's own 12dp is above it, no extra top margin).
    expect(entry.findAllByType(ChevronIcon)).toHaveLength(1);
    expect(style.marginBottom).toBe(spacing.md);
    expect(style.marginTop).toBeUndefined();
    expect(style.backgroundColor).not.toBe(colors.danger);
    const order = renderer.root
      .findAll(node => typeof node.type === 'string' && /^collections-filter-(favorites|all|owned|shared|my-pending)$/.test(String(node.props.testID)))
      .map(node => node.props.testID);
    expect(order).toEqual(['collections-filter-favorites', 'collections-filter-all', 'collections-filter-owned', 'collections-filter-shared', 'collections-filter-my-pending']);
  });

  it('caps the number at 99+ in the label, and says the real count to assistive technology', async () => {
    const renderer = await renderIn('grid', 130);

    expect(buttonText(renderer)).toEqual([i18n.t('collections.myPendingSubmissions', { count: '99+' })]);
    expect(button(renderer).props.accessibilityLabel).toBe(i18n.t('collections.myPendingA11y', { count: 130 }));
  });

  it.each(['grid', 'list'] as const)('%s: tapping it opens the popup of my waiting links across all Collections - no filter is selected, no list is requested, nothing is navigated', async mode => {
    const renderer = await renderIn(mode, 3);
    expect(shownIds(renderer)).toEqual([1, 2]);
    expect(sheet(renderer).props.visible).toBe(false);
    const callsBefore = jest.mocked(getCollections).mock.calls.length;

    await act(async () => {
      button(renderer).props.onPress();
    });

    expect(sheet(renderer).props.visible).toBe(true);
    expect(sheet(renderer).props.variant).toBe('mine');
    expect(sheet(renderer).props.collectionId).toBeNull();
    expect(sheet(renderer).props.expectedCount).toBe(3);
    // The Collection list is untouched: same filter, same cards, and no 'myPending' scope is ever asked for.
    expect(shownIds(renderer)).toEqual([1, 2]);
    expect(jest.mocked(getCollections).mock.calls.length).toBe(callsBefore);
    expect(jest.mocked(getCollections).mock.calls.some(([, options]) => (options as { scope?: string } | undefined)?.scope === 'myPending')).toBe(false);
    expect(filterCell(renderer, 'favorites').props.accessibilityState).toEqual({ selected: true });

    await act(async () => {
      sheet(renderer).props.onClose();
    });
    expect(sheet(renderer).props.visible).toBe(false);
  });

  it('the popup reports the server total, which becomes the row number (and the row leaves at 0)', async () => {
    const renderer = await renderIn('grid', 3);
    await act(async () => {
      button(renderer).props.onPress();
    });

    await act(async () => {
      sheet(renderer).props.onTotalLoaded(1);
    });
    expect(buttonText(renderer)).toEqual([i18n.t('collections.myPendingSubmissions', { count: '1' })]);

    await act(async () => {
      sheet(renderer).props.onTotalLoaded(0);
    });
    expect(button(renderer)).toBeUndefined();
  });

  it('the total is one aggregate request alongside the list (focus / pull-to-refresh / Push), never per card and never polled', async () => {
    const renderer = await renderIn('grid', 2);
    const initial = jest.mocked(getMyPendingSubmissionTotal).mock.calls.length;
    expect(initial).toBeGreaterThanOrEqual(1);

    jest.mocked(getMyPendingSubmissionTotal).mockResolvedValue(5);
    await act(async () => {
      renderer.root.findByType(FlatList).props.refreshControl.props.onRefresh();
    });
    expect(buttonText(renderer)).toEqual([i18n.t('collections.myPendingSubmissions', { count: '5' })]);
    const afterRefresh = jest.mocked(getMyPendingSubmissionTotal).mock.calls.length;
    await act(async () => emitSocialPushEvent({ type: 'collectionItemReaction', collectionId: 1 }));
    expect(jest.mocked(getMyPendingSubmissionTotal).mock.calls.length).toBe(afterRefresh);

    // A result Push refreshes the number.
    jest.mocked(getMyPendingSubmissionTotal).mockResolvedValue(4);
    await act(async () => emitSocialPushEvent({ type: 'collectionLinkSubmissionApproved', collectionId: 2 }));
    expect(buttonText(renderer)).toEqual([i18n.t('collections.myPendingSubmissions', { count: '4' })]);
  });
});


describe('CollectionsScreen - a crown before the name of a Collection I own', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockRouteParams = undefined;
  });

  async function renderIn(mode: 'grid' | 'list', collections: Collection[]) {
    jest.mocked(getMyPendingSubmissionTotal).mockResolvedValue(0);
    jest.mocked(getCollections).mockImplementation(async () => ({ items: collections, nextCursor: null }));
    const renderer = await renderScreen();
    if (mode === 'list') {
      const listToggle = renderer.root.findAll(node => node.props.accessibilityLabel === 'List view' && typeof node.props.onPress === 'function')[0];
      await act(async () => {
        listToggle.props.onPress();
      });
    }
    return renderer;
  }
  const crown = (renderer: ReactTestRenderer.ReactTestRenderer, id: number) =>
    renderer.root.findAll(node => node.props.testID === `collection-owner-crown-${id}` && typeof node.type === 'string');
  const mixed = [
    makeCollection({ id: 1, name: 'Mine', accessRole: 'owner' }),
    makeCollection({ id: 2, name: 'Theirs', accessRole: 'contributor' }),
    makeCollection({ id: 3, name: 'Mine and shared', accessRole: 'owner', hasCollaborators: true }),
    makeCollection({ id: 4, name: 'Favorite of someone else', accessRole: 'viewer', isFavorite: true }),
    makeCollection({ id: 5, name: 'Proposer', accessRole: 'submitter' }),
  ];

  it.each(['grid', 'list'] as const)('%s: a crown only on Collections the server says I own - owner + shared still has it; a member role, a favorite or sharing never earn one', async mode => {
    const renderer = await renderIn(mode, mixed);

    expect(crown(renderer, 1)).toHaveLength(1);
    expect(crown(renderer, 3)).toHaveLength(1);
    expect(crown(renderer, 2)).toHaveLength(0);
    expect(crown(renderer, 4)).toHaveLength(0);
    expect(crown(renderer, 5)).toHaveLength(0);
    expect(renderer.root.findAllByType(CrownIcon)).toHaveLength(2);
    // A vector glyph, never an emoji; the names are plain text.
    expect(JSON.stringify(renderer.root.findAllByType(Text).map(text => text.props.children))).not.toContain('👑');
  });

  it.each(['grid', 'list'] as const)('%s: the crown sits before the name on the same line - the name ellipsizes, the crown cannot wrap or shrink, and it is decorative only', async mode => {
    const renderer = await renderIn(mode, [makeCollection({ id: 1, name: '아주아주 긴 컬렉션 이름 '.repeat(8), accessRole: 'owner' })]);

    const marker = crown(renderer, 1)[0];
    expect(marker.props.accessibilityElementsHidden).toBe(true);
    expect(marker.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(marker.props.onPress).toBeUndefined();
    const row = marker.parent!.parent!;
    const ordered = row.findAll(node => node === marker || node.type === Text).map(node => (node === marker ? 'crown' : 'name'));
    expect(ordered[0]).toBe('crown');
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({ flexDirection: 'row', alignItems: 'center', minWidth: 0 });
    expect(StyleSheet.flatten(marker.props.style)).toMatchObject({ flexShrink: 0 });
    const name = row.findAllByType(Text)[0];
    expect(name.props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(name.props.style)).toMatchObject({ flexShrink: 1 });
  });

  it.each(['grid', 'list'] as const)('%s: the card says it is mine to assistive technology without any visible ownership text, and the other markers stay', async mode => {
    const renderer = await renderIn(mode, [makeCollection({ id: 1, name: 'Mine', accessRole: 'owner', hasCollaborators: true, isFavorite: true })]);

    const labels = renderer.root.findAll(node => typeof node.props.onPress === 'function' && typeof node.props.accessibilityLabel === 'string').map(node => node.props.accessibilityLabel);
    expect(labels).toContain(`${i18n.t('collections.myCategoriesTab')}, Mine`);
    expect(labels).toContain(i18n.t('collections.removeFavorite'));
    expect(renderer.root.findAllByType(CollectionStatusBadges)).toHaveLength(1);
    expect(renderer.root.findAllByType(StarIcon).length).toBeGreaterThan(0);
  });

  it('the crown is the same on every filter - 즐겨찾기, 전체, 내 컬렉션, 공유 컬렉션 - not hidden by "내 컬렉션"', async () => {
    const renderer = await renderIn('grid', mixed);
    for (const filter of ['favorites', 'all', 'owned', 'shared']) {
      await act(async () => {
        renderer.root.findAll(node => node.props.testID === `collections-filter-${filter}` && typeof node.props.onPress === 'function')[0].props.onPress();
      });
      expect(crown(renderer, 1)).toHaveLength(1);
      expect(crown(renderer, 2)).toHaveLength(0);
    }
  });
});

describe('CollectionsScreen load failure', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('a first load that fails is the shared state: broken link, the standard words, 다시 시도 - and retry recovers', async () => {
    setUpGetCollectionsMock();
    jest.mocked(getCollections).mockRejectedValueOnce(new Error('offline'));
    const renderer = await renderScreen();

    const failure = renderer.root.findAll(node => node.props.testID === 'collections-list-error')[0];
    expect(failure).toBeDefined();
    expect(failure.findAllByType(Text).map(node => node.props.children)).toEqual([
      i18n.t('importantState.loadFailedTitle'),
      i18n.t('importantState.loadFailedMessage'),
      i18n.t('importantState.retry'),
    ]);
    expect(failure.findAllByType(BrokenLinkIcon)).toHaveLength(1);
    expect(failure.findAllByType(InfoIcon)).toHaveLength(0);

    await act(async () => {
      renderer.root.find(node => node.props.testID === 'collections-list-error-retry' && typeof node.props.onPress === 'function').props.onPress();
    });
    expect(renderer.root.findAll(node => node.props.testID === 'collections-list-error')).toHaveLength(0);
    expect(renderer.root.findAllByProps({ children: ownedCollection.name }).length).toBeGreaterThan(0);
    act(() => renderer.unmount());
  });

  it('with cards already shown, a failed refresh keeps them, with the shared state above them (as 보관함) - and retry recovers', async () => {
    setUpGetCollectionsMock();
    const renderer = await renderScreen();
    expect(renderer.root.findAllByProps({ children: ownedCollection.name }).length).toBeGreaterThan(0);

    jest.mocked(getCollections).mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await renderer.root.findByType(FlatList).props.refreshControl.props.onRefresh();
    });

    // The cards stay...
    expect(renderer.root.findAllByProps({ children: ownedCollection.name }).length).toBeGreaterThan(0);
    expect(renderer.root.findAll(node => node.props.testID === 'collections-list-error')).toHaveLength(0);
    // ...and the failure is the shared LoadFailureState (broken link, the standard words, 다시 시도) - not the one-line row.
    const header = renderer.root.findAllByType(LoadFailureState);
    expect(header).toHaveLength(1);
    expect(header[0].props.testID).toBe('collections-refresh-failure');
    expect(header[0].findAllByType(Text).map(node => node.props.children)).toEqual([
      i18n.t('importantState.loadFailedTitle'),
      i18n.t('importantState.loadFailedMessage'),
      i18n.t('importantState.retry'),
    ]);
    expect(header[0].findAllByType(BrokenLinkIcon)).toHaveLength(1);
    expect(header[0].findAllByType(InfoIcon)).toHaveLength(0);
    expect(renderer.root.findAllByType(RefreshFailureNotice)).toHaveLength(0);

    // 다시 시도 reloads the same Collections list; once it succeeds the state goes and the cards are current.
    const callsBeforeRetry = jest.mocked(getCollections).mock.calls.length;
    await act(async () => {
      renderer.root.find(node => node.props.testID === 'collections-refresh-failure-retry' && typeof node.props.onPress === 'function').props.onPress();
    });
    expect(jest.mocked(getCollections).mock.calls.length).toBe(callsBeforeRetry + 1);
    expect(jest.mocked(getCollections).mock.calls[callsBeforeRetry][1]).toEqual(jest.mocked(getCollections).mock.calls[0][1]);
    expect(renderer.root.findAllByType(LoadFailureState)).toHaveLength(0);
    expect(renderer.root.findAllByProps({ children: ownedCollection.name }).length).toBeGreaterThan(0);
    act(() => renderer.unmount());
  });
});

describe('CollectionsScreen - 승인 대기 중 placeholders (my own waiting join requests)', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockRouteParams = undefined;
  });

  const waiting = { requestId: 41, publicId: 'pub-private', name: '비공개 여행', icon: 'Folder', color: null, requestedAtUtc: '2026-10-09T00:00:00Z' };
  const cardById = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root.findAll(node => node.props.testID === 'collection-join-pending-41' && typeof node.props.onPress === 'function')[0];
  const allText = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(text => String(text.props.children));

  async function renderWaiting(mode: 'grid' | 'list') {
    setUpGetCollectionsMock();
    jest.mocked(listMyJoinRequests).mockResolvedValue([waiting]);
    const renderer = await renderScreen();
    await selectFilter(renderer, 'all');
    if (mode === 'list') {
      const listToggle = renderer.root.findAll(node => node.props.accessibilityLabel === 'List view' && typeof node.props.onPress === 'function')[0];
      await act(async () => {
        listToggle.props.onPress();
      });
    }
    return renderer;
  }

  it.each(['grid', 'list'] as const)('%s: shows the Collection name with a readable 승인 대기 중, and the other Collections stay', async mode => {
    const renderer = await renderWaiting(mode);

    expect(allText(renderer)).toEqual(expect.arrayContaining(['비공개 여행', i18n.t('collections.joinPending'), ownedCollection.name]));
    expect(cardById(renderer).props.accessibilityLabel).toBe(`비공개 여행, ${i18n.t('collections.joinPending')}`);
    act(() => renderer.unmount());
  });

  it.each(['grid', 'list'] as const)('%s: tapping opens the private link status - never CollectionDetails - and there is no long-press menu or favorite', async mode => {
    const renderer = await renderWaiting(mode);
    const card = cardById(renderer);

    await act(async () => {
      card.props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('SharedCollection', { publicId: 'pub-private' });
    expect(mockNavigate).not.toHaveBeenCalledWith('CollectionDetails', expect.anything());
    expect(card.props.onLongPress).toBeUndefined();
    expect(card.findAll(node => node.props.accessibilityLabel === i18n.t('collections.addFavorite'))).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it('the waiting requests are read AFTER the Collections, so an approval in between can never show the placeholder and the real card together', async () => {
    const renderer = await renderWaiting('grid');

    const firstListOrder = jest.mocked(getCollections).mock.invocationCallOrder[0];
    const firstPendingOrder = jest.mocked(listMyJoinRequests).mock.invocationCallOrder[0];
    expect(firstPendingOrder).toBeGreaterThan(firstListOrder);

    // The real Collection arrives and the server no longer lists the request: exactly one card for it, no placeholder.
    jest.mocked(listMyJoinRequests).mockResolvedValue([]);
    await act(async () => {
      renderer.root.findAllByType(FlatList)[0].props.refreshControl.props.onRefresh();
    });
    expect(cardById(renderer)).toBeUndefined();
    expect(renderer.root.findByType(FlatList).props.data.filter((entry: { pendingJoin?: unknown }) => entry.pendingJoin)).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it('a rejected request leaves nothing behind: no placeholder and no card', async () => {
    jest.mocked(listMyJoinRequests).mockResolvedValue([]);
    setUpGetCollectionsMock();
    const renderer = await renderScreen();
    await selectFilter(renderer, 'shared');

    expect(cardById(renderer)).toBeUndefined();
    expect(allText(renderer)).not.toContain('비공개 여행');
    act(() => renderer.unmount());
  });

  it.each(['grid', 'list'] as const)('%s: a Collection with its own photo keeps it under the dim - and the tile is keyed per share link, not by the request id', async mode => {
    setUpGetCollectionsMock();
    jest.mocked(listMyJoinRequests).mockResolvedValue([{ ...waiting, iconImageUrl: 'https://blob.test/cover?sig=1', iconImageVersion: 'v1' }]);
    const renderer = await renderScreen();
    await selectFilter(renderer, 'all');
    if (mode === 'list') {
      const listToggle = renderer.root.findAll(node => node.props.accessibilityLabel === 'List view' && typeof node.props.onPress === 'function')[0];
      await act(async () => {
        listToggle.props.onPress();
      });
    }

    const tile = cardById(renderer).findAllByType(CategoryIconTile)[0];
    expect(tile.props).toMatchObject({ imageUrl: 'https://blob.test/cover?sig=1', imageVersion: 'v1' });
    expect(tile.props.collectionId).toBe(require('../../collections/shareEntryTileKey').shareEntryTileKey('pub-private'));
    act(() => renderer.unmount());
  });

  it('a pending placeholder carries no red owner-action badge - the requester sees 승인 대기 중 only', async () => {
    const renderer = await renderWaiting('grid');

    expect(renderer.root.findAll(node => String(node.props.testID).startsWith('collection-attention-') && node.props.testID.includes(String(waiting.requestId)))).toHaveLength(0);
    expect(cardById(renderer).findAll(node => String(node.props.testID).startsWith('collection-attention'))).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it('appears under 전체 and 공유 컬렉션 only, and is gone once the server no longer lists it', async () => {
    const renderer = await renderWaiting('grid');
    expect(cardById(renderer)).toBeDefined();

    await selectFilter(renderer, 'owned');
    expect(cardById(renderer)).toBeUndefined();
    await selectFilter(renderer, 'favorites');
    expect(cardById(renderer)).toBeUndefined();
    await selectFilter(renderer, 'shared');
    expect(cardById(renderer)).toBeDefined();

    jest.mocked(listMyJoinRequests).mockResolvedValue([]);
    await act(async () => {
      renderer.root.findAllByType(FlatList)[0].props.refreshControl.props.onRefresh();
    });
    expect(cardById(renderer)).toBeUndefined();
    act(() => renderer.unmount());
  });
});
