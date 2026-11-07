import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, StyleSheet, Switch, Text, View } from 'react-native';
import i18n from '../../i18n';
import { CollectionDetailsScreen } from '../CollectionDetailsScreen';
import { StackScreenSafeArea } from '../../components/StackScreenSafeArea';
import { SavedLinkGridCard } from '../../components/SavedLinkGridCard';
import { SavedLinkRow } from '../../components/SavedLinkRow';
import { colors, spacing } from '../../theme/tokens';
import {
  deleteCollection,
  enableCollectionShare,
  getCollection,
  getCollectionItems,
  getCollectionItemSections,
  getCollectionShare,
  getCollections,
  addItemToCollection,
  removeItemFromCollection,
  renameCollection,
  restoreCollection,
  setCollectionColor,
  setCollectionIcon,
  getCollectionNotificationPreference,
  setCollectionNotificationPreference,
  type Collection,
  type CollectionItemEntry,
} from '../../collections/api/collectionsApi';
import { BellIcon } from '../../icons/BellIcon';
import { BellOffIcon } from '../../icons/BellOffIcon';
import { EditIcon } from '../../icons/EditIcon';
import { HeartIcon } from '../../icons/HeartIcon';
import { LockIcon } from '../../icons/LockIcon';
import { TrashIcon } from '../../icons/TrashIcon';
import { shareItem } from '../../items/shareItem';
import { deleteItem, restoreItem } from '../../items/api/itemsApi';
import { ActionMenuDialog } from '../../components/ActionMenuDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { collectionShortcutService } from '../../shortcuts/CollectionShortcutService';
import { leaveCollection } from '../../collections/api/collaborationApi';
import { AppToastProvider } from '../../components/AppToast';
import { swipeRowToDelete } from '../../testing/swipeRowDriver';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

jest.mock('@react-navigation/bottom-tabs', () => ({ useBottomTabBarHeight: () => 80 }));
jest.mock('@react-navigation/native', () => ({
  CommonActions: jest.requireActual('@react-navigation/native').CommonActions,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => {
      return callback();
    }, [callback]);
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

// Unlink must never touch the general Item delete/restore API surface (see the unlink-undo
// regression tests below) - mocked here purely so those assertions have something to check.
jest.mock('../../items/api/itemsApi', () => ({
  ...jest.requireActual('../../items/api/itemsApi'),
  deleteItem: jest.fn(),
  restoreItem: jest.fn(),
}));

jest.mock('../../collections/api/collectionsApi', () => ({
  deleteCollection: jest.fn(),
  enableCollectionShare: jest.fn(),
  getCollection: jest.fn(),
  getCollectionItems: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  getCollectionItemSections: jest.fn(),
  getCollectionShare: jest.fn(),
  getCollections: jest.fn(),
  addItemToCollection: jest.fn(),
  addItemToCollections: jest.fn(),
  createCollection: jest.fn(),
  transferCollectionItem: jest.fn(),
  undoTransferCollectionItem: jest.fn(),
  removeItemFromCollection: jest.fn(),
  renameCollection: jest.fn(),
  restoreCollection: jest.fn(),
  revokeCollectionShare: jest.fn(),
  setCollectionColor: jest.fn(),
  setCollectionFavorite: jest.fn(),
  setCollectionIcon: jest.fn(),
  getCollectionNotificationPreference: jest.fn().mockResolvedValue({ newItemNotificationsEnabled: true }),
  setCollectionNotificationPreference: jest.fn(),
  copyCollectionItems: jest.fn(),
  getCollectionShareLink: jest.fn().mockResolvedValue(null),
  MAX_ITEMS_PER_COPY: 200,
}));

jest.mock('../../collections/api/collaborationApi', () => ({
  ...jest.requireActual('../../collections/api/collaborationApi'),
  leaveCollection: jest.fn(),
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
    icon: 'Folder',
    color: null,
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
    sortOrder: 0,
    representativeImage: null,
    previewImageUrl: null,
    coverImage: null,
    ...overrides,
  };
}


/**
 * 시간순 as the server now serves it, standing in for GET collections/{id}/items/sections: every
 * link the test's own getCollectionItems mock returns (paged through with the same unlock grant -
 * so a locked Collection is locked here too) as one 오늘 section with its exact count. Each section
 * page request then gets the same links from that mock (it ignores the window), so the one section
 * holds exactly what the test set up.
 */
async function sectionsFromItemsMock(request: unknown, collectionId: number, unlockToken?: string | null) {
  let count = 0;
  let cursor: string | undefined;
  let guard = 0;
  do {
    const page = await getCollectionItems(request as never, collectionId, { limit: 100, sort: 'dateDesc', cursor, unlockToken });
    count += page.items.length;
    cursor = page.nextCursor ?? undefined;
  } while (cursor && ++guard < 50);
  return count === 0
    ? []
    : [{ key: 'all-links', kind: 'today' as const, year: null, month: null, fromUtc: '2000-01-01T00:00:00.000Z', toUtc: null, count }];
}
beforeEach(() => {
  jest.mocked(getCollectionItemSections).mockImplementation(sectionsFromItemsMock as never);
});

type ListRow = { readonly kind: string; readonly item?: CollectionItemEntry; readonly items?: readonly CollectionItemEntry[] };

/**
 * The link list, whichever one the current sort renders: 시간순 (the default) is one flat list of
 * date-section rows (headers, links, skeletons), 이름순 a flat FlatList of links. Exposed with
 * FlatList-like props - `data` is every loaded link in display order, `renderItem` renders one
 * link's row - so tests about rows and data do not depend on which of the two is on screen.
 */
function findItemList(
  renderer: ReactTestRenderer.ReactTestRenderer | ReactTestRenderer.ReactTestInstance,
): { readonly props: ReactTestRenderer.ReactTestInstance['props'] } {
  const root = 'root' in renderer ? renderer.root : renderer;
  const list = root.findByType(FlatList);
  const data: readonly unknown[] = list.props.data;
  // The 시간순 list is the one without columns (이름순 always sets numColumns).
  if (list.props.numColumns !== undefined) {
    return list;
  }
  const rows = data as readonly ListRow[];
  return {
    props: {
      ...list.props,
      data: rows.flatMap(entry => (entry.kind === 'item' ? [entry.item!] : entry.kind === 'gridRow' ? [...entry.items!] : [])),
      renderItem: ({ item }: { item: CollectionItemEntry }) => {
        const owner = rows.find(entry =>
          (entry.kind === 'item' && entry.item!.itemId === item.itemId)
          || (entry.kind === 'gridRow' && entry.items!.some(candidate => candidate.itemId === item.itemId)));
        if (!owner) {
          // A link the list has not loaded: rendered as a lone row of a section, as it would be.
          return list.props.renderItem({ item: { kind: 'item', key: `i:${item.itemId}`, section: { key: 'all-links', kind: 'today' }, item, position: 0, isLast: true }, index: 0 });
        }
        return list.props.renderItem({ item: owner.kind === 'gridRow' ? { ...owner, items: [item] } : owner, index: 0 });
      },
    },
  };
}

const route = { key: 'CollectionDetails', name: 'CollectionDetails', params: { collectionId: 1 } } as never;
const navigation = { navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn(), popTo: jest.fn(), dispatch: jest.fn(), setOptions: jest.fn() } as never;

// Wrapped in the real AppToastProvider (not mocked) - Move/Unlink/Collection-Delete Undo now show
// via the global AppToast Host (see useAppToast), so these tests exercise the real Provider and
// assert on the actual UndoToast/NotificationToast/ConfirmDialog it renders, exactly as a real app
// screen would.
async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <AppToastProvider>
        <CollectionDetailsScreen navigation={navigation} route={route} />
      </AppToastProvider>,
    );
  });
  // 시간순 loads the section summary, then the open section's first page - let both land.
  await act(async () => {
    await new Promise<void>(resolve => setImmediate(() => resolve()));
  });
  return renderer;
}

