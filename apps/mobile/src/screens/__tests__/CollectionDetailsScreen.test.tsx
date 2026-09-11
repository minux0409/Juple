import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Switch } from 'react-native';
import i18n from '../../i18n';
import { CollectionDetailsScreen } from '../CollectionDetailsScreen';
import {
  deleteCollection,
  enableCollectionShare,
  getCollection,
  getCollectionShare,
  removeItemFromCollection,
  revokeCollectionShare,
  type Collection,
  type CollectionItemEntry,
} from '../../collections/api/collectionsApi';
import { shareItem } from '../../items/shareItem';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

jest.mock('@react-navigation/native', () => ({
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

jest.mock('../../collections/api/collectionsApi', () => ({
  deleteCollection: jest.fn(),
  enableCollectionShare: jest.fn(),
  getCollection: jest.fn(),
  getCollectionItems: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  getCollectionShare: jest.fn(),
  removeItemFromCollection: jest.fn(),
  renameCollection: jest.fn(),
  revokeCollectionShare: jest.fn(),
  setCollectionFavorite: jest.fn(),
}));

jest.mock('../../items/shareItem', () => ({
  shareItem: jest.fn(),
}));

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 1,
    name: 'Groceries',
    isFavorite: false,
    itemCount: 1,
    createdAtUtc: new Date().toISOString(),
    updatedAtUtc: new Date().toISOString(),
    ...overrides,
  };
}

function makeItemEntry(overrides: Partial<CollectionItemEntry> = {}): CollectionItemEntry {
  return {
    itemId: 1,
    url: 'https://example.com',
    title: 'Example item',
    memo: null,
    addedAtUtc: new Date().toISOString(),
    representativeImage: null,
    ...overrides,
  };
}

const route = { key: 'CollectionDetails', name: 'CollectionDetails', params: { collectionId: 1 } } as never;
const navigation = { navigate: jest.fn(), goBack: jest.fn() } as never;

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <CollectionDetailsScreen navigation={navigation} route={route} />,
    );
  });
  return renderer;
}

/** Renders a single row in isolation (mirrors DailyInboxScreen.test.tsx's getRowElement pattern) so the swipe action props can be invoked directly without simulating a gesture. */
function getRowElement(renderer: ReactTestRenderer.ReactTestRenderer, item: CollectionItemEntry) {
  const flatList = renderer.root.findByType(FlatList);
  const element = flatList.props.renderItem({ item });
  let rowRenderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    rowRenderer = ReactTestRenderer.create(element);
  });
  return rowRenderer;
}

/**
 * Renders the FlatList's ListHeaderComponent (name/star/edit/delete, item count, share section) in
 * isolation - same rationale as getRowElement above: FlatList's own virtualization is not something
 * these tests should depend on. The element's onPress/onValueChange props are the exact same
 * closures the mounted `renderer` created, so invoking them here still updates the real screen's
 * state (and, in turn, its ConfirmDialogs, which are siblings of the FlatList and must still be
 * queried from the main `renderer`, not this isolated one).
 */
function getHeaderElement(renderer: ReactTestRenderer.ReactTestRenderer) {
  const flatList = renderer.root.findByType(FlatList);
  let headerRenderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    headerRenderer = ReactTestRenderer.create(flatList.props.ListHeaderComponent);
  });
  return headerRenderer;
}

function findPressableByText(root: ReactTestRenderer.ReactTestInstance, text: string) {
  return root
    .findAll(node => typeof node.props.onPress === 'function')
    .find(node => node.findAll(n => n.props.children === text).length > 0);
}

