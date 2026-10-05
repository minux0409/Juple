import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, StyleSheet, Switch, Text } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { CollectionDetailsScreen } from '../CollectionDetailsScreen';
import { NAME_ORDER_MAX_LINKS } from '../../collections/useCollectionItems';
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
  createCollection,
  addItemToCollections,
  transferCollectionItem,
  undoTransferCollectionItem,
  mergeCollection,
  undoCollectionMerge,
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
import { CopyIcon } from '../../icons/CopyIcon';
import { FolderPlusIcon } from '../../icons/FolderPlusIcon';
import { EditIcon } from '../../icons/EditIcon';
import { HeartIcon } from '../../icons/HeartIcon';
import { LockIcon } from '../../icons/LockIcon';
import { MergeIcon } from '../../icons/MergeIcon';
import { MoveIcon } from '../../icons/MoveIcon';
import { TrashIcon } from '../../icons/TrashIcon';
import { shareItem } from '../../items/shareItem';
import { deleteItem, restoreItem } from '../../items/api/itemsApi';
import { ActionMenuDialog } from '../../components/ActionMenuDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { leaveCollection } from '../../collections/api/collaborationApi';
import { CategoryPickerModal } from '../../collections/CategoryPickerModal';
import { ViewModeToggle } from '../../components/ViewModeToggle';
import { UndoToast } from '../../components/UndoToast';
import { getCollectionCalendar } from '../../calendar/calendarApi';
import { todayLocalDate } from '../../calendar/calendarDates';
import { AppToastProvider } from '../../components/AppToast';

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
  mergeCollection: jest.fn(),
  undoCollectionMerge: jest.fn(),
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