/**
 * Renders a single row in isolation (mirrors DailyInboxScreen.test.tsx's getRowElement pattern) so
 * the swipe action props can be invoked directly without simulating a gesture. Goes through the
 * FlatList's own `renderItem` prop directly rather than its internal virtualization.
 */
function getRowElement(renderer: ReactTestRenderer.ReactTestRenderer, item: CollectionItemEntry) {
  const flatList = findItemList(renderer);
  const element = flatList.props.renderItem({ item, index: 0 });
  let rowRenderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    rowRenderer = ReactTestRenderer.create(element);
  });
  return rowRenderer;
}

// Minimal fake GestureResponderEvent - see SwipeableItemRow.test.tsx's identical constant for why
// this is enough for PanResponder's internal TouchHistoryMath calls to run without throwing.
const FAKE_RESPONDER_EVENT = {
  touchHistory: { touchBank: [], numberActiveTouches: 0, indexOfSingleActiveTouch: -1, mostRecentTimeStamp: 0 },
  nativeEvent: {},
};

/** The share/delete swipe actions are only mounted once a swipe is actually underway (see
 * SwipeableItemRow's own isRevealed remarks - a real-device fix for a persistent color-bleed bug
 * at rest) - fires the same onResponderGrant a real gesture would, so tests can reach those
 * buttons without simulating full drag coordinates. */
function revealRow(row: ReactTestRenderer.ReactTestRenderer): void {
  const contentLayer = row.root.findAll(node => Array.isArray(node.props.accessibilityActions))[0];
  ReactTestRenderer.act(() => {
    contentLayer.props.onResponderGrant(FAKE_RESPONDER_EVENT);
  });
}

/**
 * Renders the FlatList's ListHeaderComponent (name/star/edit/delete, share section) in
 * isolation - same rationale as getRowElement above: FlatList's own virtualization is not
 * something these tests should depend on. The element's onPress/onValueChange props are the exact
 * same closures the mounted `renderer` created, so invoking them here still updates the real
 * screen's state (and, in turn, its ConfirmDialogs, which are siblings of the FlatList and must
 * still be queried from the main `renderer`, not this isolated one).
 */
function getHeaderElement(renderer: ReactTestRenderer.ReactTestRenderer) {
  const flatList = findItemList(renderer);
  let headerRenderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    const toolbar = renderer.root.findByProps({ testID: 'collection-details-toolbar' });
    headerRenderer = ReactTestRenderer.create(
      <View>
        {toolbar.props.children}
        {renderer.root.findAll(node => node.props.testID === 'collection-details-fixed-header' && typeof node.type === 'string')[0].props.children}
        {flatList.props.ListHeaderComponent}
      </View>,
    );
  });
  return headerRenderer;
}

/** Opens the header's ⋯ menu and returns the labels it offers, in order. */
async function openCollectionMenu(renderer: ReactTestRenderer.ReactTestRenderer): Promise<string[]> {
  const header = getHeaderElement(renderer);
  const more = header.root.findAll(node => node.props.testID === 'collection-details-more' && typeof node.props.onPress === 'function')[0];
  await act(async () => more.props.onPress());
  const menu = renderer.root.findAllByType(ActionMenuDialog).find(dialog => dialog.props.visible);
  return (menu?.props.actions ?? []).map((action: { label: string }) => action.label);
}

/** ⋯ → one of its actions (the last matching element - a later confirm dialog reuses some labels). */
async function pressCollectionMenuAction(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  await openCollectionMenu(renderer);
  const menu = renderer.root.findAllByType(ActionMenuDialog).find(dialog => dialog.props.visible);
  const action = menu?.props.actions.find((candidate: { label: string }) => candidate.label === label);
  await act(async () => action.onPress());
}

/** A test that renders a real virtualized list of 1,200 links needs more than Jest's default 5 s on a busy machine. */
const HEAVY_TEST_TIMEOUT_MS = 20_000;