describe('CollectionDetailsScreen', () => {
  beforeEach(() => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection());
    jest.mocked(getCollectionShare).mockResolvedValue(null);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('item row - swipe share/remove (reuses SwipeableItemRow)', () => {
    it('shares the item via the swipe share action', async () => {
      const item = makeItemEntry({ itemId: 5, title: 'Shareable' });
      jest.mocked(shareItem).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      const row = getRowElement(renderer, item);
      const shareAction = row.root.findAll(node => node.props.accessibilityLabel === '공유')[0];
      await act(async () => {
        shareAction.props.onPress();
      });

      expect(shareItem).toHaveBeenCalledWith(item.url, item.title);
    });

    it('removes the item from the category (not a real item delete) via the swipe delete action, with no confirmation step', async () => {
      const item = makeItemEntry({ itemId: 7 });
      jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      const row = getRowElement(renderer, item);
      const removeAction = row.root.findAll(node => node.props.accessibilityLabel === '삭제')[0];
      await act(async () => {
        removeAction.props.onPress();
      });

      expect(removeItemFromCollection).toHaveBeenCalledWith(expect.anything(), 1, 7);
    });
  });

  describe('header - compact 수정/삭제, no giant footer button', () => {
    it('shows a compact 삭제 button next to 수정, and deletes only after confirming', async () => {
      jest.mocked(deleteCollection).mockResolvedValue(undefined);
      const renderer = await renderScreen();
      const header = getHeaderElement(renderer);

      expect(findPressableByText(header.root, '수정')).toBeTruthy();

      await act(async () => {
        findPressableByText(header.root, '삭제')?.props.onPress();
      });
      expect(deleteCollection).not.toHaveBeenCalled();

      await act(async () => {
        const confirmButton = renderer.root.findAll(node => node.props.accessibilityLabel === '삭제')[0];
        confirmButton.props.onPress();
      });

      expect(deleteCollection).toHaveBeenCalledWith(expect.anything(), 1);
    });
  });

  describe('public sharing - single Switch, not two buttons', () => {
    it('renders no more 공유하기/공유 해제 button pair - a single Switch instead', async () => {
      const renderer = await renderScreen();
      const header = getHeaderElement(renderer);

      expect(header.root.findAllByType(Switch)).toHaveLength(1);
    });

    it('turning the switch ON calls enableCollectionShare without opening the OS share sheet', async () => {
      jest.mocked(enableCollectionShare).mockResolvedValue({
        publicId: 'p1',
        shareUrl: 'https://juple.example/c/p1',
        createdAtUtc: new Date().toISOString(),
      });
      const renderer = await renderScreen();
      const header = getHeaderElement(renderer);

      const toggle = header.root.findByType(Switch);
      expect(toggle.props.value).toBe(false);

      await act(async () => {
        toggle.props.onValueChange(true);
      });

      expect(enableCollectionShare).toHaveBeenCalledWith(expect.anything(), 1);
      expect(shareItem).not.toHaveBeenCalled();
    });

    it('turning the switch OFF asks for confirmation, then calls revokeCollectionShare', async () => {
      jest.mocked(getCollectionShare).mockResolvedValue({
        publicId: 'p1',
        shareUrl: 'https://juple.example/c/p1',
        createdAtUtc: new Date().toISOString(),
      });
      jest.mocked(revokeCollectionShare).mockResolvedValue(undefined);
      const renderer = await renderScreen();
      const header = getHeaderElement(renderer);

      const toggle = header.root.findByType(Switch);
      expect(toggle.props.value).toBe(true);

      await act(async () => {
        toggle.props.onValueChange(false);
      });
      expect(revokeCollectionShare).not.toHaveBeenCalled();

      await act(async () => {
        const confirmButton = renderer.root.findAll(
          node => node.props.accessibilityLabel === i18n.t('collections.unshare'),
        )[0];
        confirmButton.props.onPress();
      });

      expect(revokeCollectionShare).toHaveBeenCalledWith(expect.anything(), 1);
    });

    it('shows a compact 링크 공유 action only while sharing is ON, which opens the OS share sheet', async () => {
      jest.mocked(getCollectionShare).mockResolvedValue({
        publicId: 'p1',
        shareUrl: 'https://juple.example/c/p1',
        createdAtUtc: new Date().toISOString(),
      });
      jest.mocked(shareItem).mockResolvedValue(undefined);
      const renderer = await renderScreen();
      const header = getHeaderElement(renderer);

      const shareLinkButton = findPressableByText(header.root, i18n.t('collections.shareLinkAction'));
      expect(shareLinkButton).toBeTruthy();

      await act(async () => {
        shareLinkButton?.props.onPress();
      });

      expect(shareItem).toHaveBeenCalledWith('https://juple.example/c/p1', 'Groceries');
    });
  });
});