jest.mock('../../calendar/calendarApi', () => ({
  getCollectionCalendar: jest.fn(),
  getHistoryCalendar: jest.fn(),
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
const navigation = { navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn(), popTo: jest.fn() } as never;

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
/** Long-presses one rendered link row/tile - the only way into its 복제/이동 menu, in List and Grid alike. */
async function longPressRow(row: ReactTestRenderer.ReactTestRenderer) {
  const target = row.root.findAll(node => typeof node.props.onLongPress === 'function')[0];
  await act(async () => target.props.onLongPress());
}

/** 이동 (one destination): chooses it in the list/grid picker, then presses the picker's 이동. */
async function moveViaPicker(renderer: ReactTestRenderer.ReactTestRenderer, destinationId = 2) {
  await act(async () => renderer.root.findAll(node => node.props.testID === `category-picker-option-${destinationId}` && typeof node.props.onPress === 'function')[0].props.onPress());
  await act(async () => renderer.root.findAll(node => node.props.testID === 'category-picker-submit' && typeof node.props.onPress === 'function')[0].props.onPress());
}

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
    headerRenderer = ReactTestRenderer.create(flatList.props.ListHeaderComponent);
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
      expect((navigation as { popTo: jest.Mock }).popTo).toHaveBeenCalledWith('MainTabs', {
        screen: 'Collections',
        params: { refreshToken: expect.any(Number) },
      });
    });

    it('stays on the Collection and says so when leaving fails', async () => {
      jest.mocked(leaveCollection).mockRejectedValue(new Error('boom'));
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor' }));
      const renderer = await renderScreen();
      await pressCollectionMenuAction(renderer, i18n.t('collections.leaveAction'));
      const dialog = renderer.root.findAllByType(ConfirmDialog).find(candidate => candidate.props.visible)!;
      await act(async () => dialog.props.onConfirm());
      expect((navigation as { popTo: jest.Mock }).popTo).not.toHaveBeenCalled();
    });
  });

  describe('date filter', () => {
    const openPicker = async (renderer: ReactTestRenderer.ReactTestRenderer) => {
      await act(async () => {
        renderer.root.find(node => node.props.testID === 'collection-date-filter-toggle' && typeof node.props.onPress === 'function').props.onPress();
      });
      await act(async () => {
        await new Promise<void>(resolve => setImmediate(() => resolve()));
      });
    };

    it('is a filter beside List / Grid - the view selector has no calendar option', async () => {
      const renderer = await renderScreen();
      const toggle = renderer.root.findAllByType(ViewModeToggle)[0];
      expect(toggle.props).not.toHaveProperty('withCalendar');
      expect(renderer.root.findAll(node => node.props.testID === 'view-mode-calendar')).toHaveLength(0);
      expect(renderer.root.findAll(node => node.props.testID === 'collection-date-filter-toggle')).not.toHaveLength(0);
    });

    it('asks the SERVER for the chosen day as a DATE - the same rule that counted it - and never builds UTC bounds itself', async () => {
      const today = todayLocalDate();
      const [year, month] = today.split('-').map(Number);
      jest.mocked(getCollectionCalendar).mockResolvedValue({ year, month, days: [{ date: today, count: 2 }] });
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [makeItemEntry({ itemId: 41, title: 'On that day' })], nextCursor: null });
      const renderer = await renderScreen();
      jest.mocked(getCollectionItems).mockClear();

      await openPicker(renderer);
      // Month counts for the month on screen, through the calendar endpoint (counts only) - and no links yet.
      expect(getCollectionCalendar).toHaveBeenCalledWith(expect.anything(), 1, year, month, null);
      expect(getCollectionItems).not.toHaveBeenCalled();
      expect(renderer.root.find(node => node.props.testID === `collection-date-filter-calendar-count-${today}` && typeof node.type === 'string').props.children).toBe(2);

      await act(async () => {
        renderer.root.find(node => node.props.testID === `collection-date-filter-calendar-day-${today}` && typeof node.props.onPress === 'function').props.onPress();
      });

      const dayRequests = jest.mocked(getCollectionItems).mock.calls.filter(call => call[2]?.date !== undefined);
      expect(dayRequests).toHaveLength(1);
      expect(dayRequests[0][1]).toBe(1);
      expect(dayRequests[0][2]).toEqual(expect.objectContaining({ date: today, sort: 'dateDesc', limit: 25 }));
      expect(dayRequests[0][2]).not.toHaveProperty('fromUtc');
      expect(dayRequests[0][2]).not.toHaveProperty('toUtc');
      // The day's links are what the screen lists below, the picker collapsed, the day shown as the filter.
      expect(renderer.root.findAllByType(SavedLinkRow)).toHaveLength(1);
      expect(renderer.root.find(node => node.props.testID === 'collection-date-filter-toggle' && typeof node.props.onPress === 'function').props.accessibilityLabel)
        .toContain(i18n.t('calendar.selectedDateLabel', { date: '' }).replace(/\{\{.*$/, '').trim());
    });

    it('follows the current List / Grid, and X returns to every date', async () => {
      const today = todayLocalDate();
      const [year, month] = today.split('-').map(Number);
      jest.mocked(getCollectionCalendar).mockResolvedValue({ year, month, days: [{ date: today, count: 2 }] });
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [makeItemEntry({ itemId: 41 }), makeItemEntry({ itemId: 42 })], nextCursor: null });
      const renderer = await renderScreen();
      await openPicker(renderer);
      await act(async () => {
        renderer.root.find(node => node.props.testID === `collection-date-filter-calendar-day-${today}` && typeof node.props.onPress === 'function').props.onPress();
      });
      // List: one column; Grid: two.
      expect(renderer.root.findByType(FlatList).props.numColumns).toBe(1);
      await act(async () => {
        renderer.root.findAllByType(ViewModeToggle)[0].props.onChange('grid');
      });
      expect(renderer.root.findByType(FlatList).props.numColumns).toBe(2);
      expect(renderer.root.findAllByType(SavedLinkGridCard)).toHaveLength(2);

      await act(async () => {
        renderer.root.find(node => node.props.testID === 'collection-date-filter-clear' && typeof node.props.onPress === 'function').props.onPress();
      });
      expect(renderer.root.findAll(node => node.props.testID === 'collection-date-filter-clear')).toHaveLength(0);
      // Back to the whole Collection (its own list, not the day's).
      expect(renderer.root.findAll(node => node.props.testID === 'collection-calendar-empty')).toHaveLength(0);
    });
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
      revealRow(row);
      const removeAction = row.root.findAll(node => node.props.accessibilityLabel === i18n.t('collections.removeFromCollection'))[0];
      await act(async () => {
        removeAction.props.onPress();
      });
      expect(removeItemFromCollection).not.toHaveBeenCalled();

      await act(async () => {
        const confirmButton = renderer.root.findAll(
          node => node.props.accessibilityLabel === i18n.t('collections.removeFromCollection'),
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
      revealRow(row);
      const removeAction = row.root.findAll(node => node.props.accessibilityLabel === i18n.t('collections.removeFromCollection'))[0];
      await act(async () => removeAction.props.onPress());
      await act(async () => {
        const confirmButton = renderer.root.findAll(
          node => node.props.accessibilityLabel === i18n.t('collections.removeFromCollection'),
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
      expect(renderer.root.findByProps({ children: i18n.t('collections.detailItemCount', { count: 0 }) })).toBeTruthy();
      expect(i18n.t('collections.detailItemCount', { count: 0 })).toBe('총 0개');
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
      expect(renderer.root.findByProps({ children: i18n.t('collections.detailItemCount', { count: 1 }) })).toBeTruthy();
      expect(i18n.t('collections.detailItemCount', { count: 1 })).toBe('총 1개');
      expect(i18n.t('collections.detailItemCount', { count: 12 })).toBe('총 12개');
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
      expect(renderer.root.findByProps({ children: i18n.t('collections.detailItemCount', { count: 0 }) })).toBeTruthy();
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

    it('clears a pending Move undo once a later unlink succeeds, and vice versa (latest-one-only)', async () => {
      const movedItem = makeItemEntry({ itemId: 9 });
      const unlinkedItem = makeItemEntry({ itemId: 10 });
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [movedItem, unlinkedItem], nextCursor: null });
      jest.mocked(transferCollectionItem).mockResolvedValue({ targetMembershipCreated: true });
      jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      // Move first - its own undo toast appears.
      const movedRow = getRowElement(renderer, movedItem);
      await longPressRow(movedRow);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress());
      await moveViaPicker(renderer);
      expect(renderer.root.findByProps({ children: i18n.t('toast.moveSuccess') })).toBeTruthy();

      // Then unlink another row - only the unlink toast should remain.
      await unlinkViaSwipe(renderer, unlinkedItem);
      expect(renderer.root.findAllByProps({ children: i18n.t('toast.moveSuccess') })).toHaveLength(0);
      expect(renderer.root.findByProps({ children: i18n.t('toast.unlinkSuccess') })).toBeTruthy();
      // At most one UndoToast component instance on screen at a time - never both Move's and
      // Unlink's simultaneously (see the "latest-one-only" policy).
      expect(renderer.root.findAllByType(UndoToast)).toHaveLength(1);
    });
  });

  describe('header - [즐겨찾기] [공유] [⋯], everything else in the ⋯ menu', () => {
    it('offers 수정 · 잠금 · 병합 · 삭제 in the menu (no separate edit/delete icons), and deletes only after confirming', async () => {
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
        i18n.t('collections.mergeWithOther'),
        i18n.t('common.delete'),
      ]);
      const menu = renderer.root.findAllByType(ActionMenuDialog).find(dialog => dialog.props.visible);
      expect(menu?.props.actions.at(-1).destructive).toBe(true);
      // Every row leads with its icon; the row (announced by its label) is the one button.
      for (const [index, icon] of [EditIcon, LockIcon, MergeIcon, TrashIcon].entries()) {
        const row = menu!.findAll(node => node.props.accessibilityLabel === menu!.props.actions[index].label && typeof node.props.onPress === 'function')[0];
        expect(row.findAllByType(icon)).toHaveLength(1);
      }
      expect(menu!.findByType(TrashIcon).props.color).toBe(colors.danger);
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
      expect((navigation as { popTo: jest.Mock }).popTo).toHaveBeenCalledWith('MainTabs', {
        screen: 'Collections',
        params: { refreshToken: expect.any(Number) },
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

      expect(bell(renderer).props.accessibilityLabel).toBe('새 링크 알림 꺼짐. 두 번 탭하여 켜기');
      // Off is its own shape - a slashed bell - so the state reads without color.
      expect(bell(renderer).findByType(BellOffIcon).props.color).toBe(colors.textSecondary);
      expect(bell(renderer).findAllByType(BellIcon)).toHaveLength(0);

      await pressBell(renderer);
      expect(setCollectionNotificationPreference).toHaveBeenLastCalledWith(expect.anything(), 1, true);
      expect(bell(renderer).props.accessibilityLabel).toBe('새 링크 알림 켜짐. 두 번 탭하여 끄기');
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
      expect(bell(renderer).props.accessibilityLabel).toBe('새 링크 알림 꺼짐. 두 번 탭하여 켜기');
    });

    it('a failed save puts the bell back and says so briefly', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true }));
      jest.mocked(getCollectionNotificationPreference).mockResolvedValueOnce({ newItemNotificationsEnabled: true });
      jest.mocked(setCollectionNotificationPreference).mockRejectedValueOnce(new Error('offline'));
      const renderer = await renderScreen();

      await pressBell(renderer);

      expect(bell(renderer).props.accessibilityLabel).toBe('새 링크 알림 켜짐. 두 번 탭하여 끄기');
      expect(bell(renderer).findAllByType(BellIcon)).toHaveLength(1); // rolled back to the on bell
      expect(renderer.root.findAllByType(Text).some(node => node.props.children === i18n.t('collections.newLinkNotificationsError'))).toBe(true);
    });

    it('shows at most two lines of even a very long, space-free name, then an ellipsis', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ name: 'A'.repeat(300) }));
      const renderer = await renderScreen();
      const title = getHeaderElement(renderer).root.findAll(node => node.props.testID === 'collection-details-title')[0];

      expect(title.props.numberOfLines).toBe(2);
      expect(title.props.ellipsizeMode).toBe('tail');
      expect(StyleSheet.flatten(title.props.style)).toMatchObject({ flexShrink: 1, minWidth: 0 });
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

      expect((navigation as { popTo: jest.Mock }).popTo).not.toHaveBeenCalled();
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
      const header = getHeaderElement(renderer);

      expect(header.root.findAllByType(HeartIcon)).toHaveLength(1);
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

  describe('link sort + view mode', () => {
    const sortChip = (renderer: ReactTestRenderer.ReactTestRenderer, which: 'date' | 'name') =>
      renderer.root.find(node => node.props.testID === `collection-sort-${which}` && typeof node.props.onPress === 'function');
    const sortChipLabel = (renderer: ReactTestRenderer.ReactTestRenderer, which: 'date' | 'name') =>
      sortChip(renderer, which).findByType(Text).props.children;

    type Row = { readonly kind: string; readonly key: string; readonly section: { readonly key: string; readonly count: number }; readonly item?: CollectionItemEntry; readonly items?: readonly CollectionItemEntry[] };
    const dateList = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findByType(FlatList);
    const rows = (renderer: ReactTestRenderer.ReactTestRenderer): readonly Row[] => dateList(renderer).props.data;
    const headers = (renderer: ReactTestRenderer.ReactTestRenderer) => rows(renderer).filter(row => row.kind === 'header');
    const shownIds = (renderer: ReactTestRenderer.ReactTestRenderer) =>
      rows(renderer).flatMap(row => (row.kind === 'item' ? [row.item!.itemId] : row.kind === 'gridRow' ? row.items!.map(item => item.itemId) : []));
    const headerProps = (renderer: ReactTestRenderer.ReactTestRenderer) =>
      headers(renderer).map(row => dateList(renderer).props.renderItem({ item: row, index: 0 }).props as { label: string; count: number; isExpanded: boolean });
    async function toggle(renderer: ReactTestRenderer.ReactTestRenderer, sectionKey: string) {
      const header = headers(renderer).find(row => row.section.key === sectionKey)!;
      await act(async () => {
        dateList(renderer).props.renderItem({ item: header, index: 0 }).props.onPress();
      });
      await flush();
    }
    async function flush() {
      await act(async () => {
        await new Promise<void>(resolve => setImmediate(() => resolve()));
      });
    }
    /** Reports the given rows as on screen, as the FlatList would while the user scrolls. */
    async function show(renderer: ReactTestRenderer.ReactTestRenderer, shown: readonly Row[]) {
      const viewableItems = shown.map(row => ({ item: row, key: row.key, index: rows(renderer).indexOf(row), isViewable: true }));
      await act(async () => {
        dateList(renderer).props.onViewableItemsChanged({ viewableItems, changed: viewableItems });
      });
      await flush();
    }
    const itemCalls = () => jest.mocked(getCollectionItems).mock.calls.filter(([, , options]) => options?.fromUtc !== undefined);

    /**
     * A server over `links` that answers exactly like GET /collections/{id}/items/sections and
     * GET /collections/{id}/items: 오늘 (from local midnight, open-ended) and one section per older
     * local month, newest first, with exact counts; a section's page is only its window's links, in
     * the requested date order (ties by itemId), `limit` at a time with a cursor that names its order.
     */
    function serveCollection(links: readonly CollectionItemEntry[]) {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const sections: { key: string; kind: 'today' | 'month'; year: number | null; month: number | null; fromUtc: string; toUtc: string | null; count: number }[] = [];
      const todayCount = links.filter(link => new Date(link.addedAtUtc) >= todayStart).length;
      if (todayCount > 0) {
        sections.push({ key: 'today', kind: 'today', year: null, month: null, fromUtc: todayStart.toISOString(), toUtc: null, count: todayCount });
      }
      const older = links.filter(link => new Date(link.addedAtUtc) < todayStart);
      const monthKeys = [...new Set(older.map(link => {
        const date = new Date(link.addedAtUtc);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      }))].sort().reverse();
      for (const monthKey of monthKeys) {
        const [year, month] = monthKey.split('-').map(Number);
        const from = new Date(year, month - 1, 1);
        const nextMonth = new Date(year, month, 1);
        const to = nextMonth < todayStart ? nextMonth : todayStart;
        const count = older.filter(link => new Date(link.addedAtUtc) >= from && new Date(link.addedAtUtc) < to).length;
        sections.push({ key: `month:${monthKey}`, kind: 'month', year, month, fromUtc: from.toISOString(), toUtc: to.toISOString(), count });
      }
      jest.mocked(getCollectionItemSections).mockImplementation(async () => sections);
      jest.mocked(getCollectionItems).mockImplementation(async (_request, _collectionId, options = {}) => {
        const sort = options.sort ?? 'dateDesc';
        const inWindow = links.filter(link =>
          options.fromUtc === undefined
          || (new Date(link.addedAtUtc) >= new Date(options.fromUtc) && (!options.toUtc || new Date(link.addedAtUtc) < new Date(options.toUtc))));
        const ordered = [...inWindow].sort((a, b) =>
          sort === 'dateAsc'
            ? a.addedAtUtc.localeCompare(b.addedAtUtc) || a.itemId - b.itemId
            : b.addedAtUtc.localeCompare(a.addedAtUtc) || b.itemId - a.itemId);
        let start = 0;
        if (options.cursor) {
          const [cursorSort, offset] = options.cursor.split(':');
          if (cursorSort !== sort) {
            throw new Error('a cursor from another order');
          }
          start = Number(offset);
        }
        const limit = options.limit ?? 50;
        const end = start + limit;
        return { items: ordered.slice(start, end), nextCursor: end < ordered.length ? `${sort}:${end}` : null };
      });
      return sections;
    }

    /** `count` links, one every `everyDays` days back from today - most of them in older months. */
    function manyLinks(count = 120, everyDays = 3): CollectionItemEntry[] {
      const now = new Date();
      return Array.from({ length: count }, (_, index) => makeItemEntry({
        itemId: index + 1,
        title: `Link ${String(index + 1).padStart(4, '0')}`,
        addedAtUtc: new Date(now.getFullYear(), now.getMonth(), now.getDate() - index * everyDays, 12).toISOString(),
      }));
    }

    it('offers just 시간순 and 이름순 - 시간순 ↓ (newest first) by default', async () => {
      const renderer = await renderScreen();

      expect(sortChipLabel(renderer, 'date')).toBe(`${i18n.t('collections.sortDate')} ↓`);
      // The visible wording is 시간순 (the sort itself is unchanged).
      expect(i18n.t('collections.sortDate')).toBe('시간순');
      expect(renderer.root.findAllByType(Text).map(node => String(node.props.children))).not.toContain('일자순');
      expect(sortChipLabel(renderer, 'name')).toBe(i18n.t('collections.sortName'));
      expect(sortChip(renderer, 'date').props.accessibilityState).toEqual({ selected: true });
      expect(sortChip(renderer, 'date').props.accessibilityLabel).toBe(i18n.t('collections.sortDateNewestA11y'));
      expect(renderer.root.findAllByProps({ children: '최신순' })).toHaveLength(0);
      expect(renderer.root.findAllByProps({ children: '오래된순' })).toHaveLength(0);
    });

    it('opens with the date summary and only the open section\'s first page - collapsed sections load nothing', async () => {
      const links = manyLinks();
      const sections = serveCollection(links);
      const renderer = await renderScreen();

      expect(getCollectionItemSections).toHaveBeenCalledTimes(1);
      // Every section with its exact total, newest first.
      expect(headerProps(renderer).map(header => header.count)).toEqual(sections.map(section => section.count));
      expect(headerProps(renderer)[0]).toEqual(expect.objectContaining({ label: i18n.t('history.today'), isExpanded: true }));
      expect(itemCalls()).toHaveLength(1);
      expect(itemCalls()[0][2]).toEqual({ limit: 25, cursor: undefined, sort: 'dateDesc', fromUtc: sections[0].fromUtc, toUtc: null, unlockToken: null });
      expect(shownIds(renderer)).toEqual([1]);
    });

    it('expanding a section loads just that section\'s first page; a collapsed-then-reopened one shows its links without asking again', async () => {
      const links = manyLinks();
      const sections = serveCollection(links);
      const renderer = await renderScreen();
      const month = sections[2];

      await toggle(renderer, month.key);
      expect(itemCalls()).toHaveLength(2);
      expect(itemCalls()[1][2]).toEqual(expect.objectContaining({ limit: 25, sort: 'dateDesc', fromUtc: month.fromUtc, toUtc: month.toUtc }));
      const monthIds = shownIds(renderer).slice(1);
      expect(monthIds).toHaveLength(month.count);

      await toggle(renderer, month.key);
      expect(shownIds(renderer)).toEqual([1]);
      await toggle(renderer, month.key);
      expect(shownIds(renderer).slice(1)).toEqual(monthIds);
      expect(itemCalls()).toHaveLength(2);
    });

    it('opened/closed date sections stay as the user left them when the direction flips; ↑ reverses them and reloads the open ones from their own window', async () => {
      const now = new Date();
      const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 10, 12).toISOString();
      const sections = serveCollection([
        makeItemEntry({ itemId: 1, addedAtUtc: now.toISOString() }),
        makeItemEntry({ itemId: 3, addedAtUtc: twoMonthsAgo }),
      ]);
      const renderer = await renderScreen();
      // Today's section starts open, the older month closed.
      expect(shownIds(renderer)).toEqual([1]);

      await toggle(renderer, sections[1].key);
      expect(shownIds(renderer)).toEqual([1, 3]);

      jest.mocked(getCollectionItems).mockClear();
      await act(async () => {
        sortChip(renderer, 'date').props.onPress();
      });
      await flush();
      expect(sortChip(renderer, 'date').props.accessibilityLabel).toBe(i18n.t('collections.sortDateOldestA11y'));
      expect(headers(renderer).map(header => header.section.key)).toEqual([sections[1].key, sections[0].key]);
      expect(shownIds(renderer)).toEqual([3, 1]);
      // Both open sections start over in the new order - from the top of their own window, no cursor.
      expect(itemCalls().map(([, , options]) => [options?.sort, options?.cursor])).toEqual([['dateAsc', undefined], ['dateAsc', undefined]]);
      // The summary is the same in both directions - it is not asked for again.
      expect(getCollectionItemSections).toHaveBeenCalledTimes(1);
    });

    it('pages a large section by its own cursor as its end comes on screen - in order, no duplicate or missing link, skeletons only while a page is on its way', async () => {
      // 90 links in the current month alone (every 8 hours).
      const now = new Date();
      const links = Array.from({ length: 90 }, (_, index) => makeItemEntry({
        itemId: index + 1,
        addedAtUtc: new Date(now.getTime() - (index + 1) * 8 * 3_600_000).toISOString(),
      }));
      const sections = serveCollection(links);
      const renderer = await renderScreen();
      const target = sections.find(section => section.kind === 'month' && section.count >= 30) ?? sections[sections.length - 1];
      if (!headerProps(renderer).find((_, index) => headers(renderer)[index].section.key === target.key)?.isExpanded) {
        await toggle(renderer, target.key);
      }
      const sectionRows = () => rows(renderer).filter(row => row.section.key === target.key && row.kind !== 'header');
      // Idle with more to come: no skeleton.
      expect(sectionRows().filter(row => row.kind === 'skeleton')).toHaveLength(0);

      for (let guard = 0; guard < 10 && sectionRows().filter(row => row.kind === 'item').length < target.count; guard++) {
        await show(renderer, sectionRows().slice(-2));
      }

      const ids = sectionRows().filter(row => row.kind === 'item').map(row => row.item!.itemId);
      const expected = links
        .filter(link => new Date(link.addedAtUtc) >= new Date(target.fromUtc) && (!target.toUtc || new Date(link.addedAtUtc) < new Date(target.toUtc)))
        .map(link => link.itemId);
      expect(ids).toEqual(expected);
      expect(new Set(ids).size).toBe(ids.length);
      for (const [, , options] of itemCalls().filter(([, , call]) => call?.fromUtc === target.fromUtc)) {
        expect(options).toEqual(expect.objectContaining({ sort: 'dateDesc', limit: 25, toUtc: target.toUtc }));
      }
      // At the end: nothing more is asked for.
      const callsAtEnd = itemCalls().length;
      await show(renderer, sectionRows().slice(-2));
      expect(itemCalls()).toHaveLength(callsAtEnd);
    });

    it('with 1,200 links, loads the summary and one page - and mounts only a window of rows, in List and Grid', async () => {
      const links = manyLinks(1200, 0.25);
      const sections = serveCollection(links);
      const renderer = await renderScreen();

      expect(headerProps(renderer).reduce((sum, header) => sum + header.count, 0)).toBe(1200);
      expect(sections.length).toBeGreaterThan(3);
      // Open every section: one first page each - never the whole Collection.
      for (const section of sections.slice(1)) {
        await toggle(renderer, section.key);
      }
      expect(itemCalls()).toHaveLength(sections.length);
      expect(itemCalls().every(([, , options]) => options?.limit === 25 && options.cursor === undefined)).toBe(true);
      const loaded = shownIds(renderer).length;
      expect(loaded).toBeLessThanOrEqual(sections.length * 25);
      // The list mounts only a window of what is loaded.
      expect(renderer.root.findAllByType(SavedLinkRow).length).toBeLessThanOrEqual(dateList(renderer).props.initialNumToRender);

      await act(async () => {
        renderer.root.findByProps({ accessibilityLabel: 'Grid view' }).props.onPress();
      });
      // Image view: one virtualized row per pair of tiles - the same links, no extra request.
      expect(rows(renderer).filter(row => row.kind === 'gridRow').length).toBe(sections.reduce((sum, section) => sum + Math.ceil(Math.min(section.count, 25) / 2), 0));
      expect(renderer.root.findAllByType(SavedLinkGridCard).length).toBeLessThanOrEqual(dateList(renderer).props.initialNumToRender * 2);
      expect(itemCalls()).toHaveLength(sections.length);
    });

    it('removing a link lowers its section\'s count at once, and an emptied section goes', async () => {
      const now = new Date();
      const sections = serveCollection([
        makeItemEntry({ itemId: 1, addedAtUtc: now.toISOString() }),
        makeItemEntry({ itemId: 2, addedAtUtc: new Date(now.getFullYear(), now.getMonth() - 2, 10, 12).toISOString() }),
        makeItemEntry({ itemId: 3, addedAtUtc: new Date(now.getFullYear(), now.getMonth() - 2, 11, 12).toISOString() }),
      ]);
      jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
      const renderer = await renderScreen();
      await toggle(renderer, sections[1].key);
      const unlink = async (itemId: number) => {
        const row = getRowElement(renderer, makeItemEntry({ itemId }));
        revealRow(row);
        await act(async () => {
          row.root.findAll(node => node.props.accessibilityLabel === i18n.t('collections.removeFromCollection'))[0].props.onPress();
        });
        await act(async () => {
          renderer.root.findAll(node => node.props.accessibilityLabel === i18n.t('collections.removeFromCollection'))[0].props.onPress();
        });
      };

      await unlink(3);
      expect(headerProps(renderer).map(header => header.count)).toEqual([1, 1]);
      await unlink(1);
      expect(headers(renderer).map(header => header.section.key)).toEqual([sections[1].key]);
      expect(getCollectionItemSections).toHaveBeenCalledTimes(1);
    });

    it('shows skeleton rows while a section\'s first page is on its way, then the links', async () => {
      const links = manyLinks(10);
      serveCollection(links);
      const serve = jest.mocked(getCollectionItems).getMockImplementation()!;
      let release!: () => void;
      jest.mocked(getCollectionItems).mockImplementationOnce(async (...args) => {
        await new Promise<void>(resolve => {
          release = resolve;
        });
        return serve(...args);
      });
      const renderer = await renderScreen();

      expect(rows(renderer).filter(row => row.kind === 'skeleton')).toHaveLength(1);
      await act(async () => {
        release();
      });
      await flush();
      expect(rows(renderer).filter(row => row.kind === 'skeleton')).toHaveLength(0);
      expect(shownIds(renderer)).toEqual([1]);
    });

    it('이름순 loads the whole Collection first - never a name order of just the loaded page - then shows it as one flat list', async () => {
      const links = manyLinks();
      serveCollection(links);
      let finishSecondPage!: () => void;
      const serve = jest.mocked(getCollectionItems).getMockImplementation()!;
      const renderer = await renderScreen();

      // Hold the second 100-link page back: while the Collection is only partly in, nothing is shown.
      jest.mocked(getCollectionItems).mockImplementation(async (request, collectionId, options = {}) => {
        if (options.cursor) {
          await new Promise<void>(resolve => {
            finishSecondPage = resolve;
          });
        }
        return serve(request, collectionId, options);
      });
      await act(async () => {
        sortChip(renderer, 'name').props.onPress();
      });
      expect(getCollectionItems).toHaveBeenLastCalledWith(expect.anything(), 1, expect.objectContaining({ limit: 100, sort: 'dateDesc', cursor: 'dateDesc:100' }));
      expect(renderer.root.findByType(FlatList).props.numColumns).toBe(1);
      expect(renderer.root.findByType(FlatList).props.data).toEqual([]);
      expect(renderer.root.findByProps({ testID: 'collection-items-loading' })).toBeTruthy();

      await act(async () => {
        finishSecondPage();
      });

      const names = renderer.root.findByType(FlatList).props.data.map((item: CollectionItemEntry) => item.title);
      expect(names).toHaveLength(120);
      expect(names[0]).toBe('Link 0001');
      expect(names[119]).toBe('Link 0120');
      expect(sortChipLabel(renderer, 'date')).toBe(i18n.t('collections.sortDate'));

      // Switching List -> Grid view mode must not reset the sort choice just made.
      await act(async () => {
        renderer.root.findByProps({ accessibilityLabel: 'Grid view' }).props.onPress();
      });
      expect(renderer.root.findByType(FlatList).props.numColumns).toBe(2);
      expect(renderer.root.findByType(FlatList).props.data).toHaveLength(120);

      // Back to 시간순: the date summary again, then the open section's first page (no cursor).
      jest.mocked(getCollectionItemSections).mockClear();
      await act(async () => {
        sortChip(renderer, 'date').props.onPress();
      });
      await flush();
      expect(sortChipLabel(renderer, 'date')).toBe(`${i18n.t('collections.sortDate')} ↓`);
      expect(getCollectionItemSections).toHaveBeenCalledTimes(1);
      expect(getCollectionItems).toHaveBeenLastCalledWith(expect.anything(), 1, expect.objectContaining({ sort: 'dateDesc', limit: 25, cursor: undefined, fromUtc: expect.any(String) }));
    });

    it('이름순 flips ↑ (A→Z) ↔ ↓ (Z→A) on a second press - title-less links stay last in both - with the direction in its accessibility label', async () => {
      const links = [
        makeItemEntry({ itemId: 1, title: 'banana', addedAtUtc: new Date().toISOString() }),
        makeItemEntry({ itemId: 2, title: 'Cherry', addedAtUtc: new Date().toISOString() }),
        makeItemEntry({ itemId: 3, title: 'apple', addedAtUtc: new Date().toISOString() }),
        makeItemEntry({ itemId: 4, title: null, url: 'https://zzz.example/x', addedAtUtc: new Date().toISOString() }),
      ];
      serveCollection(links);
      const renderer = await renderScreen();
      const titlesShown = () => (findItemList(renderer).props.data as { title: string | null }[]).map(entry => entry.title);

      await act(async () => {
        sortChip(renderer, 'name').props.onPress();
      });
      await flush();
      expect(sortChipLabel(renderer, 'name')).toBe(`${i18n.t('collections.sortName')} ↑`);
      expect(sortChip(renderer, 'name').props.accessibilityLabel).toBe(i18n.t('collections.sortNameAscA11y'));
      expect(titlesShown()).toEqual(['apple', 'banana', 'Cherry', null]);

      await act(async () => {
        sortChip(renderer, 'name').props.onPress();
      });
      await flush();
      expect(sortChipLabel(renderer, 'name')).toBe(`${i18n.t('collections.sortName')} ↓`);
      expect(sortChip(renderer, 'name').props.accessibilityLabel).toBe(i18n.t('collections.sortNameDescA11y'));
      expect(titlesShown()).toEqual(['Cherry', 'banana', 'apple', null]);

      // 시간순 is a separate chip: pressing it leaves 이름순 and starts at ↓ newest again.
      await act(async () => {
        sortChip(renderer, 'date').props.onPress();
      });
      await flush();
      expect(sortChip(renderer, 'date').props.accessibilityState).toEqual({ selected: true });
      expect(sortChip(renderer, 'name').props.accessibilityState).toEqual({ selected: false });
    });

    it('이름순 of a Collection with more links than can be name-ordered as a whole is refused with the reason - it stays on 시간순', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ itemCount: NAME_ORDER_MAX_LINKS + 1 }));
      serveCollection(manyLinks(60));
      const renderer = await renderScreen();
      jest.mocked(getCollectionItems).mockClear();

      await act(async () => {
        sortChip(renderer, 'name').props.onPress();
      });

      expect(getCollectionItems).not.toHaveBeenCalled();
      expect(renderer.root.findByProps({ children: i18n.t('collections.sortNameTooLarge', { max: NAME_ORDER_MAX_LINKS }) })).toBeTruthy();
      expect(sortChip(renderer, 'date').props.accessibilityState).toEqual({ selected: true });
    });

    it('if the Collection turns out larger than that while loading for 이름순, nothing partial is shown and it goes back to 시간순', async () => {
      serveCollection(manyLinks(NAME_ORDER_MAX_LINKS + 20));
      const renderer = await renderScreen();

      await act(async () => {
        sortChip(renderer, 'name').props.onPress();
      });
      await flush();

      expect(renderer.root.findByProps({ children: i18n.t('collections.sortNameTooLarge', { max: NAME_ORDER_MAX_LINKS }) })).toBeTruthy();
      expect(renderer.root.findByType(FlatList).props.numColumns).toBeUndefined();
      expect(getCollectionItems).toHaveBeenLastCalledWith(expect.anything(), 1, expect.objectContaining({ sort: 'dateDesc', limit: 25, fromUtc: expect.any(String) }));
      expect(findItemList(renderer).props.data[0].itemId).toBe(1);
    });
  });

  describe('bottom inset layout (system nav bar overlap regression)', () => {
    // The list viewport itself must end above the system nav bar: the screen root is the shared
    // StackScreenSafeArea (real container padding), never an inset folded into list content padding.
    async function expectListInsideStackSafeArea(renderer: ReactTestRenderer.ReactTestRenderer) {
      const safeAreaRoots = renderer.root.findAllByType(StackScreenSafeArea);
      expect(safeAreaRoots).toHaveLength(1);
      const list = findItemList(safeAreaRoots[0]);
      expect(StyleSheet.flatten(list.props.style)).toMatchObject({ flex: 1 });
      expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBe(spacing.xl);
    }

    beforeEach(() => {
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [makeItemEntry({ itemId: 1 }), makeItemEntry({ itemId: 2 })], nextCursor: null });
    });

    it('keeps List and Grid inside the StackScreenSafeArea root', async () => {
      const renderer = await renderScreen();
      await expectListInsideStackSafeArea(renderer);

      await act(async () => {
        renderer.root.findByProps({ accessibilityLabel: 'Grid view' }).props.onPress();
      });
      // 시간순 Grid: tiles inside the open date section's card.
      expect(renderer.root.findAllByType(SavedLinkGridCard).length).toBeGreaterThan(0);
      await expectListInsideStackSafeArea(renderer);
    });

    it('Grid cards use the same full date+time mode as List rows', async () => {
      const renderer = await renderScreen();
      const listRows = renderer.root.findAllByType(SavedLinkRow);
      expect(listRows.length).toBeGreaterThan(0);
      expect(listRows.every(row => row.props.dateDisplayMode === 'dateTime')).toBe(true);

      await act(async () => {
        renderer.root.findByProps({ accessibilityLabel: 'Grid view' }).props.onPress();
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

  describe('category management actions', () => {
    async function openItemMenu(renderer: ReactTestRenderer.ReactTestRenderer, item = makeItemEntry({ itemId: 9 })) {
      await longPressRow(getRowElement(renderer, item));
    }
    async function chooseTarget(renderer: ReactTestRenderer.ReactTestRenderer) {
      await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Target' }).props.onPress());
    }
    it('a List row has no trailing "..." - a long press opens the link menu, without navigating', async () => {
      const item = makeItemEntry({ itemId: 9 });
      const renderer = await renderScreen();
      const row = getRowElement(renderer, item);
      expect(row.root.findAll(node => node.props.accessibilityLabel === i18n.t('collections.itemManageAction'))).toHaveLength(0);
      expect(row.root.findAllByType(SavedLinkRow)[0].props.trailingAction).toBeUndefined();

      await longPressRow(row);
      expect((navigation as { navigate: jest.Mock }).navigate).not.toHaveBeenCalled();
      expect(renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.addToOther') })).toBeTruthy();
    });

    it('in Grid too, a long press opens the same link menu; a short tap still opens the link', async () => {
      const item = makeItemEntry({ itemId: 9 });
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [item], nextCursor: null });
      const renderer = await renderScreen();
      await act(async () => {
        renderer.root.findByProps({ accessibilityLabel: 'Grid view' }).props.onPress();
      });
      expect(renderer.root.findAllByType(SavedLinkGridCard).length).toBeGreaterThan(0);
      const tile = renderer.root.findAll(node => typeof node.props.onLongPress === 'function' && typeof node.props.onShare === 'function')[0];

      await act(async () => tile.props.onLongPress());
      const itemMenu = renderer.root.findAllByType(ActionMenuDialog).find(dialog => dialog.props.visible
        && dialog.props.actions.some((action: { label: string }) => action.label === i18n.t('collections.addToOther')));
      expect(itemMenu).toBeTruthy();
      expect((navigation as { navigate: jest.Mock }).navigate).not.toHaveBeenCalled();
      await act(async () => itemMenu!.props.onCancel());

      await act(async () => tile.props.onPress());
      expect((navigation as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith('ItemDetails', { itemId: 9, collectionContext: { collectionId: 1, canRemove: true, isCollectionOwner: true, isCollaborative: false } });
    });
    // Full item delete used to live in this same menu (see the removed "CollectionDetailsScreen
    // item delete undo" test block) - product policy now restricts general item delete to
    // Home/History only, so this menu goes back to offering only Add/Move.
    it('offers only Add/Move in the link More menu - no Delete option', async () => {
      const item = makeItemEntry({ itemId: 9 });
      const renderer = await renderScreen();
      await longPressRow(getRowElement(renderer, item));

      const itemMenu = renderer.root.findAllByType(ActionMenuDialog).find(
        node => node.props.actions.some((action: { label: string }) => action.label === i18n.t('collections.addToOther')),
      );
      expect(itemMenu).toBeTruthy();
      const labels = itemMenu!.props.actions.map((action: { label: string }) => action.label);
      expect(labels).toEqual([i18n.t('collections.addToOther'), i18n.t('collections.moveToOther')]);
      // 복제 (the same add-to-another-collection action as before, only named for what it does) and 이동, each with its icon.
      expect(labels).toEqual(['다른 컬렉션에 복제', '다른 컬렉션으로 이동']);
      expect(itemMenu!.findAllByType(CopyIcon)).toHaveLength(1);
      expect(itemMenu!.findAllByType(MoveIcon)).toHaveLength(1);
    });

    it('moves only once a destination is chosen and 이동 is pressed - choosing alone changes nothing', async () => {
      jest.mocked(transferCollectionItem).mockResolvedValue({ targetMembershipCreated: true });
      const renderer = await renderScreen(); await openItemMenu(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress());
      await act(async () => renderer.root.findAll(node => node.props.testID === 'category-picker-option-2' && typeof node.props.onPress === 'function')[0].props.onPress());
      expect(transferCollectionItem).not.toHaveBeenCalled();
      const submit = renderer.root.findAll(node => node.props.testID === 'category-picker-submit' && typeof node.props.onPress === 'function')[0];
      expect(submit.props.disabled).toBe(false);
      await act(async () => submit.props.onPress());
      expect(transferCollectionItem).toHaveBeenCalledWith(expect.anything(), 1, 9, 2, null);
      expect(renderer.root.findByType(CategoryPickerModal).props.visible).toBe(false);
    });
    it('shows undo after a move and sends the server-created target flag back unchanged', async () => {
      jest.mocked(transferCollectionItem).mockResolvedValue({ targetMembershipCreated: true });
      jest.mocked(undoTransferCollectionItem).mockResolvedValue(undefined);
      const renderer = await renderScreen(); await openItemMenu(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress()); await moveViaPicker(renderer);
      expect(renderer.root.findByProps({ children: i18n.t('toast.moveSuccess') })).toBeTruthy();
      // Stack screen with no bottom tab bar and no fixed bottom action bar - the toast floats
      // directly above the safe-area inset (mocked to 0 here - see useSafeAreaInsets mock above),
      // not some tab-bar/action-bar height.
      expect(renderer.root.findByType(UndoToast).props.bottomOffset).toBe(0);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress());
      expect(undoTransferCollectionItem).toHaveBeenCalledWith(expect.anything(), 1, 9, 2, true);
    });
    it('passes false unchanged when the target already contained the item', async () => {
      jest.mocked(transferCollectionItem).mockResolvedValue({ targetMembershipCreated: false });
      jest.mocked(undoTransferCollectionItem).mockResolvedValue(undefined);
      const renderer = await renderScreen(); await openItemMenu(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress()); await moveViaPicker(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress());
      expect(undoTransferCollectionItem).toHaveBeenCalledWith(expect.anything(), 1, 9, 2, false);
    });
    it('restores the row after undo succeeds and the refreshed source page includes it again', async () => {
      const item = makeItemEntry({ itemId: 9 });
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [item], nextCursor: null });
      jest.mocked(transferCollectionItem).mockResolvedValue({ targetMembershipCreated: true });
      jest.mocked(undoTransferCollectionItem).mockResolvedValue(undefined);
      const renderer = await renderScreen(); await openItemMenu(renderer, item);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress()); await moveViaPicker(renderer);
      expect(findItemList(renderer).props.data).toHaveLength(0);
      await act(async () => { renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress(); await Promise.resolve(); });
      expect(undoTransferCollectionItem).toHaveBeenCalledWith(expect.anything(), 1, 9, 2, true);
      expect(findItemList(renderer).props.data).toHaveLength(1);
      expect(findItemList(renderer).props.data[0].itemId).toBe(9);
      expect(renderer.root.findAllByProps({ accessibilityLabel: i18n.t('toast.undoAction') })).toHaveLength(0);
      expect(renderer.root.findAll(node => node.props.children === '되돌렸습니다.').length).toBe(0);
    });
    it('keeps the moved state and shows the existing error dialog when undo fails', async () => {
      const item = makeItemEntry({ itemId: 9 });
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [item], nextCursor: null });
      jest.mocked(transferCollectionItem).mockResolvedValue({ targetMembershipCreated: true });
      jest.mocked(undoTransferCollectionItem).mockRejectedValue(new Error('no'));
      const renderer = await renderScreen(); await openItemMenu(renderer, item);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress()); await moveViaPicker(renderer);
      await act(async () => { renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress(); await Promise.resolve(); });
      expect(findItemList(renderer).props.data).toHaveLength(0);
      expect(renderer.root.findAllByProps({ accessibilityLabel: i18n.t('toast.undoAction') })).toHaveLength(0);
      expect(renderer.root.findByProps({ children: i18n.t('toast.undoMoveError') })).toBeTruthy();
    });
    it('does not send a second undo request while the first is pending', async () => {
      let resolveUndo!: () => void;
      jest.mocked(transferCollectionItem).mockResolvedValue({ targetMembershipCreated: true });
      jest.mocked(undoTransferCollectionItem).mockImplementation(() => new Promise<void>(resolve => { resolveUndo = resolve; }));
      const renderer = await renderScreen(); await openItemMenu(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress()); await moveViaPicker(renderer);
      const undo = renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress;
      await act(async () => { undo(); undo(); });
      expect(undoTransferCollectionItem).toHaveBeenCalledTimes(1);
      await act(async () => { resolveUndo(); await Promise.resolve(); });
    });
    it('keeps the screen and shows an error when move fails', async () => {
      jest.mocked(transferCollectionItem).mockRejectedValue(new Error('no'));
      const renderer = await renderScreen(); await openItemMenu(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress()); await moveViaPicker(renderer);
      expect(renderer.root.findAll(node => node.props.children === i18n.t('collections.moveError')).length).toBeGreaterThan(0);
    });
    /** Drives the whole merge confirm flow (manage menu -> merge action -> pick target -> confirm) up to and including the mergeCollection call. */
    async function performMerge(renderer: ReactTestRenderer.ReactTestRenderer) {
      const header = getHeaderElement(renderer);
      await act(async () => header.root.findByProps({ accessibilityLabel: i18n.t('collections.manageAction') }).props.onPress());
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.mergeWithOther') }).props.onPress()); await chooseTarget(renderer);
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.mergeAction') }).props.onPress());
    }

    it('merges only after confirmation, replaces the detail route, and shows the global undo toast with the received undoOperationId', async () => {
      jest.mocked(mergeCollection).mockResolvedValue({ undoOperationId: 'merge-op-1' });
      const renderer = await renderScreen(); const header = getHeaderElement(renderer);
      await act(async () => header.root.findByProps({ accessibilityLabel: i18n.t('collections.manageAction') }).props.onPress());
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.mergeWithOther') }).props.onPress()); await chooseTarget(renderer);
      expect(mergeCollection).not.toHaveBeenCalled();
      await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.mergeAction') }).props.onPress());
      expect(mergeCollection).toHaveBeenCalledWith(expect.anything(), 1, 2);
      expect((navigation as { replace: jest.Mock }).replace).toHaveBeenCalledWith('CollectionDetails', { collectionId: 2 });
      const undoToast = renderer.root.findByType(UndoToast);
      expect(undoToast.props.message).toBe(i18n.t('toast.collectionMergeSuccess'));
      expect(typeof undoToast.props.onUndo).toBe('function');
    });
    it('keeps the source screen and shows an error when merge fails', async () => {
      jest.mocked(mergeCollection).mockRejectedValue(new Error('no'));
      const renderer = await renderScreen();
      await performMerge(renderer);
      expect((navigation as { replace: jest.Mock }).replace).not.toHaveBeenCalled();
      expect(renderer.root.findAll(node => node.props.children === i18n.t('collections.mergeError')).length).toBeGreaterThan(0);
      expect(renderer.root.findAllByType(UndoToast)).toHaveLength(0);
    });
    it('does not show an undo toast when undoOperationId is null (source-equals-target no-op)', async () => {
      jest.mocked(mergeCollection).mockResolvedValue({ undoOperationId: null });
      const renderer = await renderScreen();
      await performMerge(renderer);
      expect((navigation as { replace: jest.Mock }).replace).toHaveBeenCalledWith('CollectionDetails', { collectionId: 2 });
      expect(renderer.root.findAllByType(UndoToast)).toHaveLength(0);
    });
    it('undoing a merge calls undoCollectionMerge exactly once and navigates back to the target with a refresh signal, without any extra success message', async () => {
      jest.mocked(mergeCollection).mockResolvedValue({ undoOperationId: 'merge-op-2' });
      jest.mocked(undoCollectionMerge).mockResolvedValue(undefined);
      const renderer = await renderScreen();
      await performMerge(renderer);
      await act(async () => { renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress(); await Promise.resolve(); });
      expect(undoCollectionMerge).toHaveBeenCalledTimes(1);
      expect(undoCollectionMerge).toHaveBeenCalledWith(expect.anything(), 'merge-op-2');
      expect((navigation as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith(
        'CollectionDetails', expect.objectContaining({ collectionId: 2, refreshToken: expect.any(Number) }));
      expect(renderer.root.findAllByProps({ accessibilityLabel: i18n.t('toast.undoAction') })).toHaveLength(0);
      expect(renderer.root.findAll(node => node.props.children === i18n.t('toast.collectionMergeSuccess')).length).toBe(0);
    });
    it('keeps the merged state and shows the existing error dialog when undoing a merge fails', async () => {
      jest.mocked(mergeCollection).mockResolvedValue({ undoOperationId: 'merge-op-3' });
      jest.mocked(undoCollectionMerge).mockRejectedValue(new Error('no'));
      const renderer = await renderScreen();
      await performMerge(renderer);
      await act(async () => { renderer.root.findByProps({ accessibilityLabel: i18n.t('toast.undoAction') }).props.onPress(); await Promise.resolve(); });
      expect(renderer.root.findAllByProps({ accessibilityLabel: i18n.t('toast.undoAction') })).toHaveLength(0);
      expect(renderer.root.findByProps({ children: i18n.t('toast.undoCollectionMergeError') })).toBeTruthy();
    });
    describe('이동 uses the same destination picker as 복제 and 복사 - but with one destination', () => {
      const SOURCE = makeCollection({ id: 1, name: 'Groceries' });
      const TARGETS = [makeCollection({ id: 2, name: 'Target' }), makeCollection({ id: 3, name: 'Second' })];
      const picker = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findByType(CategoryPickerModal);
      const optionOf = (renderer: ReactTestRenderer.ReactTestRenderer, id: number) =>
        renderer.root.findAll(node => node.props.testID === `category-picker-option-${id}` && typeof node.props.onPress === 'function')[0];

      beforeEach(() => {
        jest.mocked(getCollections).mockReset();
        jest.mocked(getCollections).mockResolvedValue({ items: [SOURCE, ...TARGETS], nextCursor: null });
        jest.mocked(transferCollectionItem).mockResolvedValue({ targetMembershipCreated: true });
      });

      it('has the list/grid toggle, the order chips, a selected count, and "+ 새 컬렉션 만들기" with a folder-style icon', async () => {
        const renderer = await renderScreen(); await openItemMenu(renderer);
        await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress());

        expect(picker(renderer).props.visible).toBe(true);
        expect(picker(renderer).findAllByType(ViewModeToggle)).toHaveLength(1);
        expect(picker(renderer).props.sort.value).toBe('newest');
        expect(picker(renderer).props.viewModeKey).toBe('replicatePickerViewMode');
        // The create entry leads the list, labelled 새 컬렉션 만들기 and drawn as a folder.
        expect(picker(renderer).props.showCreateTile ?? true).toBe(true);
        expect(picker(renderer).props.createLabel).toBe('추가');
        expect(picker(renderer).props.createAccessibilityLabel).toBe('새 컬렉션 만들기');
        const create = renderer.root.findAll(node => node.props.accessibilityLabel === '새 컬렉션 만들기' && typeof node.props.onPress === 'function')[0];
        expect(create).toBeDefined();
        // Short on screen (it was cramped), complete for a screen reader.
        expect(create.findAllByType(Text).map(node => node.props.children)).toEqual(['추가']);
        expect(create.findAllByType(FolderPlusIcon)).toHaveLength(1);
        expect(renderer.root.findAllByType(Text).some(node => node.props.children === '0개 선택됨')).toBe(true);
      });

      it('the Collection the link is moved out of is shown but cannot be chosen', async () => {
        const renderer = await renderScreen(); await openItemMenu(renderer);
        await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress());

        expect(optionOf(renderer, 1).props.accessibilityState).toEqual({ selected: false, disabled: true });
        await act(async () => optionOf(renderer, 1).props.onPress());
        expect(picker(renderer).props.selectedIds.size).toBe(0);
        // Nothing is chosen yet, so 이동 is off.
        expect(renderer.root.findAll(node => node.props.testID === 'category-picker-submit')[0].props.disabled).toBe(true);
      });

      it('one destination at a time: choosing another replaces the choice, and the count stays 1', async () => {
        const renderer = await renderScreen(); await openItemMenu(renderer);
        await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress());

        await act(async () => optionOf(renderer, 2).props.onPress());
        await act(async () => optionOf(renderer, 3).props.onPress());
        expect([...picker(renderer).props.selectedIds]).toEqual([3]);
        await act(async () => renderer.root.findAll(node => node.props.testID === 'category-picker-submit' && typeof node.props.onPress === 'function')[0].props.onPress());
        expect(transferCollectionItem).toHaveBeenCalledWith(expect.anything(), 1, 9, 3, null);
      });

      it('"+ 새 컬렉션 만들기" creates the Collection, chooses it at once, and the move goes there', async () => {
        const created = makeCollection({ id: 11, name: 'Fresh' });
        jest.mocked(createCollection).mockResolvedValue(created);
        const renderer = await renderScreen(); await openItemMenu(renderer);
        await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress());

        await act(async () => renderer.root.findAll(node => node.props.accessibilityLabel === '새 컬렉션 만들기' && typeof node.props.onPress === 'function')[0].props.onPress());
        expect(picker(renderer).props.isCreateDialogVisible).toBe(true);
        let accepted = false;
        await act(async () => {
          accepted = await picker(renderer).props.onCreateCollection('  Fresh  ', 'Folder', 'blue');
        });

        expect(accepted).toBe(true);
        expect(createCollection).toHaveBeenCalledWith(expect.anything(), 'Fresh', 'Folder', 'blue');
        expect(picker(renderer).props.isCreateDialogVisible).toBe(false);
        expect(picker(renderer).props.collectionPool[0]).toEqual(created);
        expect([...picker(renderer).props.selectedIds]).toEqual([11]);
        await act(async () => renderer.root.findAll(node => node.props.testID === 'category-picker-submit' && typeof node.props.onPress === 'function')[0].props.onPress());
        expect(transferCollectionItem).toHaveBeenCalledWith(expect.anything(), 1, 9, 11, null);
      });

      it('a locked destination asks for its password first and its grant travels with the move', async () => {
        jest.mocked(getCollections).mockResolvedValue({ items: [SOURCE, makeCollection({ id: 2, name: 'Target', isLocked: true })], nextCursor: null });
        jest.mocked(getCollection).mockImplementation(async (_request, collectionId) =>
          collectionId === 2 ? makeCollection({ id: 2, name: 'Target', isLocked: true }) : makeCollection());
        const renderer = await renderScreen(); await openItemMenu(renderer);
        await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress());

        await act(async () => optionOf(renderer, 2).props.onPress());
        expect(picker(renderer).props.unlockTarget).toEqual(expect.objectContaining({ id: 2 }));
        await act(async () => picker(renderer).props.onUnlockGranted('grant-2'));
        await act(async () => renderer.root.findAll(node => node.props.testID === 'category-picker-submit' && typeof node.props.onPress === 'function')[0].props.onPress());
        expect(transferCollectionItem).toHaveBeenCalledWith(expect.anything(), 1, 9, 2, 'grant-2');
      });

      it('a collection with members moves a link of mine as add + remove (the atomic move refuses shared Collections)', async () => {
        jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true }));
        jest.mocked(addItemToCollection).mockResolvedValue('added');
        jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
        const renderer = await renderScreen(); await openItemMenu(renderer);
        await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress());
        await moveViaPicker(renderer);

        expect(transferCollectionItem).not.toHaveBeenCalled();
        expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), 2, 9, { unlockToken: null });
        expect(removeItemFromCollection).toHaveBeenCalledWith(expect.anything(), 1, 9);
      });

      it('if the server still refuses the atomic move (a pending invitation), it falls back to add + remove', async () => {
        jest.mocked(transferCollectionItem).mockRejectedValue(new ApiError('conflict', 409, 'collaborationActive'));
        jest.mocked(addItemToCollection).mockResolvedValue('added');
        jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
        const renderer = await renderScreen(); await openItemMenu(renderer);
        await act(async () => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.moveToOther') }).props.onPress());
        await moveViaPicker(renderer);

        expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), 2, 9, { unlockToken: null });
        expect(removeItemFromCollection).toHaveBeenCalledWith(expect.anything(), 1, 9);
      });
    });
  });

  describe('다른 컬렉션에 복제 - this link into several of my Collections at once', () => {
    const OWN = [
      makeCollection({ id: 1, name: 'Groceries', createdAtUtc: '2026-09-01T00:00:00Z' }),
      makeCollection({ id: 2, name: 'Zoo', createdAtUtc: '2026-09-05T00:00:00Z' }),
      makeCollection({ id: 3, name: 'apple', createdAtUtc: '2026-09-04T00:00:00Z' }),
      makeCollection({ id: 4, name: 'Movies', createdAtUtc: '2026-09-03T00:00:00Z' }),
      makeCollection({ id: 5, name: 'Books', createdAtUtc: '2026-09-02T00:00:00Z', isLocked: true }),
      makeCollection({ id: 6, name: 'Kept', createdAtUtc: '2026-08-01T00:00:00Z' }),
    ];
    /** The link (9) is already in 1 (this Collection) and 6. */
    const CONTAINED = [OWN[0], OWN[5]];

    beforeEach(() => {
      jest.mocked(getCollections).mockImplementation(async (_request, options = {}) =>
        options.itemId !== undefined
          ? { items: CONTAINED, nextCursor: null }
          : { items: [...OWN].sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc)), nextCursor: null });
      jest.mocked(addItemToCollections).mockResolvedValue({ addedCount: 1, skippedCount: 0 });
      // A chosen Collection is judged by the server's CURRENT card (GET /collections/{id}), not by the listed one.
      jest.mocked(getCollection).mockImplementation(async (_request, collectionId) => OWN.find(entry => entry.id === collectionId) ?? makeCollection());
    });

    const picker = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findByType(CategoryPickerModal);
    const texts = (renderer: ReactTestRenderer.ReactTestRenderer) =>
      renderer.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));
    const option = (renderer: ReactTestRenderer.ReactTestRenderer, id: number) =>
      renderer.root.findAll(node => node.props.testID === `category-picker-option-${id}` && typeof node.props.onPress === 'function')[0];
    const tap = async (renderer: ReactTestRenderer.ReactTestRenderer, ...ids: number[]) => {
      for (const id of ids) {
        await act(async () => option(renderer, id).props.onPress());
      }
    };
    const submitButton = (renderer: ReactTestRenderer.ReactTestRenderer) =>
      renderer.root.findAll(node => node.props.testID === 'category-picker-submit' && typeof node.props.onPress === 'function')[0];
    const shownNames = (renderer: ReactTestRenderer.ReactTestRenderer) => picker(renderer).props.collectionPool.map((collection: Collection) => collection.name);

    async function openReplicate(renderer: ReactTestRenderer.ReactTestRenderer) {
      await longPressRow(getRowElement(renderer, makeItemEntry({ itemId: 9 })));
      await act(async () => renderer.root.findByProps({ accessibilityLabel: '다른 컬렉션에 복제' }).props.onPress());
    }

    it('lists my own Collections newest first, marks where the link already is, and starts with nothing chosen (복제 off)', async () => {
      const renderer = await renderScreen();
      await openReplicate(renderer);

      expect(picker(renderer).props.visible).toBe(true);
      expect(getCollections).toHaveBeenCalledWith(expect.anything(), { limit: 50 });
      expect(getCollections).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ itemId: 9 }));
      expect(shownNames(renderer)).toEqual(['Zoo', 'apple', 'Movies', 'Books', 'Groceries', 'Kept']);
      for (const contained of [1, 6]) {
        expect(option(renderer, contained).props.accessibilityState).toEqual({ selected: false, disabled: true });
        expect(renderer.root.findAll(node => node.props.testID === `category-picker-included-${contained}`).length).toBeGreaterThan(0);
      }
      expect(texts(renderer)).toContain('이미 포함됨');
      expect(texts(renderer)).toContain('0개 선택됨');
      expect(submitButton(renderer).props.disabled).toBe(true);
      // "+ 새 컬렉션 만들기" leads the list, with a folder-style icon.
      expect(picker(renderer).props.createLabel).toBe('추가');
        expect(picker(renderer).props.createAccessibilityLabel).toBe('새 컬렉션 만들기');
      expect(renderer.root.findAll(node => node.props.accessibilityLabel === '새 컬렉션 만들기' && typeof node.props.onPress === 'function')[0].findAllByType(FolderPlusIcon)).toHaveLength(1);
      expect(picker(renderer).props.viewModeKey).toBe('replicatePickerViewMode');

      // Tapping an already-included one does nothing.
      await tap(renderer, 6);
      expect(picker(renderer).props.selectedIds.size).toBe(0);
    });

    it('"+ 새 컬렉션 만들기" in 복제: the new Collection is chosen at once and joins the others in the one request', async () => {
      jest.mocked(createCollection).mockResolvedValue(makeCollection({ id: 12, name: 'Fresh' }));
      const renderer = await renderScreen();
      await openReplicate(renderer);
      await tap(renderer, 2);

      await act(async () => renderer.root.findAll(node => node.props.accessibilityLabel === '새 컬렉션 만들기' && typeof node.props.onPress === 'function')[0].props.onPress());
      await act(async () => {
        await picker(renderer).props.onCreateCollection('Fresh', 'Folder', 'blue');
      });
      expect([...picker(renderer).props.selectedIds]).toEqual([2, 12]);
      expect(shownNames(renderer)[0]).toBe('Fresh');
      await act(async () => submitButton(renderer).props.onPress());

      expect(addItemToCollections).toHaveBeenCalledWith(expect.anything(), 9, [2, 12], {});
    });

    it('one Collection: 복제 puts the link there and says so', async () => {
      const renderer = await renderScreen();
      await openReplicate(renderer);

      await tap(renderer, 2);
      expect(texts(renderer)).toContain('1개 선택됨');
      expect(texts(renderer)).toContain('1개 컬렉션에 복제');
      await act(async () => submitButton(renderer).props.onPress());

      expect(addItemToCollections).toHaveBeenCalledWith(expect.anything(), 9, [2], {});
      expect(addItemToCollection).not.toHaveBeenCalled();
      expect(picker(renderer).props.visible).toBe(false);
      expect(texts(renderer)).toContain('1개 컬렉션에 복제했어요.');
    });

    it('several, with one unchosen again - only what is still chosen is sent, in one request', async () => {
      jest.mocked(addItemToCollections).mockResolvedValue({ addedCount: 2, skippedCount: 0 });
      const renderer = await renderScreen();
      await openReplicate(renderer);

      await tap(renderer, 2, 3, 4);
      expect(texts(renderer)).toContain('3개 선택됨');
      await tap(renderer, 3);
      expect(texts(renderer)).toContain('2개 선택됨');
      await act(async () => submitButton(renderer).props.onPress());

      expect(addItemToCollections).toHaveBeenCalledTimes(1);
      expect(addItemToCollections).toHaveBeenCalledWith(expect.anything(), 9, [2, 4], {});
      expect(texts(renderer)).toContain('2개 컬렉션에 복제했어요.');
    });

    it('keeps the choice through List/Grid and 최신순/이름순 - by Collection, never by position', async () => {
      const renderer = await renderScreen();
      await openReplicate(renderer);
      await tap(renderer, 2, 4);

      await act(async () => renderer.root.findByType(CategoryPickerModal).findByType(ViewModeToggle).props.onChange('list'));
      expect([...picker(renderer).props.selectedIds]).toEqual([2, 4]);

      await act(async () => renderer.root.findAll(node => node.props.testID === 'category-picker-sort-title' && typeof node.props.onPress === 'function')[0].props.onPress());
      // 이름순 over the WHOLE list (every page, 100 at a time), in the app's language order.
      expect(getCollections).toHaveBeenCalledWith(expect.anything(), { limit: 100, cursor: undefined });
      expect(shownNames(renderer)).toEqual(['apple', 'Books', 'Groceries', 'Kept', 'Movies', 'Zoo']);
      expect([...picker(renderer).props.selectedIds]).toEqual([2, 4]);
      expect(option(renderer, 2).props.accessibilityState.selected).toBe(true);

      await act(async () => renderer.root.findAll(node => node.props.testID === 'category-picker-sort-newest' && typeof node.props.onPress === 'function')[0].props.onPress());
      expect(shownNames(renderer)[0]).toBe('Zoo');
      expect([...picker(renderer).props.selectedIds]).toEqual([2, 4]);
    });

    it('a locked Collection asks for its password first; cancelling leaves it unchosen, a grant chooses it and is sent with it', async () => {
      const renderer = await renderScreen();
      await openReplicate(renderer);

      await tap(renderer, 5);
      expect(picker(renderer).props.unlockTarget).toEqual(expect.objectContaining({ id: 5 }));
      await act(async () => picker(renderer).props.onUnlockCancel());
      expect(picker(renderer).props.unlockTarget).toBeNull();
      expect(picker(renderer).props.selectedIds.has(5)).toBe(false);

      await tap(renderer, 5);
      await act(async () => picker(renderer).props.onUnlockGranted('grant-5'));
      expect(picker(renderer).props.selectedIds.has(5)).toBe(true);
      await tap(renderer, 2);
      await act(async () => submitButton(renderer).props.onPress());

      expect(addItemToCollections).toHaveBeenCalledWith(expect.anything(), 9, [5, 2], { 5: 'grant-5' });
    });

    it('says when some chosen Collections already had it, and when all of them did', async () => {
      jest.mocked(addItemToCollections).mockResolvedValueOnce({ addedCount: 2, skippedCount: 1 });
      const renderer = await renderScreen();
      await openReplicate(renderer);
      await tap(renderer, 2, 3, 4);
      await act(async () => submitButton(renderer).props.onPress());
      expect(texts(renderer)).toContain('3개 중 2개 컬렉션에 복제했어요. 1개에는 이미 있어요.');

      jest.mocked(addItemToCollections).mockResolvedValueOnce({ addedCount: 0, skippedCount: 1 });
      await openReplicate(renderer);
      await tap(renderer, 2);
      await act(async () => submitButton(renderer).props.onPress());
      expect(texts(renderer)).toContain('선택한 컬렉션에 이미 이 링크가 있어요.');
    });

    it('a failure keeps the picker and the choice, for another try', async () => {
      jest.mocked(addItemToCollections).mockRejectedValueOnce(new Error('offline'));
      const renderer = await renderScreen();
      await openReplicate(renderer);
      await tap(renderer, 2, 4);

      await act(async () => submitButton(renderer).props.onPress());

      expect(picker(renderer).props.visible).toBe(true);
      expect([...picker(renderer).props.selectedIds]).toEqual([2, 4]);
      expect(picker(renderer).props.error).toBe('복제하지 못했어요. 다시 시도해 주세요.');

      jest.mocked(addItemToCollections).mockResolvedValueOnce({ addedCount: 2, skippedCount: 0 });
      await act(async () => submitButton(renderer).props.onPress());
      expect(addItemToCollections).toHaveBeenLastCalledWith(expect.anything(), 9, [2, 4], {});
      expect(picker(renderer).props.visible).toBe(false);
    });

    it('a server without the 복제 endpoint (404 - what the device hit on a backend that did not have it yet) keeps the choice for another try', async () => {
      jest.mocked(addItemToCollections).mockRejectedValueOnce(new ApiError('notFound', 404));
      const renderer = await renderScreen();
      await openReplicate(renderer);
      await tap(renderer, 2, 4);

      await act(async () => submitButton(renderer).props.onPress());

      expect(addItemToCollections).toHaveBeenCalledWith(expect.anything(), 9, [2, 4], {});
      expect(picker(renderer).props.visible).toBe(true);
      expect([...picker(renderer).props.selectedIds]).toEqual([2, 4]);
      expect(picker(renderer).props.error).toBe('복제하지 못했어요. 다시 시도해 주세요.');
    });

    it('취소 closes without sending anything, and the next time starts with nothing chosen', async () => {
      const renderer = await renderScreen();
      await openReplicate(renderer);
      await tap(renderer, 2);

      await act(async () => renderer.root.findAll(node => node.props.testID === 'category-picker-cancel' && typeof node.props.onPress === 'function')[0].props.onPress());
      expect(picker(renderer).props.visible).toBe(false);
      expect(addItemToCollections).not.toHaveBeenCalled();

      await openReplicate(renderer);
      expect(picker(renderer).props.selectedIds.size).toBe(0);
    });
  });
});