describe('CollectionDetailsScreen', () => {
  beforeEach(() => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection());
    jest.mocked(getCollectionShare).mockResolvedValue(null);
    jest.mocked(getCollections).mockResolvedValue({ items: [makeCollection({ id: 2, name: 'Target' })], nextCursor: null });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('leaving a shared Collection', () => {
    it('offers 컬렉션에서 나가기 to a member, never to the Owner', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner' }));
      const ownerRenderer = await renderScreen();
      expect(await openCollectionMenu(ownerRenderer)).not.toContain(i18n.t('collections.leaveAction'));

      jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor' }));
      const memberRenderer = await renderScreen();
      expect(await openCollectionMenu(memberRenderer)).toContain(i18n.t('collections.leaveAction'));
    });

    it('asks first, then leaves, closes the Collection and lands on a refreshed Collections', async () => {
      jest.mocked(leaveCollection).mockResolvedValue(undefined);
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'viewer' }));
      const renderer = await renderScreen();
      await pressCollectionMenuAction(renderer, i18n.t('collections.leaveAction'));

      expect(leaveCollection).not.toHaveBeenCalled();
      const dialog = renderer.root.findAllByType(ConfirmDialog).find(candidate => candidate.props.visible)!;
      expect(dialog.props.title).toBe(i18n.t('collections.leaveConfirmTitle'));
      expect(dialog.props.message).toBe(i18n.t('collections.leaveConfirmMessage'));
      expect(dialog.props.confirmLabel).toBe(i18n.t('collections.leaveConfirmButton'));

      await act(async () => dialog.props.onConfirm());
      expect(leaveCollection).toHaveBeenCalledWith(expect.anything(), 1);
      expect((navigation as { dispatch: jest.Mock }).dispatch).toHaveBeenCalledWith({
        type: 'NAVIGATE',
        payload: { name: 'MainTabs', params: { screen: 'Collections', params: { screen: 'CollectionsHome', params: { refreshToken: expect.any(Number) }, pop: true } }, pop: true },
      });
    });

    it('stays on the Collection and says so when leaving fails', async () => {
      jest.mocked(leaveCollection).mockRejectedValue(new Error('boom'));
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor' }));
      const renderer = await renderScreen();
      await pressCollectionMenuAction(renderer, i18n.t('collections.leaveAction'));
      const dialog = renderer.root.findAllByType(ConfirmDialog).find(candidate => candidate.props.visible)!;
      await act(async () => dialog.props.onConfirm());
      expect((navigation as { dispatch: jest.Mock }).dispatch).not.toHaveBeenCalled();
    });
  });

  it('shows search and no date control', async () => {
    const renderer = await renderScreen();
    expect(renderer.root.findAll(node => node.props.testID === 'collection-search').length).toBeGreaterThan(0);
    expect(renderer.root.findAll(node => String(node.props.testID ?? '').startsWith('collection-date-filter'))).toHaveLength(0);
  });

  it('places 링크 검색 right under the actions, THEN the [링크 n개 / List/Grid/Image] row, THEN the links', async () => {
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [makeItemEntry({ itemId: 5, title: 'First link' })], nextCursor: null });
    const renderer = await renderScreen();
    // Depth-first tree order is the on-screen order of this header column.
    const order = renderer.root.findAll(node => typeof node.type === 'string' && ['collection-view-controls', 'collection-search'].includes(node.props.testID))
      .map(node => node.props.testID as string);
    const firstOf = (testID: string) => order.indexOf(testID);
    expect(firstOf('collection-view-controls')).toBeGreaterThanOrEqual(0);
    expect(firstOf('collection-view-controls')).toBeGreaterThan(firstOf('collection-search'));
    // The links follow the controls: the list's header holds them, its rows come after.
    const list = renderer.root.findAllByType(FlatList).find(candidate => candidate.props.ListHeaderComponent);
    expect(list).toBeTruthy();
  });

  it('searches this Collection on the server after debounce and clears back to the full list', async () => {
    const searched = makeItemEntry({ itemId: 73, title: 'Needle result' });
    jest.mocked(getCollectionItems).mockImplementation(async (_request, _id, options = {}) =>
      options.q === 'needle' ? { items: [searched], nextCursor: null } : { items: [], nextCursor: null });
    const renderer = await renderScreen();
    await act(async () => {
      renderer.root.findByProps({ testID: 'collection-search' }).props.onChangeText('needle');
    });
    await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 350)); });
    expect(getCollectionItems).toHaveBeenCalledWith(expect.anything(), 1,
      expect.objectContaining({ q: 'needle', sort: 'dateDesc', limit: 30 }));
    expect(renderer.root.findAllByType(FlatList).some(list => list.props.data?.some((row: { item?: CollectionItemEntry }) => row.item?.itemId === 73))).toBe(true);
    await act(async () => { renderer.root.findByProps({ testID: 'collection-search-clear' }).props.onPress(); });
    expect(renderer.root.findByProps({ testID: 'collection-search' }).props.value).toBe('');
  });

  describe('item row - swipe share/remove (reuses SwipeableItemRow)', () => {
    it('shares the item via the swipe share action', async () => {
      const item = makeItemEntry({ itemId: 5, title: 'Shareable' });
      jest.mocked(shareItem).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      const row = getRowElement(renderer, item);
      revealRow(row);
      const shareAction = row.root.findAll(node => node.props.accessibilityLabel === '공유')[0];
      await act(async () => {
        shareAction.props.onPress();
      });

      expect(shareItem).toHaveBeenCalledWith(item.url, item.title);
    });

    it('asks for confirmation via the swipe delete action before unlinking, and only unlinks (never a real item delete) on confirm', async () => {
      const item = makeItemEntry({ itemId: 7 });
      jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      const row = getRowElement(renderer, item);
      await swipeRowToDelete(row.root);
      expect(removeItemFromCollection).not.toHaveBeenCalled();

      await act(async () => {
        const confirmButton = renderer.root.findAll(
          node => node.props.accessibilityLabel === i18n.t('collections.unlinkAction'),
        )[0];
        confirmButton.props.onPress();
      });

      expect(removeItemFromCollection).toHaveBeenCalledWith(expect.anything(), 1, 7);
      // Category unlink is never a general Item delete - see the "General Item delete" policy
      // (only Home/History offer that).
      expect(deleteItem).not.toHaveBeenCalled();
      expect(restoreItem).not.toHaveBeenCalled();
    });
  });

  describe('item row - swipe unlink undo', () => {
    // jest.clearAllMocks() (see the outer afterEach) clears call history but not a
    // .mockResolvedValue(...) override set by an individual test below - without resetting it
    // back here too, a later test's fresh renderScreen() would keep fetching this describe's own
    // non-empty item list instead of the default empty one, corrupting unrelated tests further
    // down the file (e.g. adding stray swipe-delete rows to header-only tests).
    afterEach(() => {
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [], nextCursor: null });
    });

    async function unlinkViaSwipe(renderer: ReactTestRenderer.ReactTestRenderer, item: CollectionItemEntry) {
      const row = getRowElement(renderer, item);
      await swipeRowToDelete(row.root);
      await act(async () => {
        const confirmButton = renderer.root.findAll(
          node => node.props.accessibilityLabel === i18n.t('collections.unlinkAction'),
        )[0];
        confirmButton.props.onPress();
      });
    }

    it('removes the row, decreases the count, and shows the unlink undo toast (not the delete wording)', async () => {
      const item = makeItemEntry({ itemId: 9 });
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [item], nextCursor: null });
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ itemCount: 1 }));
      jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      await unlinkViaSwipe(renderer, item);

      expect(removeItemFromCollection).toHaveBeenCalledWith(expect.anything(), 1, 9);
      expect(deleteItem).not.toHaveBeenCalled();
      expect(findItemList(renderer).props.data).toHaveLength(0);
      // The header shows no "총 N개" any more (the list itself shows the links).
      expect(renderer.root.findAllByProps({ children: i18n.t('collections.detailItemCount', { count: 0 }) })).toHaveLength(0);
      expect(renderer.root.findByProps({ children: i18n.t('toast.unlinkSuccess') })).toBeTruthy();
      expect(renderer.root.findAllByProps({ children: i18n.t('toast.deleteSuccess') })).toHaveLength(0);
    });

    it('restores the row and count via the existing membership-add API after unlink undo succeeds', async () => {
      const item = makeItemEntry({ itemId: 9 });
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [item], nextCursor: null });
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ itemCount: 1 }));
      jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
      jest.mocked(addItemToCollection).mockResolvedValue('added');
      const renderer = await renderScreen();

      await unlinkViaSwipe(renderer, item);

      await act(async () => {
        renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress();
        await Promise.resolve();
      });

      // The same PUT .../items/{itemId} membership-add API Add-to-category already uses - not a
      // bespoke unlink-undo endpoint, and never the Item restore API (soft-delete is unrelated).
      expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), 1, 9);
      expect(restoreItem).not.toHaveBeenCalled();
      expect(findItemList(renderer).props.data).toHaveLength(1);
      expect(renderer.root.findAllByProps({ children: i18n.t('collections.detailItemCount', { count: 1 }) })).toHaveLength(0);
      expect(renderer.root.findAllByProps({ accessibilityLabel: i18n.t('toast.undoAction') })).toHaveLength(0);
      expect(renderer.root.findAllByProps({ children: i18n.t('collections.addSuccess') })).toHaveLength(0);
    });

    it('keeps the unlinked state and shows the shared notice dialog when unlink undo fails', async () => {
      const item = makeItemEntry({ itemId: 9 });
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [item], nextCursor: null });
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ itemCount: 1 }));
      jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
      jest.mocked(addItemToCollection).mockRejectedValue(new Error('no'));
      const renderer = await renderScreen();

      await unlinkViaSwipe(renderer, item);

      await act(async () => {
        renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress();
        await Promise.resolve();
      });

      expect(findItemList(renderer).props.data).toHaveLength(0);
      expect(renderer.root.findAllByProps({ children: i18n.t('collections.detailItemCount', { count: 0 }) })).toHaveLength(0);
      expect(renderer.root.findAllByProps({ accessibilityLabel: i18n.t('toast.undoAction') })).toHaveLength(0);
      expect(renderer.root.findByProps({ children: i18n.t('toast.undoUnlinkError') })).toBeTruthy();
    });

    it('does not send a second membership-add request while unlink undo is pending', async () => {
      const item = makeItemEntry({ itemId: 9 });
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [item], nextCursor: null });
      jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
      let resolveUndo!: () => void;
      jest.mocked(addItemToCollection).mockImplementation(() => new Promise(resolve => { resolveUndo = () => resolve('added'); }));
      const renderer = await renderScreen();

      await unlinkViaSwipe(renderer, item);

      const undo = renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress;
      await act(async () => { undo(); undo(); });
      expect(addItemToCollection).toHaveBeenCalledTimes(1);

      await act(async () => { resolveUndo(); await Promise.resolve(); });
    });

  });

  describe('header - [즐겨찾기] [공유] [⋯], everything else in the ⋯ menu', () => {
    it('offers 수정 · 잠금 · 삭제 in the menu (no separate edit/delete icons), and deletes only after confirming', async () => {
      jest.mocked(deleteCollection).mockResolvedValue(undefined);
      const renderer = await renderScreen();
      const header = getHeaderElement(renderer);

      // Only favorite, share and ⋯ are visible header actions now.
      expect(header.root.findAll(node => node.props.accessibilityLabel === '수정' && typeof node.props.onPress === 'function')).toHaveLength(0);
      expect(header.root.findAll(node => node.props.accessibilityLabel === '삭제' && typeof node.props.onPress === 'function')).toHaveLength(0);
      expect(header.root.findAll(node => node.props.testID === 'collection-details-favorite').length).toBeGreaterThan(0);
      expect(header.root.findAll(node => node.props.testID === 'collection-details-share').length).toBeGreaterThan(0);

      // An unshared Collection: nobody else can add, so there is no 새 링크 알림 row.
      expect(await openCollectionMenu(renderer)).toEqual([
        i18n.t('common.edit'),
        i18n.t('collections.lockSetTitle'),
        i18n.t('common.delete'),
      ]);
      const menu = renderer.root.findAllByType(ActionMenuDialog).find(dialog => dialog.props.visible);
      expect(menu?.props.actions.at(-1).destructive).toBe(true);
      // Every row leads with its icon; the row (announced by its label) is the one button.
      for (const [index, icon] of [EditIcon, LockIcon, TrashIcon].entries()) {
        const row = menu!.findAll(node => node.props.accessibilityLabel === menu!.props.actions[index].label && typeof node.props.onPress === 'function')[0];
        expect(row.findAllByType(icon)).toHaveLength(1);
      }
      expect(menu!.findByType(TrashIcon).props.color).toBe(colors.destructiveText);
      expect(menu!.findByType(EditIcon).props.color).toBe(colors.textPrimary);

      await act(async () => menu?.props.actions.at(-1).onPress());
      expect(deleteCollection).not.toHaveBeenCalled();

      await act(async () => {
        const confirmButtons = renderer.root.findAll(
          node => node.props.accessibilityLabel === '삭제' && typeof node.props.onPress === 'function',
        );
        confirmButtons[confirmButtons.length - 1].props.onPress();
      });

      expect(deleteCollection).toHaveBeenCalledWith(expect.anything(), 1);
      // Collections re-fetches on any refreshToken bump (see CollectionsScreen's own route.params
      // effect) rather than trusting a one-shot deletedCollectionId param - the global AppToast
      // Host owns the Undo toast itself, shown before this navigate call.
      // Back to the existing MainTabs (its Collections filter survives) - never a fresh one.
      expect((navigation as { dispatch: jest.Mock }).dispatch).toHaveBeenCalledWith({
        type: 'NAVIGATE',
        payload: { name: 'MainTabs', params: { screen: 'Collections', params: { screen: 'CollectionsHome', params: { refreshToken: expect.any(Number) }, pop: true } }, pop: true },
      });
      expect((navigation as { replace: jest.Mock }).replace).not.toHaveBeenCalled();
      expect(renderer.root.findByProps({ children: i18n.t('toast.collectionDeleteSuccess') })).toBeTruthy();
    });

    /** The header's own buttons, in order. */
    const headerButtons = (renderer: ReactTestRenderer.ReactTestRenderer) =>
      getHeaderElement(renderer).root
        .findAll(node => typeof node.props.testID === 'string' && typeof node.props.onPress === 'function' && /^collection-details-(favorite|notifications|share|more)$/.test(node.props.testID))
        .map(node => node.props.testID as string);
    const bell = (renderer: ReactTestRenderer.ReactTestRenderer) =>
      getHeaderElement(renderer).root.findAll(node => node.props.testID === 'collection-details-notifications' && typeof node.props.onPress === 'function')[0];
    /** The header is rendered on its own (see getHeaderElement) - read the handler first, then press. */
    const pressBell = async (renderer: ReactTestRenderer.ReactTestRenderer) => {
      const onPress = bell(renderer).props.onPress;
      await act(async () => onPress());
    };

    it('a shared Collection of mine: [★] [🔔] [공유] [⋯], and 새 링크 알림 is no longer in the ⋯ menu', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true }));
      jest.mocked(getCollectionNotificationPreference).mockResolvedValueOnce({ newItemNotificationsEnabled: false });
      const renderer = await renderScreen();

      expect(getCollectionNotificationPreference).toHaveBeenCalledWith(expect.anything(), 1);
      expect(headerButtons(renderer)).toEqual([
        'collection-details-favorite', 'collection-details-notifications', 'collection-details-share', 'collection-details-more',
      ]);
      expect(await openCollectionMenu(renderer)).toEqual([
        i18n.t('common.edit'),
        i18n.t('collections.lockSetTitle'),
        i18n.t('common.delete'),
      ]);
      expect(setCollectionNotificationPreference).not.toHaveBeenCalled();
    });

    it('a public link alone also makes it a Collection others can add to - the bell is there', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', isPublicShareActive: true }));
      jest.mocked(getCollectionNotificationPreference).mockResolvedValueOnce({ newItemNotificationsEnabled: true });
      const renderer = await renderScreen();

      expect(headerButtons(renderer)).toContain('collection-details-notifications');
    });

    it('an unshared Collection: no bell, and its setting is never loaded', async () => {
      const renderer = await renderScreen();

      expect(getCollectionNotificationPreference).not.toHaveBeenCalled();
      expect(headerButtons(renderer)).toEqual(['collection-details-favorite', 'collection-details-share', 'collection-details-more']);
    });

    it('the bell flips at once, both ways - off is a slashed gray bell, on is a plain bell with no badge - with no dialog', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true }));
      jest.mocked(getCollectionNotificationPreference).mockResolvedValueOnce({ newItemNotificationsEnabled: false });
      jest.mocked(setCollectionNotificationPreference).mockResolvedValue({ newItemNotificationsEnabled: true });
      const renderer = await renderScreen();

      expect(bell(renderer).props.accessibilityLabel).toBe('알림 꺼짐. 두 번 탭하여 켜기');
      // Off is its own shape - a slashed bell - so the state reads without color.
      expect(bell(renderer).findByType(BellOffIcon).props.color).toBe(colors.textSecondary);
      expect(bell(renderer).findAllByType(BellIcon)).toHaveLength(0);

      await pressBell(renderer);
      expect(setCollectionNotificationPreference).toHaveBeenLastCalledWith(expect.anything(), 1, true);
      expect(bell(renderer).props.accessibilityLabel).toBe('알림 켜짐. 두 번 탭하여 끄기');
      expect(bell(renderer).findByType(BellIcon).props.color).toBe(colors.textPrimary);
      expect(bell(renderer).findAllByType(BellOffIcon)).toHaveLength(0);
      // Just the icon: no tinted circle or box behind it, in either state.
      const tinted = bell(renderer).findAll(node => {
        const background = typeof node.type === 'string' ? StyleSheet.flatten(node.props.style)?.backgroundColor : undefined;
        return background !== undefined && background !== 'transparent';
      });
      expect(tinted).toHaveLength(0);
      expect(renderer.root.findAll(node => node.props.testID === 'collection-notification-dialog')).toHaveLength(0);

      await pressBell(renderer);
      expect(setCollectionNotificationPreference).toHaveBeenLastCalledWith(expect.anything(), 1, false);
      expect(bell(renderer).props.accessibilityLabel).toBe('알림 꺼짐. 두 번 탭하여 켜기');
    });

    it('a failed save puts the bell back and says so briefly', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true }));
      jest.mocked(getCollectionNotificationPreference).mockResolvedValueOnce({ newItemNotificationsEnabled: true });
      jest.mocked(setCollectionNotificationPreference).mockRejectedValueOnce(new Error('offline'));
      const renderer = await renderScreen();

      await pressBell(renderer);

      expect(bell(renderer).props.accessibilityLabel).toBe('알림 켜짐. 두 번 탭하여 끄기');
      expect(bell(renderer).findAllByType(BellIcon)).toHaveLength(1); // rolled back to the on bell
      expect(renderer.root.findAllByType(Text).some(node => node.props.children === i18n.t('collections.newLinkNotificationsError'))).toBe(true);
    });

    it('puts a two-line Collection name below the fixed navigation row', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ name: 'Trip' }));
      const renderer = await renderScreen();

      const title = getHeaderElement(renderer).root.findByProps({ testID: 'collection-details-title' });
      expect(title.props.children).toBe('Trip');
      expect(title.props.numberOfLines).toBe(2);
      expect(title.props.ellipsizeMode).toBe('tail');
      expect(renderer.root.findByProps({ testID: 'collection-details-back', accessibilityRole: 'button' })).toBeDefined();
    });

    it('keeps the detail screen open and shows the existing one-button notice when delete fails', async () => {
      jest.mocked(deleteCollection).mockRejectedValue(new Error('no'));
      const renderer = await renderScreen();

      await pressCollectionMenuAction(renderer, i18n.t('common.delete'));
      await act(async () => {
        const confirmButtons = renderer.root.findAll(
          node => node.props.accessibilityLabel === i18n.t('common.delete') && typeof node.props.onPress === 'function',
        );
        confirmButtons[confirmButtons.length - 1].props.onPress();
        await Promise.resolve();
      });

      expect((navigation as { dispatch: jest.Mock }).dispatch).not.toHaveBeenCalled();
      expect(renderer.root.findByProps({ children: i18n.t('collections.errorDeleteFallback') })).toBeTruthy();
    });
  });

  describe('collection delete undo', () => {
    async function deleteCollectionViaHeader(renderer: ReactTestRenderer.ReactTestRenderer) {
      await pressCollectionMenuAction(renderer, '삭제');
      await act(async () => {
        const confirmButtons = renderer.root.findAll(
          node => node.props.accessibilityLabel === '삭제' && typeof node.props.onPress === 'function',
        );
        confirmButtons[confirmButtons.length - 1].props.onPress();
      });
    }

    it('restores the Collection via restoreCollection (not deleteItem/restoreItem) and dismisses the toast after undo succeeds', async () => {
      jest.mocked(deleteCollection).mockResolvedValue(undefined);
      jest.mocked(restoreCollection).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      await deleteCollectionViaHeader(renderer);
      expect(renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') })).toBeTruthy();

      await act(async () => {
        renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress();
        await Promise.resolve();
      });

      expect(restoreCollection).toHaveBeenCalledWith(expect.anything(), 1);
      expect(deleteItem).not.toHaveBeenCalled();
      expect(restoreItem).not.toHaveBeenCalled();
      expect(renderer.root.findAllByProps({ accessibilityLabel: i18n.t('toast.undoAction') })).toHaveLength(0);
    });

    it('shows the shared one-button notice when the undo restore fails', async () => {
      jest.mocked(deleteCollection).mockResolvedValue(undefined);
      jest.mocked(restoreCollection).mockRejectedValue(new Error('no'));
      const renderer = await renderScreen();

      await deleteCollectionViaHeader(renderer);
      await act(async () => {
        renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress();
        await Promise.resolve();
      });

      expect(renderer.root.findAllByProps({ accessibilityLabel: i18n.t('toast.undoAction') })).toHaveLength(0);
      expect(renderer.root.findByProps({ children: i18n.t('toast.undoCollectionDeleteError') })).toBeTruthy();
    });

    it('sends exactly one restore request while the delete undo is pending', async () => {
      jest.mocked(deleteCollection).mockResolvedValue(undefined);
      let resolveRestore!: () => void;
      jest.mocked(restoreCollection).mockImplementation(() => new Promise<void>(resolve => { resolveRestore = resolve; }));
      const renderer = await renderScreen();

      await deleteCollectionViaHeader(renderer);
      const undo = renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress;
      await act(async () => { undo(); undo(); });
      expect(restoreCollection).toHaveBeenCalledTimes(1);

      await act(async () => { resolveRestore(); await Promise.resolve(); });
    });
  });

  describe('header - icon (create/edit)', () => {
    async function openEditMode(renderer: ReactTestRenderer.ReactTestRenderer) {
      await pressCollectionMenuAction(renderer, '수정');
    }

    function findSaveButton(renderer: ReactTestRenderer.ReactTestRenderer) {
      return renderer.root.findAll(
        node =>
          typeof node.props.onPress === 'function' &&
          node.findAll(inner => inner.props.children === i18n.t('common.save')).length > 0,
      )[0];
    }

    it('shows the collection\'s chosen icon in the header, next to the name', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ icon: 'Heart' }));
      const renderer = await renderScreen();

      expect(getHeaderElement(renderer).root.findAllByType(HeartIcon)).toHaveLength(1);
    });

    it('seeds the icon picker from the collection\'s current icon when edit mode opens', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ icon: 'Heart' }));
      const renderer = await renderScreen();

      await openEditMode(renderer);
      const heartCell = renderer.root.findByProps({ testID: 'collection-icon-option-Heart' });
      expect(heartCell.props.accessibilityState.selected).toBe(true);
    });

    it('changing only the icon calls setCollectionIcon but not renameCollection', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ icon: 'Folder' }));
      jest.mocked(setCollectionIcon).mockResolvedValue(makeCollection({ icon: 'Plane' }));
      const renderer = await renderScreen();

      await openEditMode(renderer);
      const planeCell = renderer.root.findByProps({ testID: 'collection-icon-option-Plane' });
      act(() => {
        planeCell.props.onPress();
      });

      const saveButton = findSaveButton(renderer);
      await act(async () => {
        await saveButton.props.onPress();
      });

      expect(setCollectionIcon).toHaveBeenCalledWith(expect.anything(), 1, 'Plane');
      expect(renameCollection).not.toHaveBeenCalled();
    });

    it('changing only the name calls renameCollection but not setCollectionIcon', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ name: 'Old', icon: 'Folder' }));
      jest.mocked(renameCollection).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      await openEditMode(renderer);
      const nameInput = renderer.root.findByProps({ value: 'Old' });
      act(() => {
        nameInput.props.onChangeText('New');
      });

      const saveButton = findSaveButton(renderer);
      await act(async () => {
        await saveButton.props.onPress();
      });

      expect(renameCollection).toHaveBeenCalledWith(expect.anything(), 1, 'New');
      expect(setCollectionIcon).not.toHaveBeenCalled();
    });

    it('changing both name and icon calls renameCollection then setCollectionIcon, never in parallel', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ name: 'Old', icon: 'Folder' }));
      const callOrder: string[] = [];
      jest.mocked(renameCollection).mockImplementation(async () => {
        callOrder.push('rename');
      });
      jest.mocked(setCollectionIcon).mockImplementation(async () => {
        callOrder.push('icon');
        return makeCollection({ name: 'New', icon: 'Plane' });
      });
      const renderer = await renderScreen();

      await openEditMode(renderer);
      const nameInput = renderer.root.findByProps({ value: 'Old' });
      act(() => {
        nameInput.props.onChangeText('New');
      });

      const planeCell = renderer.root.findByProps({ testID: 'collection-icon-option-Plane' });
      act(() => {
        planeCell.props.onPress();
      });

      const saveButton = findSaveButton(renderer);
      await act(async () => {
        await saveButton.props.onPress();
      });

      expect(callOrder).toEqual(['rename', 'icon']);
    });

    /** A Collection with no explicit color yet must seed the picker from its currently-visible
     * EFFECTIVE (id-deterministic fallback) color, as if it were already selected - never Blue by
     * default regardless of id (see resolveEffectiveCollectionColorKey). */
    it('seeds the color picker from the collection\'s effective (fallback) color when none is explicit', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ id: 3, color: null }));
      const renderer = await renderScreen();

      await openEditMode(renderer);
      // id 3's deterministic fallback resolves to 'Mint' - see collectionColors.ts's own mapping.
      const mintSwatch = renderer.root.findByProps({ testID: 'collection-color-option-Mint' });
      expect(mintSwatch.props.accessibilityState.selected).toBe(true);
    });

    it('seeds the color picker from the collection\'s explicit color when one is set', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ id: 3, color: 'Teal' }));
      const renderer = await renderScreen();

      await openEditMode(renderer);
      const tealSwatch = renderer.root.findByProps({ testID: 'collection-color-option-Teal' });
      expect(tealSwatch.props.accessibilityState.selected).toBe(true);
    });

    it('changing only the color calls setCollectionColor but not renameCollection/setCollectionIcon', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ id: 3, icon: 'Folder', color: 'Blue' }));
      jest.mocked(setCollectionColor).mockResolvedValue(makeCollection({ id: 3, color: 'Mint' }));
      const renderer = await renderScreen();

      await openEditMode(renderer);
      const mintSwatch = renderer.root.findByProps({ testID: 'collection-color-option-Mint' });
      act(() => {
        mintSwatch.props.onPress();
      });

      const saveButton = findSaveButton(renderer);
      await act(async () => {
        await saveButton.props.onPress();
      });

      expect(setCollectionColor).toHaveBeenCalledWith(expect.anything(), 1, 'Mint');
      expect(renameCollection).not.toHaveBeenCalled();
      expect(setCollectionIcon).not.toHaveBeenCalled();
    });
  });

  describe('header - no "URL N개" item-count line (rows already show their own sequence number)', () => {
    it('does not render the item-count text under the name', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ itemCount: 6 }));
      const renderer = await renderScreen();
      const header = getHeaderElement(renderer);

      expect(header.root.findAllByProps({ children: 'URL 6개' })).toHaveLength(0);
      expect(
        header.root.findAll(
          node => typeof node.props.children === 'string' && /^URL\s*\d+개$/.test(node.props.children),
        ),
      ).toHaveLength(0);
    });
  });

  describe('sharing - one entry point (the Share screen), never an inline switch', () => {
    it('has no inline public-share switch in the header any more', async () => {
      const renderer = await renderScreen();
      const header = getHeaderElement(renderer);

      expect(header.root.findAllByType(Switch)).toHaveLength(0);
    });

    it('the share icon opens the Share screen and never turns public sharing on by itself', async () => {
      const renderer = await renderScreen();
      const header = getHeaderElement(renderer);

      act(() => {
        header.root.findByProps({ testID: 'collection-details-share' }).props.onPress();
      });

      expect(jest.mocked(navigation as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith('CollectionShare', { collectionId: 1 });
      expect(enableCollectionShare).not.toHaveBeenCalled();
      expect(getCollectionShare).not.toHaveBeenCalled();
    });

    it('the collection menu no longer has a separate 공동작업 entry', async () => {
      const renderer = await renderScreen();

      const labels = renderer.root.findAll(node => typeof node.props.accessibilityLabel === 'string').map(node => node.props.accessibilityLabel);
      expect(labels).not.toContain('공동작업');
      expect(labels).not.toContain('Collaborate');
    });
  });

  describe('the links - one list, always newest first', () => {
    async function flush() {
      await act(async () => {
        await new Promise<void>(resolve => setImmediate(() => resolve()));
      });
    }
    const list = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findByType(FlatList);
    const shownIds = (renderer: ReactTestRenderer.ReactTestRenderer) =>
      (list(renderer).props.data as readonly CollectionItemEntry[]).map(item => item.itemId);
    function manyLinks(count: number, everyDays = 1): CollectionItemEntry[] {
      const now = new Date();
      return Array.from({ length: count }, (_, index) => makeItemEntry({
        itemId: index + 1,
        title: `Link ${String(index + 1).padStart(4, '0')}`,
        addedAtUtc: new Date(now.getFullYear(), now.getMonth(), now.getDate() - index * everyDays, 12).toISOString(),
      }));
    }
    /** GET /collections/{id}/items over `links`: newest added first (ties by id), `limit` at a time with a cursor. */
    function serveLinks(links: readonly CollectionItemEntry[]) {
      jest.mocked(getCollectionItems).mockImplementation(async (_request, _collectionId, options = {}) => {
        const ordered = [...links].sort((a, b) => b.addedAtUtc.localeCompare(a.addedAtUtc) || b.itemId - a.itemId);
        const start = options.cursor ? Number(options.cursor) : 0;
        const end = start + (options.limit ?? 50);
        return { items: ordered.slice(start, end), nextCursor: end < ordered.length ? String(end) : null };
      });
    }

    it('has no 시간순 / 이름순 and no date sections - the links newest added first, straight away', async () => {
      serveLinks([
        makeItemEntry({ itemId: 1, addedAtUtc: new Date(2026, 0, 3).toISOString() }),
        makeItemEntry({ itemId: 2, addedAtUtc: new Date(2026, 5, 3).toISOString() }),
        makeItemEntry({ itemId: 3, addedAtUtc: new Date(2025, 11, 30).toISOString() }),
      ]);
      const renderer = await renderScreen();

      expect(renderer.root.findAll(node => String(node.props.testID ?? '').startsWith('collection-sort-'))).toHaveLength(0);
      expect(renderer.root.findAll(node => String(node.props.testID ?? '').startsWith('collection-section-'))).toHaveLength(0);
      expect(shownIds(renderer)).toEqual([2, 1, 3]);
      expect(getCollectionItemSections).not.toHaveBeenCalled();
    });

    it('with 1,200 links, loads one page and mounts only a window of rows, in List and Grid', async () => {
      serveLinks(manyLinks(1200, 0.25));
      const renderer = await renderScreen();

      expect(getCollectionItems).toHaveBeenCalledTimes(1);
      expect(getCollectionItems).toHaveBeenCalledWith(expect.anything(), 1, expect.objectContaining({ limit: 50, sort: 'dateDesc' }));
      expect(shownIds(renderer)).toHaveLength(50);
      expect(renderer.root.findAllByType(SavedLinkRow).length).toBeLessThanOrEqual(list(renderer).props.initialNumToRender);

      await act(async () => {
        renderer.root.findByProps({ accessibilityLabel: i18n.t('common.viewGrid') }).props.onPress();
      });
      expect(renderer.root.findAllByType(SavedLinkGridCard).length).toBeLessThanOrEqual(list(renderer).props.initialNumToRender * 2);
      expect(getCollectionItems).toHaveBeenCalledTimes(1);
    }, HEAVY_TEST_TIMEOUT_MS);

    it('removing a link takes it out of the list at once - nothing is reloaded for it', async () => {
      serveLinks(manyLinks(3));
      jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
      const renderer = await renderScreen();
      const callsBefore = jest.mocked(getCollectionItems).mock.calls.length;

      const row = getRowElement(renderer, makeItemEntry({ itemId: 2 }));
      await swipeRowToDelete(row.root);
      await act(async () => {
        renderer.root.findAll(node => node.props.accessibilityLabel === i18n.t('collections.unlinkAction'))[0].props.onPress();
      });

      expect(shownIds(renderer)).toEqual([1, 3]);
      expect(jest.mocked(getCollectionItems).mock.calls.length).toBe(callsBefore);
    });

    it('shows skeleton rows while the first page is on its way, then the links', async () => {
      serveLinks(manyLinks(10));
      const serve = jest.mocked(getCollectionItems).getMockImplementation()!;
      let release!: () => void;
      jest.mocked(getCollectionItems).mockImplementationOnce(async (...args) => {
        await new Promise<void>(resolve => {
          release = resolve;
        });
        return serve(...args);
      });
      const renderer = await renderScreen();

      expect(renderer.root.findAll(node => node.props.testID === 'collection-items-loading').length).toBeGreaterThan(0);
      await act(async () => {
        release();
      });
      await flush();
      expect(renderer.root.findAll(node => node.props.testID === 'collection-items-loading')).toHaveLength(0);
      expect(shownIds(renderer)).toEqual(Array.from({ length: 10 }, (_, index) => index + 1));
    });
  });

  describe('bottom inset layout (inside the 컬렉션 tab)', () => {
    // The screen lives in the 컬렉션 tab's own stack: the tab bar below it already reserves the system nav bar, so the screen root
    // adds no bottom inset of its own (a second one would leave an empty band above the tab bar), and the list fills the root.
    async function expectListFillsTabScreen(renderer: ReactTestRenderer.ReactTestRenderer) {
      expect(renderer.root.findAllByType(StackScreenSafeArea)).toHaveLength(0);
      const root = renderer.root.findByProps({ testID: 'collection-details-screen' });
      expect(StyleSheet.flatten(root.props.style).paddingBottom).toBeUndefined();
      const list = findItemList(root);
      expect(StyleSheet.flatten(list.props.style)).toMatchObject({ flex: 1 });
      expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBe(spacing.xl);
    }

    beforeEach(() => {
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [makeItemEntry({ itemId: 1 }), makeItemEntry({ itemId: 2 })], nextCursor: null });
    });

    it('keeps List and Grid filling the screen above the tab bar, with no inset of its own', async () => {
      const renderer = await renderScreen();
      await expectListFillsTabScreen(renderer);

      await act(async () => {
        renderer.root.findByProps({ accessibilityLabel: i18n.t('common.viewGrid') }).props.onPress();
      });
      // 시간순 Grid: tiles inside the open date section's card.
      expect(renderer.root.findAllByType(SavedLinkGridCard).length).toBeGreaterThan(0);
      await expectListFillsTabScreen(renderer);
    });

    it('sits on the app background like Home, 보관함 and the Collections list - page and header bar alike', async () => {
      const renderer = await renderScreen();
      const root = renderer.root.findByProps({ testID: 'collection-details-screen' });
      expect(StyleSheet.flatten(root.props.style).backgroundColor).toBe(colors.background);
      const toolbar = renderer.root.findByProps({ testID: 'collection-details-toolbar' });
      expect(toolbar.parent?.props.style.backgroundColor).toBeUndefined();
    });

    it('Grid cards use the same full date+time mode as List rows', async () => {
      const renderer = await renderScreen();
      const listRows = renderer.root.findAllByType(SavedLinkRow);
      expect(listRows.length).toBeGreaterThan(0);
      expect(listRows.every(row => row.props.dateDisplayMode === 'dateTime')).toBe(true);

      await act(async () => {
        renderer.root.findByProps({ accessibilityLabel: i18n.t('common.viewGrid') }).props.onPress();
      });
      const gridCards = renderer.root.findAllByType(SavedLinkGridCard);
      expect(gridCards.length).toBe(listRows.length);
      expect(gridCards.every(card => card.props.dateDisplayMode === 'dateTime')).toBe(true);
    });
  });

  describe('tap to open (regression)', () => {
    it('tapping a row navigates to that Item\'s details', async () => {
      const item = makeItemEntry({ itemId: 42 });
      const renderer = await renderScreen();

      const row = getRowElement(renderer, item);
      const openPressable = row.root.findAll(node => typeof node.props.onPress === 'function')[0];
      await act(async () => {
        openPressable.props.onPress();
      });

      expect((navigation as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith('ItemDetails', { itemId: 42, collectionContext: { collectionId: 1, canRemove: true, isCollectionOwner: true, isCollaborative: false } });
    });
  });

});

describe('CollectionDetailsScreen - an action asked for by the Collections list (pendingAction)', () => {
  beforeEach(() => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection());
    jest.mocked(getCollectionShare).mockResolvedValue(null);
    jest.mocked(getCollections).mockResolvedValue({ items: [], nextCursor: null });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  async function renderForAction(pendingAction: 'edit' | 'lock' | 'delete' | 'leave' | 'share') {
    const setParams = jest.fn();
    const navigateMock = jest.fn();
    const actionNavigation = { navigate: navigateMock, goBack: jest.fn(), replace: jest.fn(), popTo: jest.fn(), dispatch: jest.fn(), setParams, setOptions: jest.fn() } as never;
    const actionRoute = { key: 'CollectionDetails', name: 'CollectionDetails', params: { collectionId: 1, pendingAction } } as never;
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <AppToastProvider>
          <CollectionDetailsScreen navigation={actionNavigation} route={actionRoute} />
        </AppToastProvider>,
      );
    });
    await act(async () => {
      await new Promise<void>(resolve => setImmediate(() => resolve()));
    });
    return { renderer, setParams, navigateMock };
  }

  const visibleConfirm = (renderer: ReactTestRenderer.ReactTestRenderer, titleKey: string) =>
    renderer.root.findAll(node => node.type === ConfirmDialog && node.props.visible === true && node.props.title === i18n.t(titleKey));

  it('delete (Owner): the Collection own centered confirmation opens - nothing is deleted until it is confirmed - and the request is consumed once', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner' }));

    const { renderer, setParams } = await renderForAction('delete');

    expect(visibleConfirm(renderer, 'collections.deleteConfirmTitle')).toHaveLength(1);
    expect(deleteCollection).not.toHaveBeenCalled();
    expect(setParams).toHaveBeenCalledWith({ pendingAction: undefined });
  });

  it('leave (member): the Collection own leave confirmation opens - nothing happens until confirmed', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor' }));

    const { renderer } = await renderForAction('leave');

    expect(visibleConfirm(renderer, 'collections.leaveConfirmTitle')).toHaveLength(1);
    expect(leaveCollection).not.toHaveBeenCalled();
  });

  it('lock (Owner): the Collection own lock dialog opens; edit (Owner): its own editor opens', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner' }));

    const lock = await renderForAction('lock');
    expect(lock.renderer.root.findAll(node => node.props.mode === 'lock' && node.props.visible === true && node.props.collectionId === 1)).not.toHaveLength(0);

    const edit = await renderForAction('edit');
    expect(edit.renderer.root.findAll(node => node.props.mode === 'edit' && node.props.visible === true)).not.toHaveLength(0);
  });

  it('share (Owner): opens the one Share screen - exactly what the header icon does', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner' }));

    const { navigateMock, setParams } = await renderForAction('share');

    expect(navigateMock).toHaveBeenCalledWith('CollectionShare', { collectionId: 1 });
    expect(setParams).toHaveBeenCalledWith({ pendingAction: undefined });
  });

  it('share (Owner of a locked Collection): nothing opens before the password prompt is passed', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', isLocked: true }));

    const { navigateMock } = await renderForAction('share');

    expect(navigateMock).not.toHaveBeenCalledWith('CollectionShare', expect.anything());
  });

  it('share (member without an active public link): nothing opens - the request is decided from the Collection itself', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', isPublicShareActive: false }));

    const { navigateMock } = await renderForAction('share');

    expect(navigateMock).not.toHaveBeenCalledWith('CollectionShare', expect.anything());
  });

  it('lock (member): their OWN personal lock dialog opens (for the member, not the Owner lock); 잠금 해제 is asked once it is locked for them', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor' }));
    const set = await renderForAction('lock');
    expect(set.renderer.root.findAll(node => node.props.mode === 'lock' && node.props.visible === true && node.props.forMember === true)).not.toHaveLength(0);

    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', isLocked: true, isMemberLocked: true }));
    const remove = await renderForAction('lock');
    expect(remove.renderer.root.findAll(node => node.props.mode === 'remove' && node.props.visible === true && node.props.forMember === true)).not.toHaveLength(0);
  });

  it('what the caller may do is decided from the Collection itself - a member asking for delete or edit opens nothing, and an Owner asking to leave opens nothing', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor' }));
    for (const action of ['delete', 'edit'] as const) {
      const { renderer } = await renderForAction(action);
      expect(visibleConfirm(renderer, 'collections.deleteConfirmTitle')).toHaveLength(0);
      expect(renderer.root.findAll(node => (node.props.mode === 'edit' || node.props.mode === 'lock') && node.props.visible === true)).toHaveLength(0);
    }

    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner' }));
    const owner = await renderForAction('leave');
    expect(visibleConfirm(owner.renderer, 'collections.leaveConfirmTitle')).toHaveLength(0);
  });

  it('a deleted Collection leaves the app shortcuts at once', async () => {
    const unpin = jest.spyOn(collectionShortcutService, 'unpin').mockResolvedValue(undefined);
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner' }));
    jest.mocked(deleteCollection).mockResolvedValue(undefined);
    const { renderer } = await renderForAction('delete');

    const confirm = visibleConfirm(renderer, 'collections.deleteConfirmTitle')[0];
    await act(async () => confirm.props.onConfirm());

    expect(deleteCollection).toHaveBeenCalledWith(expect.anything(), 1);
    expect(unpin).toHaveBeenCalledWith(1);
    unpin.mockRestore();
  });

  it('a Collection the member leaves leaves the app shortcuts at once', async () => {
    const unpin = jest.spyOn(collectionShortcutService, 'unpin').mockResolvedValue(undefined);
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor' }));
    jest.mocked(leaveCollection).mockResolvedValue(undefined);
    const { renderer } = await renderForAction('leave');

    const confirm = visibleConfirm(renderer, 'collections.leaveConfirmTitle')[0];
    await act(async () => confirm.props.onConfirm());

    expect(leaveCollection).toHaveBeenCalledWith(expect.anything(), 1);
    expect(unpin).toHaveBeenCalledWith(1);
    unpin.mockRestore();
  });
});
