import { ActionMenuDialog } from '../../components/ActionMenuDialog';
import { BellIcon } from '../../icons/BellIcon';
import { CopyIcon } from '../../icons/CopyIcon';
import { colors, radii } from '../../theme/tokens';
import { PendingActionRow } from '../../components/PendingActionRow';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ApprovalSubmissionSheet } from '../../collections/ApprovalSubmissionSheet';
import { JoinRequestsSheet } from '../../collections/JoinRequestsSheet';
import { CollectionParticipantsSheet } from '../../collections/CollectionParticipantsSheet';
import { ParticipantAvatarStack } from '../../components/ParticipantAvatarStack';
import { QuickReactionBar } from '../../reactions/QuickReactionBar';
import { ReactionChips } from '../../reactions/ReactionChips';
import { ReactionPickerDialog } from '../../reactions/ReactionPickerDialog';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, StyleSheet, Switch, Text } from 'react-native';
import { dateAccordionStyles } from '../../components/DateAccordion';
import { LinkSortChips } from '../../components/LinkSortChips';
import { LINK_CONTROLS_BOTTOM_GAP, LINK_CONTROLS_TOP_GAP } from '../../components/savedLinkLayout';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { AppToastProvider } from '../../components/AppToast';
import { CollectionDetailsScreen } from '../CollectionDetailsScreen';
import { shareItem } from '../../items/shareItem';
import { CategoryPickerModal } from '../../collections/CategoryPickerModal';
import { SwipeableItemRow } from '../../components/SwipeableItemRow';
import { SavedLinkGridCard as GridCardComponent } from '../../components/SavedLinkGridCard';
import { UserAvatar } from '../../components/UserAvatar';
import { ViewModeToggle } from '../../components/ViewModeToggle';
import { CrownIcon } from '../../icons/CrownIcon';
import { CollectionLinkShareSheet } from '../../collections/CollectionLinkShareSheet';
import {
  addItemToCollection,
  addItemToCollections,
  setItemReaction,
  removeItemReaction,
  copyCollectionItems,
  transferCollectionItem,
  getCollection,
  getCollectionShareLink,
  removeItemFromCollection,
  getCollectionItems,
  getCollectionItemSections,
  getCollectionNotificationPreference,
  getCollections,
  getCollectionShare,
  setCollectionNotificationPreference,
  setCollectionLock,
  unlockCollection,
  type Collection,
  type CollectionItemEntry,
} from '../../collections/api/collectionsApi';
import { getCollectionLockPasswordStatus } from '../../collections/api/collectionLockPasswordApi';
import { getCollectionParticipants, removeCollaborator, revokeCollectionInvitation } from '../../collections/api/collaborationApi';
import {
  clearCollectionUnlockGrants,
  getCollectionUnlockToken,
  rememberCollectionUnlock,
} from '../../collections/collectionUnlockGrants';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

/** The destination picker's own controls - the one list/grid picker behind 복제, 내 컬렉션으로 복사 and 이동. */
const destinationOption = (renderer: ReactTestRenderer.ReactTestRenderer, id: number) =>
  renderer.root.findAll(node => node.props.testID === `category-picker-option-${id}` && typeof node.props.onPress === 'function')[0];
const destinationSubmit = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(node => node.props.testID === 'category-picker-submit' && typeof node.props.onPress === 'function')[0];
const destinationPicker = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findByType(CategoryPickerModal);
/** Chooses these destinations, then presses the picker's action. */
async function chooseDestinations(renderer: ReactTestRenderer.ReactTestRenderer, ...ids: number[]) {
  for (const id of ids) {
    await act(async () => destinationOption(renderer, id).props.onPress());
  }
  await act(async () => destinationSubmit(renderer).props.onPress());
}

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../../collections/api/collectionsApi', () => ({
  getCollection: jest.fn(),
  getCollectionItems: jest.fn(),
  getCollectionItemSections: jest.fn(),
  getCollectionShare: jest.fn().mockResolvedValue(null),
  getCollections: jest.fn(),
  unlockCollection: jest.fn(),
  setCollectionLock: jest.fn(),
  removeCollectionLock: jest.fn(),
  getCollectionNotificationPreference: jest.fn(),
  setCollectionNotificationPreference: jest.fn(),
  copyCollectionItems: jest.fn(),
  getCollectionShareLink: jest.fn().mockResolvedValue(null),
  getCollectionSubmissions: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  getMyCollectionSubmissions: jest.fn().mockResolvedValue({ items: [], nextCursor: null, totalCount: 0 }),
  approveCollectionSubmission: jest.fn(),
  rejectCollectionSubmission: jest.fn(),
  removeItemFromCollection: jest.fn(),
  addItemToCollection: jest.fn(),
  addItemToCollections: jest.fn(),
  setItemReaction: jest.fn(),
  removeItemReaction: jest.fn(),
  createCollection: jest.fn(),
  transferCollectionItem: jest.fn(),
  sendCollectionShareLink: jest.fn(),
  MAX_ITEMS_PER_COPY: 200,
  MAX_LINK_SHARE_RECIPIENTS: 20,
}));
jest.mock('../../categories/collectionShortcutSync', () => ({ reconcileCollectionShortcuts: jest.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  jest.mocked(getCollectionNotificationPreference).mockResolvedValue({ newItemNotificationsEnabled: true });
});

jest.mock('../../items/shareItem', () => ({ shareItem: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../collections/api/collectionLockPasswordApi', () => ({
  getCollectionLockPasswordStatus: jest.fn().mockResolvedValue({ isConfigured: true, passwordChangedAtUtc: '2026-09-27T00:00:00Z' }),
}));
jest.mock('../../collections/api/collaborationApi', () => ({
  ...jest.requireActual('../../collections/api/collaborationApi'),
  getCollectionParticipants: jest.fn().mockResolvedValue({
    participants: [
      { jupleId: 'K7MP4Q8N', displayName: '피카츄', role: 'owner' },
      { jupleId: 'CNTRB234', displayName: '파이리', role: 'contributor', isMe: true },
    ],
    pendingInvitations: [],
    canManage: false,
  }),
  removeCollaborator: jest.fn().mockResolvedValue(undefined),
  revokeCollectionInvitation: jest.fn().mockResolvedValue(undefined),
}));

const COLLECTION_ID = 1;

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: COLLECTION_ID,
    name: 'Trip',
    isFavorite: false,
    itemCount: 2,
    createdAtUtc: '2026-01-01T00:00:00Z',
    updatedAtUtc: '2026-01-01T00:00:00Z',
    icon: 'Folder',
    color: null,
    ...overrides,
  };
}

function makeItem(overrides: Partial<CollectionItemEntry> = {}): CollectionItemEntry {
  return {
    itemId: 1,
    url: 'https://example.com',
    title: 'Example',
    memo: null,
    addedAtUtc: '2026-01-01T00:00:00Z',
    sortOrder: 0,
    representativeImage: null,
    previewImageUrl: null,
    coverImage: null,
    ...overrides,
  };
}

const mine = makeItem({ itemId: 1, title: 'Mine', isMine: true, memo: 'my memo' });
const theirs = makeItem({ itemId: 2, title: 'Theirs', isMine: false });
const lockedError = new ApiError('forbidden', 403, 'collectionLocked');


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

const route = { key: 'CollectionDetails', name: 'CollectionDetails', params: { collectionId: COLLECTION_ID } } as never;
const mockNavigate = jest.fn();
const navigation = { navigate: mockNavigate, goBack: jest.fn(), replace: jest.fn(), popTo: jest.fn(), setParams: jest.fn() } as never;

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

function renderPart(element: React.ReactElement) {
  let part!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    part = ReactTestRenderer.create(<AppToastProvider>{element}</AppToastProvider>);
  });
  return part;
}

const header = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderPart(findItemList(renderer).props.ListHeaderComponent);

const row = (renderer: ReactTestRenderer.ReactTestRenderer, item: CollectionItemEntry) =>
  renderPart(findItemList(renderer).props.renderItem({ item, index: 0 }));

const hasLabel = (part: ReactTestRenderer.ReactTestRenderer, label: string) =>
  part.root.findAll(node => node.props.accessibilityLabel === label).length > 0;

/** The header's own buttons, in order. */
const headerButtonIds = (part: ReactTestRenderer.ReactTestRenderer) =>
  part.root
    .findAll(node => typeof node.props.testID === 'string' && typeof node.props.onPress === 'function' && /^collection-details-(favorite|notifications|share|more)$/.test(node.props.testID))
    .map(node => node.props.testID as string);

describe('CollectionDetailsScreen - Viewer (보기 전용)', () => {
  const ownersLink = makeItem({ itemId: 2, title: 'Owner link', isMine: false });

  beforeEach(() => {
    jest.mocked(getCollection).mockResolvedValue(
      makeCollection({
        accessRole: 'viewer',
        ownerJupleId: 'K7MP4Q8N',
        participantPreview: [{ jupleId: 'K7MP4Q8N', displayName: '피카츄', role: 'owner' }],
        otherParticipantCount: 1,
      }),
    );
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [ownersLink], nextCursor: null });
  });

  afterEach(() => {
    jest.clearAllMocks();
    clearCollectionUnlockGrants();
  });

  it('reads the list and keeps only their own favorite star - no edit/delete/share/manage controls', async () => {
    const renderer = await renderScreen();
    const top = header(renderer);

    expect(top.root.findAllByType(ParticipantAvatarStack)).toHaveLength(1);
    expect(top.root.findAllByType(ParticipantAvatarStack)[0].props.participants.map((person: { jupleId: string }) => person.jupleId)).toEqual(['K7MP4Q8N', 'CNTRB234']);
    for (const label of [
      i18n.t('common.edit'),
      i18n.t('common.delete'),
      i18n.t('collections.shareAction'),
    ]) {
      expect(hasLabel(top, label)).toBe(false);
    }
    // [★] [🔔] [⋯]: their own 새 링크 알림 is the bell; the ⋯ holds only copying into their own Collection.
    expect(headerButtonIds(top)).toEqual(['collection-details-favorite', 'collection-details-notifications', 'collection-details-more']);
    expect(await recipientMenuLabels(renderer)).toEqual([i18n.t('collections.copyToMine'), i18n.t('collections.leaveAction')]);
    const menu = renderer.root.findAllByType(ActionMenuDialog).find(dialog => dialog.props.visible)!;
    expect(menu.findAllByType(BellIcon)).toHaveLength(0);
    expect(menu.findAllByType(CopyIcon)).toHaveLength(1);
    expect(hasLabel(top, i18n.t('collections.addFavorite'))).toBe(true);
    expect(getCollectionShare).not.toHaveBeenCalled();
    expect(findItemList(renderer).props.data).toEqual([ownersLink]);
  });

  it('opens a link only as the read-only shared view, and never offers removing, moving or reordering it', async () => {
    const renderer = await renderScreen();
    const itemRow = row(renderer, ownersLink);

    const actionNames = itemRow.root
      .findAll(node => Array.isArray(node.props.accessibilityActions))[0]
      .props.accessibilityActions.map((action: { name: string }) => action.name);
    expect(actionNames).not.toContain('delete');
    expect(hasLabel(itemRow, i18n.t('collections.itemManageAction'))).toBe(false);

    const pressable = itemRow.root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function')[0];
    act(() => {
      pressable.props.onPress();
    });
    expect(mockNavigate).toHaveBeenLastCalledWith('CollectionSharedItem', { collectionId: COLLECTION_ID, itemId: 2, isCollectionOwner: false });
  });
});

/** The ⋯ menu's labels, in order (opened through the header part's own button). */
async function recipientMenuLabels(renderer: ReactTestRenderer.ReactTestRenderer): Promise<string[]> {
  const top = header(renderer);
  const more = top.root.findAll(node => node.props.testID === 'collection-details-more' && typeof node.props.onPress === 'function')[0];
  await act(async () => more.props.onPress());
  const menu = renderer.root.findAllByType(ActionMenuDialog).find(dialog => dialog.props.visible);
  return (menu?.props.actions ?? []).map((action: { label: string }) => action.label);
}

async function pressMenu(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  await recipientMenuLabels(renderer);
  const menu = renderer.root.findAllByType(ActionMenuDialog).find(dialog => dialog.props.visible);
  await act(async () => menu?.props.actions.find((action: { label: string }) => action.label === label).onPress());
}

describe('CollectionDetailsScreen - shared with me: 새 링크 알림 and 내 컬렉션으로 복사', () => {
  const myOwn = makeCollection({ id: 7, name: 'My Picks', accessRole: 'owner' });

  beforeEach(() => {
    jest.mocked(getCollection).mockResolvedValue(
      makeCollection({
        accessRole: 'contributor',
        ownerJupleId: 'K7MP4Q8N',
        otherParticipantCount: 1,
      }),
    );
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine, theirs], nextCursor: null });
    jest.mocked(getCollections).mockResolvedValue({ items: [myOwn], nextCursor: null });
  });

  afterEach(() => {
    jest.clearAllMocks();
    clearCollectionUnlockGrants();
  });

  it('the header bell turns 새 링크 알림 off at once, and flips it back with a message when saving fails', async () => {
    jest.mocked(setCollectionNotificationPreference).mockResolvedValueOnce({ newItemNotificationsEnabled: false });
    const renderer = await renderScreen();
    expect(getCollectionNotificationPreference).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID);
    const bell = () => header(renderer).root.findAll(node => node.props.testID === 'collection-details-notifications' && typeof node.props.onPress === 'function')[0];
    const pressBell = async () => {
      const onPress = bell().props.onPress;
      await act(async () => onPress());
    };

    expect(bell().props.accessibilityLabel).toBe(i18n.t('collections.newLinkNotificationsOnA11y'));
    await pressBell();
    expect(setCollectionNotificationPreference).toHaveBeenLastCalledWith(expect.anything(), COLLECTION_ID, false);
    expect(bell().props.accessibilityLabel).toBe(i18n.t('collections.newLinkNotificationsOffA11y'));
    // No dialog any more - the bell is the whole control.
    expect(renderer.root.findAll(node => node.props.testID === 'collection-notification-dialog')).toHaveLength(0);

    jest.mocked(setCollectionNotificationPreference).mockRejectedValueOnce(new Error('offline'));
    await pressBell();
    expect(bell().props.accessibilityLabel).toBe(i18n.t('collections.newLinkNotificationsOffA11y')); // rolled back
    expect(renderer.root.findAllByType(Text).some(node => node.props.children === i18n.t('collections.newLinkNotificationsError'))).toBe(true);
  });

  it('copies the picked links into a Collection of my own and reports the result', async () => {
    jest.mocked(copyCollectionItems).mockResolvedValue({ copiedCount: 1, skippedCount: 1, unavailableCount: 0 });
    const renderer = await renderScreen();

    await pressMenu(renderer, i18n.t('collections.copyToMine'));
    // Selection mode: rows are checkboxes - a tap picks, never opens the link.
    const pick = (item: CollectionItemEntry) => {
      const part = row(renderer, item);
      const checkbox = part.root.findAll(node => node.props.accessibilityRole === 'checkbox' && typeof node.props.onPress === 'function')[0];
      act(() => checkbox.props.onPress());
    };
    pick(theirs);
    pick(mine);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType(Text).some(node => node.props.children === i18n.t('collections.copySelectedCount', { count: 2 }))).toBe(true);
    // Picking again unpicks.
    pick(mine);
    pick(mine);

    const confirm = renderer.root.findAll(node => node.props.testID === 'collection-copy-confirm' && typeof node.props.onPress === 'function')[0];
    await act(async () => confirm.props.onPress());
    // Only my own Collections are offered (owned scope - no scope parameter).
    expect(getCollections).toHaveBeenLastCalledWith(expect.anything(), { limit: 50 });
    // The same picker as 복제: nothing is copied by choosing alone - 복사 does it.
    await act(async () => destinationOption(renderer, 7).props.onPress());
    expect(copyCollectionItems).not.toHaveBeenCalled();
    await act(async () => destinationSubmit(renderer).props.onPress());

    expect(copyCollectionItems).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, [2, 1], 7, null);
    expect(renderer.root.findAllByType(Text).some(node => node.props.children === '2개 중 1개를 복사했어요. 1개는 이미 컬렉션에 있어요.')).toBe(true);
    // Selection mode is over.
    expect(renderer.root.findAll(node => node.props.testID === 'collection-copy-bar')).toHaveLength(0);
  });

  describe('내 컬렉션으로 복사 into several of my Collections at once (the same picker as 복제)', () => {
    const other = makeCollection({ id: 8, name: 'More Picks', accessRole: 'owner' });
    const third = makeCollection({ id: 9, name: 'Third Picks', accessRole: 'owner' });

    async function openCopyPicker() {
      jest.mocked(getCollections).mockResolvedValue({ items: [myOwn, other, third], nextCursor: null });
      const renderer = await renderScreen();
      await pressMenu(renderer, i18n.t('collections.copyToMine'));
      const checkbox = row(renderer, theirs).root.findAll(node => node.props.accessibilityRole === 'checkbox' && typeof node.props.onPress === 'function')[0];
      act(() => checkbox.props.onPress());
      const confirm = renderer.root.findAll(node => node.props.testID === 'collection-copy-confirm' && typeof node.props.onPress === 'function')[0];
      await act(async () => confirm.props.onPress());
      return renderer;
    }
    const hasToast = (renderer: ReactTestRenderer.ReactTestRenderer, text: string) =>
      renderer.root.findAllByType(Text).some(node => node.props.children === text);

    it('has the list/grid toggle, order chips, a selected count, and "+ 새 컬렉션 만들기" - and nothing is selected at first', async () => {
      const renderer = await openCopyPicker();
      const modal = destinationPicker(renderer);

      expect(modal.props.visible).toBe(true);
      expect(modal.findAllByType(ViewModeToggle)).toHaveLength(1);
      expect(modal.props.sort.value).toBe('newest');
      expect(modal.props.createLabel).toBe('추가');
      expect(modal.props.createAccessibilityLabel).toBe('새 컬렉션 만들기');
      expect(modal.props.title).toBe(i18n.t('collections.copyPickerTitle'));
      expect(renderer.root.findAllByType(Text).some(node => node.props.children === '0개 선택됨')).toBe(true);
      expect(destinationSubmit(renderer).props.disabled).toBe(true);
      expect(destinationSubmit(renderer).findAllByType(Text)[0].props.children).toBe(i18n.t('collections.copyAction'));
    });

    it('several destinations: the same links are copied into each, one request per destination, and the result says so once', async () => {
      jest.mocked(copyCollectionItems).mockResolvedValue({ copiedCount: 1, skippedCount: 0, unavailableCount: 0 });
      const renderer = await openCopyPicker();

      await chooseDestinations(renderer, 7, 8);

      expect(copyCollectionItems).toHaveBeenCalledTimes(2);
      expect(copyCollectionItems).toHaveBeenNthCalledWith(1, expect.anything(), COLLECTION_ID, [theirs.itemId], 7, null);
      expect(copyCollectionItems).toHaveBeenNthCalledWith(2, expect.anything(), COLLECTION_ID, [theirs.itemId], 8, null);
      expect(destinationPicker(renderer).props.visible).toBe(false);
      expect(hasToast(renderer, i18n.t('collections.copyResultMulti', { links: 1, collections: 2 }))).toBe(true);
      expect(renderer.root.findAll(node => node.props.testID === 'collection-copy-bar')).toHaveLength(0);
    });

    it('one destination failing does not hide what the others did: it is reported, naming how many failed', async () => {
      jest.mocked(copyCollectionItems)
        .mockResolvedValueOnce({ copiedCount: 1, skippedCount: 0, unavailableCount: 0 })
        .mockRejectedValueOnce(new ApiError('unavailable', 503));
      const renderer = await openCopyPicker();

      await chooseDestinations(renderer, 7, 8);

      expect(copyCollectionItems).toHaveBeenCalledTimes(2);
      expect(destinationPicker(renderer).props.visible).toBe(false);
      expect(hasToast(renderer, `${i18n.t('collections.copyResultAll', { count: 1 })} ${i18n.t('collections.copyDestinationsFailed', { count: 1 })}`)).toBe(true);
    });

    it('every destination failing keeps the picker, the choice and the selection for another try', async () => {
      jest.mocked(copyCollectionItems).mockRejectedValue(new ApiError('unavailable', 503));
      const renderer = await openCopyPicker();

      await chooseDestinations(renderer, 7, 8);

      const modal = destinationPicker(renderer);
      expect(modal.props.visible).toBe(true);
      expect(modal.props.error).toBe(i18n.t('collections.copyError'));
      expect([...modal.props.selectedIds]).toEqual([7, 8]);
      expect(renderer.root.findAll(node => node.props.testID === 'collection-copy-bar').length).toBeGreaterThan(0);
    });

    it('"+ 새 컬렉션 만들기" is chosen at once next to the others', async () => {
      const { createCollection } = jest.requireMock('../../collections/api/collectionsApi');
      createCollection.mockResolvedValue(makeCollection({ id: 21, name: 'Fresh', accessRole: 'owner' }));
      jest.mocked(copyCollectionItems).mockResolvedValue({ copiedCount: 1, skippedCount: 0, unavailableCount: 0 });
      const renderer = await openCopyPicker();

      await act(async () => renderer.root.findAll(node => node.props.accessibilityLabel === '새 컬렉션 만들기' && typeof node.props.onPress === 'function')[0].props.onPress());
      await act(async () => {
        await destinationPicker(renderer).props.onCreateCollection('Fresh', 'Folder', 'blue');
      });
      await act(async () => destinationOption(renderer, 7).props.onPress());
      await act(async () => destinationSubmit(renderer).props.onPress());

      expect(copyCollectionItems).toHaveBeenNthCalledWith(1, expect.anything(), COLLECTION_ID, [theirs.itemId], 21, null);
      expect(copyCollectionItems).toHaveBeenNthCalledWith(2, expect.anything(), COLLECTION_ID, [theirs.itemId], 7, null);
    });
  });

  it('never offers copying while the content is still behind the share password', async () => {
    jest.mocked(getCollection).mockResolvedValue(
      makeCollection({ accessRole: 'viewer', isSharePasswordProtected: true, ownerJupleId: 'K7MP4Q8N' }),
    );
    jest.mocked(getCollectionItems).mockRejectedValue(new ApiError('forbidden', 403, 'sharePasswordRequired'));
    const renderer = await renderScreen();

    // Nothing to copy yet, so the ⋯ holds only 컬렉션에서 나가기 (a member can always leave) - their own bell is still there.
    const top = header(renderer);
    expect(headerButtonIds(top)).toEqual(['collection-details-favorite', 'collection-details-notifications', 'collection-details-more']);
    expect(await recipientMenuLabels(renderer)).toEqual([i18n.t('collections.leaveAction')]);
  });
});

describe('CollectionDetailsScreen - 전체 선택 for 내 컬렉션으로 복사', () => {
  const allItems = (count: number) =>
    Array.from({ length: count }, (_, index) => makeItem({ itemId: index + 1, title: `Link ${index + 1}` }));

  /** Serves \`items\` page by page the way the server does (newest first, opaque cursor = offset). */
  function serve(items: CollectionItemEntry[]) {
    jest.mocked(getCollectionItems).mockImplementation(async (_request, _id, options) => {
      const offset = options?.cursor ? Number(options.cursor) : 0;
      const limit = options?.limit ?? 50;
      const page = items.slice(offset, offset + limit);
      return { items: page, nextCursor: offset + limit < items.length ? String(offset + limit) : null };
    });
  }

  const selectAll = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root.findAll(node => node.props.testID === 'collection-copy-select-all' && typeof node.props.onPress === 'function')[0];
  const copyButton = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root.findAll(node => node.props.testID === 'collection-copy-confirm' && typeof node.props.onPress === 'function')[0];
  const hasText = (renderer: ReactTestRenderer.ReactTestRenderer, text: string) =>
    renderer.root.findAllByType(Text).some(node => node.props.children === text);
  const pressSelectAll = async (renderer: ReactTestRenderer.ReactTestRenderer) => {
    const onPress = selectAll(renderer).props.onPress;
    await act(async () => {
      await onPress();
    });
  };

  afterEach(() => {
    jest.clearAllMocks();
    clearCollectionUnlockGrants();
  });

  it('selects every link of the Collection - also those on pages not loaded yet - and 전체 해제 clears them', async () => {
    const items = allItems(130);
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N', itemCount: 130 }));
    serve(items);
    jest.mocked(getCollections).mockResolvedValue({ items: [makeCollection({ id: 7, name: 'My Picks' })], nextCursor: null });
    jest.mocked(copyCollectionItems).mockResolvedValue({ copiedCount: 130, skippedCount: 0, unavailableCount: 0 });
    const renderer = await renderScreen();
    await pressMenu(renderer, i18n.t('collections.copyToMine'));

    // Nothing picked: 복사 is off, and the action reads 전체 선택.
    expect(copyButton(renderer).props.disabled).toBe(true);
    expect(selectAll(renderer).props.accessibilityLabel).toBe('전체 선택');
    expect(hasText(renderer, '전체 선택')).toBe(true);
    const loadsBefore = jest.mocked(getCollectionItems).mock.calls.length;

    await pressSelectAll(renderer);

    // Read from the server with its largest page, newest first - two pages for 130.
    const selectAllCalls = jest.mocked(getCollectionItems).mock.calls.slice(loadsBefore);
    expect(selectAllCalls).toHaveLength(2);
    expect(selectAllCalls[0][2]).toEqual(expect.objectContaining({ limit: 100, sort: 'dateDesc' }));
    expect(hasText(renderer, i18n.t('collections.copySelectedCount', { count: 130 }))).toBe(true);
    expect(copyButton(renderer).props.disabled).toBe(false);
    expect(hasText(renderer, '전체 해제')).toBe(true);
    expect(selectAll(renderer).props.accessibilityLabel).toBe('전체 선택 해제');
    // Not over the limit, so no notice.
    expect(hasText(renderer, i18n.t('collections.copySelectionLimit', { max: 200 }))).toBe(false);

    await act(async () => {
      selectAll(renderer).props.onPress();
    });
    expect(hasText(renderer, i18n.t('collections.copySelectedCount', { count: 0 }))).toBe(true);
    expect(copyButton(renderer).props.disabled).toBe(true);
    expect(hasText(renderer, '전체 선택')).toBe(true);

    // Selected again and copied: exactly the server's 130 ids go to the copy.
    await pressSelectAll(renderer);
    await act(async () => copyButton(renderer).props.onPress());
    await chooseDestinations(renderer, 7);
    expect(copyCollectionItems).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, items.map(item => item.itemId), 7, null);
  });

  it('over 200 links: offers 200개까지 선택, takes the newest 200 and says so', async () => {
    const items = allItems(250);
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N', itemCount: 250 }));
    serve(items);
    const renderer = await renderScreen();
    await pressMenu(renderer, i18n.t('collections.copyToMine'));

    expect(hasText(renderer, '200개까지 선택')).toBe(true);
    expect(selectAll(renderer).props.accessibilityLabel).toBe('200개까지 선택');
    const loadsBefore = jest.mocked(getCollectionItems).mock.calls.length;

    await pressSelectAll(renderer);

    // Stops reading at 200 - never pages through the whole Collection.
    expect(jest.mocked(getCollectionItems).mock.calls.length - loadsBefore).toBe(2);
    expect(hasText(renderer, i18n.t('collections.copySelectedCount', { count: 200 }))).toBe(true);
    expect(hasText(renderer, i18n.t('collections.copySelectionLimit', { max: 200 }))).toBe(true);
    expect(hasText(renderer, '전체 해제')).toBe(true);
  });

  it('selects only what the server lists - links no longer available are never picked', async () => {
    // The Collection says 3, but one of them was deleted meanwhile: the server lists 2.
    const listed = allItems(2);
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N', itemCount: 3 }));
    serve(listed);
    const renderer = await renderScreen();
    await pressMenu(renderer, i18n.t('collections.copyToMine'));

    await pressSelectAll(renderer);

    expect(hasText(renderer, i18n.t('collections.copySelectedCount', { count: 2 }))).toBe(true);
    // All that could be selected is selected - it offers 전체 해제, not another 전체 선택.
    expect(hasText(renderer, '전체 해제')).toBe(true);
  });

  it('unpicking one link after 전체 선택 offers 전체 선택 again; the selection survives a sort change', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N', itemCount: 2 }));
    serve([mine, theirs]);
    const renderer = await renderScreen();
    await pressMenu(renderer, i18n.t('collections.copyToMine'));
    await pressSelectAll(renderer);

    const sortByName = renderer.root.findAll(node => node.props.testID === 'collection-sort-name' && typeof node.props.onPress === 'function')[0];
    await act(async () => {
      sortByName.props.onPress();
    });
    expect(hasText(renderer, i18n.t('collections.copySelectedCount', { count: 2 }))).toBe(true);

    const checkbox = row(renderer, mine).root.findAll(node => node.props.accessibilityRole === 'checkbox' && typeof node.props.onPress === 'function')[0];
    act(() => checkbox.props.onPress());
    expect(hasText(renderer, i18n.t('collections.copySelectedCount', { count: 1 }))).toBe(true);
    expect(hasText(renderer, '전체 선택')).toBe(true);
  });

  it('a failed read selects nothing and says why', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N', itemCount: 2 }));
    serve([mine, theirs]);
    const renderer = await renderScreen();
    await pressMenu(renderer, i18n.t('collections.copyToMine'));
    jest.mocked(getCollectionItems).mockRejectedValueOnce(new Error('offline'));

    await pressSelectAll(renderer);

    expect(hasText(renderer, i18n.t('collections.copySelectedCount', { count: 0 }))).toBe(true);
    expect(copyButton(renderer).props.disabled).toBe(true);
    expect(selectAll(renderer).props.disabled).toBe(false);
  });

  it('the selection bar wraps instead of overflowing on a narrow (320dp) screen', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N', itemCount: 2 }));
    serve([mine, theirs]);
    const renderer = await renderScreen();
    await pressMenu(renderer, i18n.t('collections.copyToMine'));

    const summary = selectAll(renderer).parent!;
    const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
    const summaryStyle = flat(renderer.root.findAll(node => node.props.style && flat(node.props.style).flexWrap === 'wrap' && node.findAll(child => child === summary).length > 0)[0]?.props.style);
    expect(summaryStyle).toEqual(expect.objectContaining({ flex: 1, flexWrap: 'wrap', minWidth: 0 }));
    // The control keeps the 44dp touch target.
    expect(flat(selectAll(renderer).props.style).minHeight).toBeGreaterThanOrEqual(44);
  });
});

describe('CollectionDetailsScreen - an unlock lasts for one visit', () => {
  beforeEach(() => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', isLocked: true }));
    jest.mocked(getCollectionItems).mockImplementation(async (_request, _id, options) => {
      if (!options?.unlockToken) {
        throw lockedError;
      }
      return { items: [mine], nextCursor: null };
    });
    jest.mocked(unlockCollection).mockResolvedValue({ unlockToken: 'visit-grant', expiresAtUtc: new Date(Date.now() + 15 * 60_000).toISOString() });
  });

  afterEach(() => {
    jest.clearAllMocks();
    clearCollectionUnlockGrants();
  });

  async function unlockFromThePanel(renderer: ReactTestRenderer.ReactTestRenderer) {
    const panel = renderPart(findItemList(renderer).props.ListEmptyComponent);
    await act(async () => {
      panel.root.findByProps({ testID: 'collection-unlock-password' }).props.onChangeText('correct horse');
    });
    await act(async () => {
      await panel.root.findByProps({ testID: 'collection-unlock-submit' }).props.onPress();
    });
  }

  it('asks again after leaving the Collection and coming back', async () => {
    const first = await renderScreen();
    await unlockFromThePanel(first);
    expect(getCollectionUnlockToken(COLLECTION_ID)).toBe('visit-grant');

    // Back out of the Collection (the screen leaves the stack).
    await act(async () => {
      first.unmount();
    });
    expect(getCollectionUnlockToken(COLLECTION_ID)).toBeNull();

    const again = await renderScreen();
    expect(renderPart(findItemList(again).props.ListEmptyComponent).root
      .findAll(node => node.props.testID === 'collection-unlock-panel').length).toBeGreaterThan(0);
    expect(getCollectionItems).toHaveBeenLastCalledWith(expect.anything(), COLLECTION_ID, expect.objectContaining({ unlockToken: null }));
  });

  it('within the same visit the grant is reused - opening and closing a sheet does not end it', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({
      accessRole: 'owner',
      isLocked: true,
      hasCollaborators: true,
      participantPreview: [{ jupleId: 'CNTRB234', displayName: '파이리', role: 'contributor' }],
      otherParticipantCount: 1,
    }));
    const renderer = await renderScreen();
    await unlockFromThePanel(renderer);

    const top = header(renderer);
    await act(async () => {
      top.root.findByProps({ testID: 'collection-details-participants' }).props.onPress();
    });
    const sheet = renderer.root.findByType(CollectionParticipantsSheet);
    expect(sheet.props.visible).toBe(true);
    await act(async () => {
      sheet.props.onClose();
    });
    expect(renderer.root.findByType(CollectionParticipantsSheet).props.visible).toBe(false);

    expect(getCollectionUnlockToken(COLLECTION_ID)).toBe('visit-grant');
    expect(findItemList(renderer).props.data).toEqual([mine]);
  });
});

describe('CollectionDetailsScreen - emoji reactions to the links of a shared Collection', () => {
  const sharedWithMe = () =>
    makeCollection({ accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N', otherParticipantCount: 1 });
  const link = (itemId: number, overrides: Partial<CollectionItemEntry> = {}) =>
    makeItem({ itemId, title: `Link ${itemId}`, isMine: false, ...overrides });

  afterEach(() => {
    jest.clearAllMocks();
    clearCollectionUnlockGrants();
  });

  async function openMenu(renderer: ReactTestRenderer.ReactTestRenderer, item: CollectionItemEntry) {
    const onLongPress = row(renderer, item).root.findByType(SwipeableItemRow).props.onLongPress;
    await act(async () => onLongPress());
  }
  const bar = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(QuickReactionBar);
  const visibleMenu = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(ActionMenuDialog).find(dialog => dialog.props.visible);
  const quick = (renderer: ReactTestRenderer.ReactTestRenderer, key: string) =>
    renderer.root.findAll(node => node.props.testID === `quick-reaction-${key}` && typeof node.props.onPress === 'function')[0];
  /** The chip row as drawn (the component itself is always mounted; it draws nothing without reactions). */
  const chips = (renderer: ReactTestRenderer.ReactTestRenderer, item: CollectionItemEntry) =>
    row(renderer, item).root.findAll(node => typeof node.type === 'string' && node.props.testID === `reaction-chips-${item.itemId}`);
  /** iOS shows the picker once the menu has finished closing - which the OS reports through onDismiss. */
  const finishMenuDismiss = async (renderer: ReactTestRenderer.ReactTestRenderer) => {
    const menu = renderer.root.findAllByType(ActionMenuDialog).find(dialog => typeof dialog.props.onDismiss === 'function');
    await act(async () => menu?.props.onDismiss());
  };
  const chipText = (renderer: ReactTestRenderer.ReactTestRenderer, item: CollectionItemEntry) =>
    row(renderer, item).root.findAllByType(Text).map(node => [node.props.children].flat().join(''));

  describe('the long-press menu', () => {
    it('opens with the quick reactions on top and the existing actions below, unchanged - for someone else\'s link', async () => {
      const other = link(2);
      jest.mocked(getCollection).mockResolvedValue(sharedWithMe());
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [other], nextCursor: null });
      const renderer = await renderScreen();

      await openMenu(renderer, other);

      expect(bar(renderer)).toHaveLength(1);
      expect(visibleMenu(renderer)!.props.actions.map((action: { label: string }) => action.label)).toEqual([i18n.t('item.goToUrlA11y'), i18n.t('collections.copyToMine')]);
    });

    it('and for my own link in someone else\'s Collection - 복제 and 이동 stay as they were', async () => {
      jest.mocked(getCollection).mockResolvedValue(sharedWithMe());
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
      const renderer = await renderScreen();

      await openMenu(renderer, mine);

      expect(bar(renderer)).toHaveLength(1);
      expect(visibleMenu(renderer)!.props.actions.map((action: { label: string }) => action.label))
        .toEqual([i18n.t('item.goToUrlA11y'), i18n.t('common.edit'), i18n.t('collections.addToOther'), i18n.t('collections.moveToOther'), i18n.t('collections.removeFromCollection')]);
    });

    it('every accepted role gets it - Viewer, Submitter, Contributor - and so does the Owner of a Collection with members', async () => {
      for (const accessRole of ['viewer', 'submitter', 'contributor'] as const) {
        jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole, ownerJupleId: 'K7MP4Q8N', otherParticipantCount: 1 }));
        jest.mocked(getCollectionItems).mockResolvedValue({ items: [link(2)], nextCursor: null });
        const renderer = await renderScreen();
        await openMenu(renderer, link(2));
        expect(bar(renderer)).toHaveLength(1);
      }
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true }));
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
      const ownerRenderer = await renderScreen();
      await openMenu(ownerRenderer, mine);
      expect(bar(ownerRenderer)).toHaveLength(1);
    });

    it('a private Collection (nobody else in it, even with a public link) gets no reaction UI at all', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: false, isPublicShareActive: true }));
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [{ ...mine, reactions: [{ key: 'heart', count: 1 }] }], nextCursor: null });
      const renderer = await renderScreen();

      await openMenu(renderer, mine);

      expect(bar(renderer)).toHaveLength(0);
      expect(chips(renderer, mine)).toHaveLength(0);
      expect(visibleMenu(renderer)!.props.header).toBeUndefined();
      expect(visibleMenu(renderer)!.props.actions.map((action: { label: string }) => action.label))
        .toEqual([i18n.t('item.goToUrlA11y'), i18n.t('common.edit'), i18n.t('collections.addToOther'), i18n.t('collections.moveToOther'), i18n.t('collections.removeFromCollection')]);
    });

    it('marks my current reaction in the quick row', async () => {
      const other = link(2, { reactions: [{ key: 'laugh', count: 2 }], myReaction: 'laugh' });
      jest.mocked(getCollection).mockResolvedValue(sharedWithMe());
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [other], nextCursor: null });
      const renderer = await renderScreen();

      await openMenu(renderer, other);

      expect(bar(renderer)[0].props.myReaction).toBe('laugh');
      expect(quick(renderer, 'laugh').props.accessibilityState).toEqual({ selected: true });
      expect(quick(renderer, 'heart').props.accessibilityState).toEqual({ selected: false });
    });
  });

  describe('choosing a reaction', () => {
    const setup = async (other: CollectionItemEntry) => {
      jest.mocked(getCollection).mockResolvedValue(sharedWithMe());
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [other], nextCursor: null });
      const renderer = await renderScreen();
      await openMenu(renderer, other);
      return renderer;
    };

    it('add: one PUT, the menu closes, and the card shows the chip at once', async () => {
      const other = link(2);
      jest.mocked(setItemReaction).mockResolvedValue({ reactions: [{ key: 'heart', count: 1 }], myReaction: 'heart' });
      const renderer = await setup(other);

      await act(async () => quick(renderer, 'heart').props.onPress());

      expect(setItemReaction).toHaveBeenCalledTimes(1);
      expect(setItemReaction).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, 2, 'heart', null);
      expect(removeItemReaction).not.toHaveBeenCalled();
      expect(visibleMenu(renderer)).toBeUndefined();
      expect(chips(renderer, other)).toHaveLength(1);
      expect(chipText(renderer, other)).toEqual(expect.arrayContaining(['❤️', '1']));
    });

    it('the same reaction again takes it back with DELETE', async () => {
      const other = link(2, { reactions: [{ key: 'heart', count: 2 }], myReaction: 'heart' });
      jest.mocked(removeItemReaction).mockResolvedValue({ reactions: [{ key: 'heart', count: 1 }], myReaction: null });
      const renderer = await setup(other);

      await act(async () => quick(renderer, 'heart').props.onPress());

      expect(removeItemReaction).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, 2, null);
      expect(setItemReaction).not.toHaveBeenCalled();
      expect(chipText(renderer, other)).toEqual(expect.arrayContaining(['❤️', '1']));
    });

    it('another reaction changes it - one PUT, the old chip loses one and the new one appears', async () => {
      const other = link(2, { reactions: [{ key: 'heart', count: 1 }], myReaction: 'heart' });
      jest.mocked(setItemReaction).mockResolvedValue({ reactions: [{ key: 'fire', count: 1 }], myReaction: 'fire' });
      const renderer = await setup(other);
      expect(bar(renderer)).toHaveLength(1);

      // 🔥 is not in the quick row: through the picker.
      await act(async () => quick(renderer, 'more').props.onPress());
      await finishMenuDismiss(renderer);
      await act(async () => renderer.root.findAll(node => node.props.testID === 'reaction-option-fire' && typeof node.props.onPress === 'function')[0].props.onPress());

      expect(setItemReaction).toHaveBeenCalledTimes(1);
      expect(setItemReaction).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, 2, 'fire', null);
      expect(chipText(renderer, other)).toEqual(expect.arrayContaining(['🔥', '1']));
      expect(chipText(renderer, other)).not.toContain('❤️');
    });

    it('"+" closes the menu and opens the picker - never two modals at once', async () => {
      const other = link(2);
      const renderer = await setup(other);

      await act(async () => quick(renderer, 'more').props.onPress());
      expect(visibleMenu(renderer)).toBeUndefined();
      await finishMenuDismiss(renderer);

      const pickers = renderer.root.findAllByType(ReactionPickerDialog);
      expect(pickers).toHaveLength(1);
      expect(pickers[0].props.visible).toBe(true);
      expect(pickers[0].props.myReaction).toBeNull();
      expect(setItemReaction).not.toHaveBeenCalled();
    });

    it('closing the picker without choosing sends nothing', async () => {
      const other = link(2);
      const renderer = await setup(other);
      await act(async () => quick(renderer, 'more').props.onPress());
      await finishMenuDismiss(renderer);

      await act(async () => renderer.root.findByType(ReactionPickerDialog).props.onClose());

      expect(renderer.root.findByType(ReactionPickerDialog).props.visible).toBe(false);
      expect(setItemReaction).not.toHaveBeenCalled();
    });

    it('a failure puts the card back as it was and says so', async () => {
      const other = link(2);
      jest.mocked(setItemReaction).mockRejectedValue(new ApiError('unavailable', 503));
      const renderer = await setup(other);

      await act(async () => quick(renderer, 'heart').props.onPress());

      expect(chips(renderer, other)).toHaveLength(0);
      expect(renderer.root.findAllByType(Text).some(node => node.props.children === i18n.t('reactions.error'))).toBe(true);
    });
  });

  describe('the reaction chips on a card', () => {
    it('a link nobody reacted to has no chip row at all - a clean card', async () => {
      const other = link(2);
      jest.mocked(getCollection).mockResolvedValue(sharedWithMe());
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [other], nextCursor: null });
      const renderer = await renderScreen();

      expect(chips(renderer, other)).toHaveLength(0);
    });

    it('shows the counts - most used first - with my own marked, in List and in Grid alike', async () => {
      const other = link(2, { reactions: [{ key: 'laugh', count: 2 }, { key: 'heart', count: 3 }], myReaction: 'laugh' });
      jest.mocked(getCollection).mockResolvedValue(sharedWithMe());
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [other], nextCursor: null });
      const renderer = await renderScreen();

      expect(chipText(renderer, other).filter(text => ['❤️', '😂', '3', '2'].includes(text))).toEqual(['❤️', '3', '😂', '2']);
      const mineChip = row(renderer, other).root.findAll(node => node.props.testID === 'reaction-chips-2-laugh' && typeof node.props.onPress === 'function')[0];
      expect(mineChip.props.accessibilityState).toEqual({ selected: true });

      await act(async () => {
        renderer.root.findByProps({ accessibilityLabel: 'Grid view' }).props.onPress();
      });
      expect(row(renderer, other).root.findAllByType(GridCardComponent)).toHaveLength(1);
      expect(chips(renderer, other)).toHaveLength(1);
    });

    it('tapping a chip applies that reaction: ❤️ 3 becomes mine as ❤️ 4, and my 😂 drops by one', async () => {
      const other = link(2, { reactions: [{ key: 'laugh', count: 2 }, { key: 'heart', count: 3 }], myReaction: 'laugh' });
      jest.mocked(getCollection).mockResolvedValue(sharedWithMe());
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [other], nextCursor: null });
      jest.mocked(setItemReaction).mockResolvedValue({ reactions: [{ key: 'heart', count: 4 }, { key: 'laugh', count: 1 }], myReaction: 'heart' });
      const renderer = await renderScreen();

      const heartChip = row(renderer, other).root.findAll(node => node.props.testID === 'reaction-chips-2-heart' && typeof node.props.onPress === 'function')[0];
      await act(async () => heartChip.props.onPress());

      expect(setItemReaction).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, 2, 'heart', null);
      expect(chipText(renderer, other).filter(text => ['❤️', '😂', '4', '1'].includes(text))).toEqual(['❤️', '4', '😂', '1']);
    });

    it('tapping my own chip takes my reaction back (DELETE)', async () => {
      const other = link(2, { reactions: [{ key: 'heart', count: 3 }], myReaction: 'heart' });
      jest.mocked(getCollection).mockResolvedValue(sharedWithMe());
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [other], nextCursor: null });
      jest.mocked(removeItemReaction).mockResolvedValue({ reactions: [{ key: 'heart', count: 2 }], myReaction: null });
      const renderer = await renderScreen();

      const heartChip = row(renderer, other).root.findAll(node => node.props.testID === 'reaction-chips-2-heart' && typeof node.props.onPress === 'function')[0];
      await act(async () => heartChip.props.onPress());

      expect(removeItemReaction).toHaveBeenCalledTimes(1);
      expect(chipText(renderer, other)).toEqual(expect.arrayContaining(['❤️', '2']));
    });

    it('the smiley-plus beside the chips opens the picker for that link', async () => {
      const other = link(2, { reactions: [{ key: 'heart', count: 1 }], myReaction: null });
      jest.mocked(getCollection).mockResolvedValue(sharedWithMe());
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [other], nextCursor: null });
      const renderer = await renderScreen();

      const add = row(renderer, other).root.findAll(node => node.props.testID === 'reaction-chips-2-add' && typeof node.props.onPress === 'function')[0];
      await act(async () => add.props.onPress());

      expect(renderer.root.findByType(ReactionPickerDialog).props.visible).toBe(true);
    });

    it('behind a lock nothing is drawn and nothing can be sent', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N', otherParticipantCount: 1, isLocked: true }));
      jest.mocked(getCollectionItems).mockRejectedValue(lockedError);
      const renderer = await renderScreen();

      expect(renderer.root.findAllByType(ReactionChips)).toHaveLength(0);
      expect(bar(renderer)).toHaveLength(0);
      expect(setItemReaction).not.toHaveBeenCalled();
    });
  });
});

describe('the public link\'s own surface carries no reactions at all', () => {
  it('neither the public Collection screen nor its API types mention reactions', () => {
    const read = (relative: string) => require('fs').readFileSync(require('path').resolve(__dirname, relative), 'utf8') as string;

    expect(read('../SharedCollectionScreen.tsx')).not.toMatch(/reaction/i);
    expect(read('../../collections/api/publicCollectionsApi.ts')).not.toMatch(/reaction/i);
  });
});

describe('CollectionDetailsScreen - the participants under the title', () => {
  const owner = { jupleId: 'K7MP4Q8N', displayName: '피카츄', role: 'owner', profileImageUrl: 'https://blob.example/owner.jpg', profileImageVersion: 'v1' };
  const people = (count: number) => [
    owner,
    ...Array.from({ length: count - 1 }, (_, index) => ({ jupleId: `MBR${index}2345`, displayName: `멤버${index}`, role: 'contributor', isMe: index === 0 })),
  ];
  const stackOf = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(ParticipantAvatarStack);
  const withParticipants = (count: number) => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N', otherParticipantCount: count - 1 }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    jest.mocked(getCollectionParticipants).mockResolvedValueOnce({ participants: people(count), pendingInvitations: [], canManage: false });
  };

  afterEach(() => {
    jest.clearAllMocks();
    clearCollectionUnlockGrants();
  });

  it('shows the accepted participants as one row of small overlapping photos - the whole row opens the participant sheet', async () => {
    withParticipants(3);
    const renderer = await renderScreen();

    expect(stackOf(renderer)).toHaveLength(1);
    const stack = stackOf(renderer)[0];
    expect(stack.props.participants).toHaveLength(3);
    expect(stack.props.accessibilityLabel).toBe(i18n.t('collections.participantsAvatarsA11y', { count: 3 }));
    // One small circle per person (photo from the participant list), the first one at the row's start.
    expect(stack.findAllByType(UserAvatar)).toHaveLength(3);
    expect(stack.findAllByType(UserAvatar)[0].props).toEqual(expect.objectContaining({ jupleId: 'K7MP4Q8N', imageUrl: 'https://blob.example/owner.jpg', size: 28 }));
    expect(renderer.root.findAll(node => node.props.testID === 'collection-details-participants-more')).toHaveLength(0);
    // The old text summary is gone.
    expect(renderer.root.findAllByType(Text).some(node => node.props.children === '피카츄')).toBe(false);

    await act(async () => stack.props.onPress());
    expect(renderer.root.findByType(CollectionParticipantsSheet).props.visible).toBe(true);
  });

  it('while the list is still loading: placeholder circles from the first render - never the names - and the photos replace them in place', async () => {
    let resolveList!: (value: Awaited<ReturnType<typeof getCollectionParticipants>>) => void;
    jest.mocked(getCollection).mockResolvedValue(makeCollection({
      accessRole: 'contributor',
      ownerJupleId: 'K7MP4Q8N',
      participantPreview: [{ jupleId: 'K7MP4Q8N', displayName: '피카츄', role: 'owner' }],
      otherParticipantCount: 1,
    }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    jest.mocked(getCollectionParticipants).mockImplementationOnce(() => new Promise(resolve => { resolveList = resolve; }));
    const renderer = await renderScreen();

    const placeholders = () => renderer.root.findAll(node => typeof node.type === 'string' && String(node.props.testID).startsWith('collection-details-participants-placeholder-'));
    expect(stackOf(renderer)).toHaveLength(1);
    expect(stackOf(renderer)[0].props.participants).toBeNull();
    expect(placeholders()).toHaveLength(2);
    // Not once, not for a moment: no participant name text anywhere.
    expect(renderer.root.findAllByType(Text).some(node => [node.props.children].flat().join('').includes('피카츄'))).toBe(false);
    expect(renderer.root.findAllByType(UserAvatar)).toHaveLength(0);

    await act(async () => {
      resolveList({ participants: people(2), pendingInvitations: [], canManage: false });
    });

    expect(placeholders()).toHaveLength(0);
    expect(stackOf(renderer)).toHaveLength(1);
    expect(stackOf(renderer)[0].findAllByType(UserAvatar)).toHaveLength(2);
    expect(renderer.root.findAllByType(Text).some(node => [node.props.children].flat().join('').includes('피카츄'))).toBe(false);
  });

  it('a list that cannot be loaded keeps circles (initials from the preview the Collection carries) - never a line of names', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({
      accessRole: 'contributor',
      ownerJupleId: 'K7MP4Q8N',
      participantPreview: [{ jupleId: 'K7MP4Q8N', displayName: '피카츄', role: 'owner' }],
      otherParticipantCount: 1,
    }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    jest.mocked(getCollectionParticipants).mockRejectedValueOnce(new Error('offline'));
    const renderer = await renderScreen();

    expect(stackOf(renderer)).toHaveLength(1);
    expect(stackOf(renderer)[0].findAllByType(UserAvatar)).toHaveLength(1);
    expect(renderer.root.findAllByType(Text).some(node => [node.props.children].flat().join('') === '피카츄')).toBe(false);
  });

  it('with more than four people: three circles and one "+N" circle for everyone else', async () => {
    withParticipants(7);
    const renderer = await renderScreen();

    const stack = stackOf(renderer)[0];
    expect(stack.findAllByType(UserAvatar)).toHaveLength(3);
    const more = renderer.root.findAll(node => node.props.testID === 'collection-details-participants-more' && node.type === Text)[0];
    expect(more.props.children).toEqual(['+', 4]);
  });

  it('an Owner with nobody else in it (only a public link) shows no avatars at all', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: false, isPublicShareActive: true }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    jest.mocked(getCollectionParticipants).mockResolvedValueOnce({ participants: [{ ...owner, isMe: true }], pendingInvitations: [], canManage: true });
    const renderer = await renderScreen();

    expect(stackOf(renderer)).toHaveLength(0);
  });
});

describe('CollectionDetailsScreen - Contributor', () => {
  beforeEach(() => {
    jest.mocked(getCollection).mockResolvedValue(
      makeCollection({
        accessRole: 'contributor',
        ownerJupleId: 'K7MP4Q8N',
        participantPreview: [{ jupleId: 'K7MP4Q8N', displayName: '피카츄', role: 'owner' }],
        otherParticipantCount: 1,
      }),
    );
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine, theirs], nextCursor: null });
  });

  afterEach(() => {
    jest.clearAllMocks();
    clearCollectionUnlockGrants();
  });

  it('shows who else is in it and no Owner-only controls (edit/delete/share/menu) - but their own favorite star', async () => {
    const renderer = await renderScreen();
    const top = header(renderer);

    expect(top.root.findAllByType(ParticipantAvatarStack)).toHaveLength(1);
    expect(top.root.findAllByType(ParticipantAvatarStack)[0].props.participants.map((person: { jupleId: string }) => person.jupleId)).toEqual(['K7MP4Q8N', 'CNTRB234']);
    for (const label of [
      i18n.t('common.edit'),
      i18n.t('common.delete'),
      i18n.t('collections.shareAction'),
    ]) {
      expect(hasLabel(top, label)).toBe(false);
    }
    // Their own bell in the header; the ⋯ holds only copying into their own Collection.
    expect(headerButtonIds(top)).toContain('collection-details-notifications');
    expect(await recipientMenuLabels(renderer)).toEqual([i18n.t('collections.copyToMine'), i18n.t('collections.leaveAction')]);
    expect(hasLabel(top, i18n.t('collections.addFavorite'))).toBe(true);
    expect(top.root.findAllByType(Switch)).toHaveLength(0);
    // Share management is never even queried for a Contributor.
    expect(getCollectionShare).not.toHaveBeenCalled();
  });

  it('opens another member\'s link as the read-only shared view, and my own link as my ItemDetails', async () => {
    const renderer = await renderScreen();

    const pressRow = (item: CollectionItemEntry) => {
      const itemRow = row(renderer, item);
      const pressable = itemRow.root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function')[0];
      act(() => {
        pressable.props.onPress();
      });
    };

    pressRow(theirs);
    expect(mockNavigate).toHaveBeenLastCalledWith('CollectionSharedItem', { collectionId: COLLECTION_ID, itemId: 2, isCollectionOwner: false });

    pressRow(mine);
    // Opened from the Collection, but a Contributor may not take links out of it.
    expect(mockNavigate).toHaveBeenLastCalledWith('ItemDetails', { itemId: 1, collectionContext: { collectionId: COLLECTION_ID, canRemove: true, isCollectionOwner: false, isCollaborative: true } });
  });

  it('offers 컬렉션에서 제거 only for their own link - never for another member link - and never the Add/Move menu', async () => {
    const renderer = await renderScreen();

    const actionNamesOf = (item: CollectionItemEntry) => row(renderer, item).root
      .findAll(node => Array.isArray(node.props.accessibilityActions))[0]
      .props.accessibilityActions.map((action: { name: string }) => action.name);
    expect(actionNamesOf(mine)).toContain('delete');
    expect(actionNamesOf(theirs)).not.toContain('delete');
    for (const item of [mine, theirs]) {
      expect(hasLabel(row(renderer, item), i18n.t('collections.itemManageAction'))).toBe(false);
    }
  });
});

describe('CollectionDetailsScreen - opening a link for its comments', () => {
  afterEach(() => jest.clearAllMocks());

  it('tells the shared-item screen whether the caller owns the Collection (so the Owner may delete any comment there)', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [theirs], nextCursor: null });
    const renderer = await renderScreen();

    const swipe = row(renderer, theirs).root.findByType(SwipeableItemRow);
    act(() => swipe.props.onPress());

    expect(mockNavigate).toHaveBeenLastCalledWith('CollectionSharedItem', { collectionId: COLLECTION_ID, itemId: 2, isCollectionOwner: true });
  });
});

describe('CollectionDetailsScreen - Owner viewing a Contributor\'s link', () => {
  beforeEach(() => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine, theirs], nextCursor: null });
  });

  afterEach(() => jest.clearAllMocks());

  it('can remove the association, but gets no Add/Move menu for an Item that is not theirs - only the copy', async () => {
    const renderer = await renderScreen();
    const theirRow = row(renderer, theirs);

    const actionNames = theirRow.root
      .findAll(node => Array.isArray(node.props.accessibilityActions))[0]
      .props.accessibilityActions.map((action: { name: string }) => action.name);
    expect(actionNames).toContain('delete');
    // No trailing "..." on any List row any more; the menu is a long press.
    expect(hasLabel(theirRow, i18n.t('collections.itemManageAction'))).toBe(false);
    expect(hasLabel(row(renderer, mine), i18n.t('collections.itemManageAction'))).toBe(false);
    const menuOf = async (item: CollectionItemEntry) => {
      const onLongPress = row(renderer, item).root.findByType(SwipeableItemRow).props.onLongPress;
      await act(async () => onLongPress());
      return (renderer.root.findAllByType(ActionMenuDialog).find(dialog => dialog.props.visible)?.props.actions ?? [])
        .map((action: { label: string }) => action.label);
    };
    expect(await menuOf(theirs)).toEqual([i18n.t('item.goToUrlA11y'), i18n.t('collections.copyToMine'), i18n.t('collections.removeFromCollection')]);
  });

  it('copies a member\'s link into one of my own Collections through the shared copy API - never a link of their Item', async () => {
    jest.mocked(copyCollectionItems).mockResolvedValue({ copiedCount: 1, skippedCount: 0, unavailableCount: 0 });
    jest.mocked(getCollections).mockResolvedValue({ items: [makeCollection({ id: 9, name: 'Other of mine', accessRole: 'owner' })], nextCursor: null });
    const renderer = await renderScreen();

    const onTheirLongPress = row(renderer, theirs).root.findByType(SwipeableItemRow).props.onLongPress;
    await act(async () => onTheirLongPress());
    const menu = renderer.root.findAllByType(ActionMenuDialog).find(dialog => dialog.props.visible)!;
    await act(async () => menu.props.actions.find((action: { label: string }) => action.label === i18n.t('collections.copyToMine')).onPress());
    await chooseDestinations(renderer, 9);

    expect(copyCollectionItems).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, [theirs.itemId], 9, null);

    // My own link here has 복제 and 이동 (never the copy) - 이동 works here too, as add + remove.
    const onMyLongPress = row(renderer, mine).root.findByType(SwipeableItemRow).props.onLongPress;
    await act(async () => onMyLongPress());
    expect((renderer.root.findAllByType(ActionMenuDialog).find(dialog => dialog.props.visible)?.props.actions ?? [])
      .map((action: { label: string }) => action.label)).toEqual([i18n.t('item.goToUrlA11y'), i18n.t('common.edit'), i18n.t('collections.addToOther'), i18n.t('collections.moveToOther'), i18n.t('collections.removeFromCollection')]);
  });
});

describe('CollectionDetailsScreen - who added each link', () => {
  const addedByTexts = (part: ReactTestRenderer.ReactTestRenderer) =>
    part.root
      .findAll(node => typeof node.type === 'string' && node.props.testID === 'saved-link-added-by')
      .flatMap(node => node.findAllByType(Text).map(text => text.props.children));
  const adderLine = (part: ReactTestRenderer.ReactTestRenderer) =>
    part.root.findAll(node => node.props.testID === 'saved-link-added-by' && node.props.accessible)[0];
  const hasOwnerCrown = (part: ReactTestRenderer.ReactTestRenderer) =>
    part.root.findAll(node => node.props.testID === 'saved-link-adder-owner').length > 0;

  afterEach(() => jest.clearAllMocks());

  const ownersLink = makeItem({
    itemId: 2, title: 'Theirs', isMine: false,
    addedBy: { kind: 'owner', jupleId: 'K7MP4Q8N', displayName: '피카츄', profileImageUrl: 'https://blob.example/owner.jpg', profileImageVersion: 'v1', isCollectionOwner: true },
  });
  const membersLink = makeItem({ itemId: 3, title: 'Member', isMine: false, addedBy: { kind: 'member', jupleId: 'CNTRC234', displayName: null } });
  const myLink = makeItem({ itemId: 1, title: 'Mine', isMine: true, addedBy: { kind: 'me', jupleId: 'MEEE2345', displayName: '이상해씨' } });

  it('in a shared Collection each link shows its adder as an avatar - their photo, or the fallback - with no nickname text', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N' }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [myLink, ownersLink, membersLink], nextCursor: null });
    const renderer = await renderScreen();

    const owner = row(renderer, ownersLink);
    expect(owner.root.findByType(UserAvatar).props).toEqual(expect.objectContaining({
      jupleId: 'K7MP4Q8N', imageUrl: 'https://blob.example/owner.jpg', imageVersion: 'v1', size: 16,
    }));
    // A member without a photo: the same avatar, which falls back to its initial/glyph itself.
    expect(row(renderer, membersLink).root.findByType(UserAvatar).props).toEqual(expect.objectContaining({ jupleId: 'CNTRC234', imageUrl: null }));
    expect(row(renderer, myLink).root.findByType(UserAvatar).props.jupleId).toBe('MEEE2345');
    // No visible names, no 소유자 / Owner text on the cards.
    for (const part of [owner, row(renderer, membersLink), row(renderer, myLink)]) {
      // At most the avatar's own one-character fallback initial - never a name or a label.
      expect(addedByTexts(part).every(text => typeof text === 'string' && Array.from(text).length === 1)).toBe(true);
      const allTexts = JSON.stringify(part.root.findAllByType(Text).map(node => node.props.children));
      expect(allTexts).not.toContain('피카츄');
      expect(allTexts).not.toContain(i18n.t('collections.roleOwner'));
    }
  });

  it('the Owner\'s links carry the crown; nobody else\'s do - and screen readers still hear who and that they own it', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N' }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [myLink, ownersLink, membersLink], nextCursor: null });
    const renderer = await renderScreen();

    expect(hasOwnerCrown(row(renderer, ownersLink))).toBe(true);
    expect(row(renderer, ownersLink).root.findAllByType(CrownIcon)).toHaveLength(1);
    expect(hasOwnerCrown(row(renderer, membersLink))).toBe(false);
    expect(hasOwnerCrown(row(renderer, myLink))).toBe(false);
    expect(adderLine(row(renderer, ownersLink)).props.accessibilityLabel).toBe('컬렉션 소유자 피카츄님이 추가한 링크');
    expect(adderLine(row(renderer, membersLink)).props.accessibilityLabel).toBe('참여자 CNTR-C234님이 추가한 링크');
    expect(adderLine(row(renderer, myLink)).props.accessibilityLabel).toBe('내가 추가한 링크');
  });

  it('Grid tiles show the same avatar and crown as List rows', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N' }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [ownersLink, membersLink], nextCursor: null });
    const renderer = await renderScreen();
    await act(async () => {
      renderer.root.findByType(ViewModeToggle).props.onChange('grid');
    });
    const { SavedLinkGridCard } = require('../../components/SavedLinkGridCard');

    const ownerTile = row(renderer, ownersLink);
    expect(ownerTile.root.findAllByType(SavedLinkGridCard)).toHaveLength(1);
    expect(ownerTile.root.findByType(UserAvatar).props.imageUrl).toBe('https://blob.example/owner.jpg');
    expect(hasOwnerCrown(ownerTile)).toBe(true);
    expect(hasOwnerCrown(row(renderer, membersLink))).toBe(false);
  });

  it('a link that came in through the 모든 사용자 link says only that - never who', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: false }));
    const publicLink = makeItem({ itemId: 2, title: 'Via link', isMine: false, addedBy: { kind: 'publicLink' } });
    const myLink = makeItem({ itemId: 1, title: 'Mine', isMine: true, addedBy: { kind: 'me' } });
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [myLink, publicLink], nextCursor: null });
    const renderer = await renderScreen();

    expect(addedByTexts(row(renderer, publicLink))).toEqual([i18n.t('collections.addedViaPublicLink')]);
    // No avatar, no crown - nothing about who it was.
    expect(row(renderer, publicLink).root.findAllByType(UserAvatar)).toHaveLength(0);
    expect(hasOwnerCrown(row(renderer, publicLink))).toBe(false);
    expect(row(renderer, myLink).root.findAllByType(UserAvatar)).toHaveLength(0); // an older "me" without identity: the plain glyph
    expect(adderLine(row(renderer, myLink)).props.accessibilityLabel).toBe('내가 추가한 링크');
  });

  it('a private Collection stays as quiet as before - no "added by" line at all', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: false }));
    const myLink = makeItem({ itemId: 1, title: 'Mine', isMine: true, addedBy: { kind: 'me' } });
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [myLink], nextCursor: null });
    const renderer = await renderScreen();

    expect(addedByTexts(row(renderer, myLink))).toEqual([]);
  });
});

describe('CollectionDetailsScreen - long press on a link: 내 컬렉션으로 복사 for someone else\'s link', () => {
  const othersLink = makeItem({ itemId: 2, title: 'Theirs', isMine: false, memo: null });
  const myLinkHere = makeItem({ itemId: 1, title: 'Mine', isMine: true, memo: 'my memo' });
  const myCollection = makeCollection({ id: 7, name: 'My Picks', accessRole: 'owner' });

  afterEach(() => jest.clearAllMocks());

  const longPress = async (renderer: ReactTestRenderer.ReactTestRenderer, item: CollectionItemEntry) => {
    const swipeRow = row(renderer, item).root.findByType(SwipeableItemRow);
    if (!swipeRow.props.onLongPress) {
      return false;
    }
    await act(async () => swipeRow.props.onLongPress());
    return true;
  };
  const visibleMenuLabels = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    (renderer.root.findAllByType(ActionMenuDialog).find(dialog => dialog.props.visible)?.props.actions ?? [])
      .map((action: { label: string }) => action.label);

  it.each(['contributor', 'viewer'] as const)('as a %s: another member\'s link offers only the copy, through my own-Collection picker and the shared copy API', async role => {
    // The destination's access is re-read when it is picked: the source Collection is the one in this role, my own is mine.
    jest.mocked(getCollection).mockImplementation(async (_request, id) =>
      (id === myCollection.id ? myCollection : makeCollection({ accessRole: role, ownerJupleId: 'K7MP4Q8N' })));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [myLinkHere, othersLink], nextCursor: null });
    jest.mocked(copyCollectionItems).mockResolvedValue({ copiedCount: 1, skippedCount: 0, unavailableCount: 0 });
    jest.mocked(getCollections).mockResolvedValue({ items: [myCollection], nextCursor: null });
    const renderer = await renderScreen();

    expect(await longPress(renderer, othersLink)).toBe(true);
    expect(visibleMenuLabels(renderer)).toEqual([i18n.t('item.goToUrlA11y'), i18n.t('collections.copyToMine')]);
    expect(visibleMenuLabels(renderer)).not.toContain(i18n.t('collections.moveToOther'));

    const menu = renderer.root.findAllByType(ActionMenuDialog).find(dialog => dialog.props.visible)!;
    await act(async () => menu.props.actions.find((action: { label: string }) => action.label === i18n.t('collections.copyToMine')).onPress());
    expect(destinationPicker(renderer).props.visible).toBe(true);
    await chooseDestinations(renderer, 7);

    // Round 26's shared copy: source = this Collection, just this link - never a link of their Item.
    expect(copyCollectionItems).toHaveBeenCalledTimes(1);
    expect(copyCollectionItems).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, [2], 7, null);
    expect(renderer.root.findAllByType(Text).some(node => node.props.children === '링크 1개를 복사했어요.')).toBe(true);
    // No selection mode was involved.
    expect(renderer.root.findAll(node => node.props.testID === 'collection-copy-bar')).toHaveLength(0);
  });

  it.each(['contributor', 'viewer'] as const)('as a %s: my own link in someone else\'s Collection now has a long press too - 복제 and 이동, never the copy - and keeps its swipe remove', async role => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: role, ownerJupleId: 'K7MP4Q8N' }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [myLinkHere, othersLink], nextCursor: null });
    const renderer = await renderScreen();

    expect(await longPress(renderer, myLinkHere)).toBe(true);
    expect(visibleMenuLabels(renderer)).toEqual([i18n.t('item.goToUrlA11y'), i18n.t('common.edit'), i18n.t('collections.addToOther'), i18n.t('collections.moveToOther'), i18n.t('collections.removeFromCollection')]);
    expect(visibleMenuLabels(renderer)).not.toContain(i18n.t('collections.copyToMine'));
    // The swipe remove stays (the server lets a member remove only their own links).
    expect(row(renderer, myLinkHere).root.findByType(SwipeableItemRow).props.onDelete).toEqual(expect.any(Function));
  });

  it('복제 of my own link in someone else\'s Collection puts the same link into my other Collections (never a copy of it)', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N' }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [myLinkHere], nextCursor: null });
    jest.mocked(getCollections).mockImplementation(async (_request, options = {}) =>
      options.itemId !== undefined
        ? { items: [], nextCursor: null }
        : { items: [myCollection, makeCollection({ id: 8, name: 'More', accessRole: 'owner' })], nextCursor: null });
    jest.mocked(addItemToCollections).mockResolvedValue({ addedCount: 2, skippedCount: 0 });
    const renderer = await renderScreen();

    await longPress(renderer, myLinkHere);
    const menu = renderer.root.findAllByType(ActionMenuDialog).find(dialog => dialog.props.visible)!;
    await act(async () => menu.props.actions.find((action: { label: string }) => action.label === i18n.t('collections.addToOther')).onPress());
    await chooseDestinations(renderer, 7, 8);

    expect(addItemToCollections).toHaveBeenCalledWith(expect.anything(), 1, [7, 8], {});
    expect(copyCollectionItems).not.toHaveBeenCalled();
  });

  it('이동 of my own link out of someone else\'s Collection: added to the destination first, then removed from here - never the Owner-only atomic move', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N', itemCount: 2 }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [myLinkHere, othersLink], nextCursor: null });
    jest.mocked(getCollections).mockResolvedValue({ items: [myCollection], nextCursor: null });
    jest.mocked(addItemToCollection).mockResolvedValue('added');
    jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
    const order: string[] = [];
    jest.mocked(addItemToCollection).mockImplementation(async () => { order.push('add'); return 'added'; });
    jest.mocked(removeItemFromCollection).mockImplementation(async () => { order.push('remove'); });
    const renderer = await renderScreen();

    await longPress(renderer, myLinkHere);
    const menu = renderer.root.findAllByType(ActionMenuDialog).find(dialog => dialog.props.visible)!;
    await act(async () => menu.props.actions.find((action: { label: string }) => action.label === i18n.t('collections.moveToOther')).onPress());
    await chooseDestinations(renderer, 7);

    expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), 7, 1, { unlockToken: null });
    expect(removeItemFromCollection).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, 1);
    expect(order).toEqual(['add', 'remove']);
    expect(transferCollectionItem).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType(Text).some(node => node.props.children === i18n.t('toast.moveSuccess'))).toBe(true);
  });

  it('a failed removal after the add leaves the link in both - an error is shown, never a silent loss', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N' }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [myLinkHere], nextCursor: null });
    jest.mocked(getCollections).mockResolvedValue({ items: [myCollection], nextCursor: null });
    jest.mocked(addItemToCollection).mockResolvedValue('added');
    jest.mocked(removeItemFromCollection).mockRejectedValue(new ApiError('unavailable', 503));
    const renderer = await renderScreen();

    await longPress(renderer, myLinkHere);
    const menu = renderer.root.findAllByType(ActionMenuDialog).find(dialog => dialog.props.visible)!;
    await act(async () => menu.props.actions.find((action: { label: string }) => action.label === i18n.t('collections.moveToOther')).onPress());
    await chooseDestinations(renderer, 7);

    // The picker stays open with the reason; the link was only added, never lost.
    expect(destinationPicker(renderer).props.visible).toBe(true);
    expect(destinationPicker(renderer).props.error).toBe(i18n.t('collections.moveError'));
  });

  it('the Owner\'s own link keeps 복제 / 이동 - unchanged', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: false }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [myLinkHere], nextCursor: null });
    const renderer = await renderScreen();

    expect(await longPress(renderer, myLinkHere)).toBe(true);
    expect(visibleMenuLabels(renderer)).toEqual([i18n.t('item.goToUrlA11y'), i18n.t('common.edit'), i18n.t('collections.addToOther'), i18n.t('collections.moveToOther'), i18n.t('collections.removeFromCollection')]);
  });

  it('cancelling the picker copies nothing, and a later selection copy is not affected by it', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'viewer', ownerJupleId: 'K7MP4Q8N' }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [othersLink], nextCursor: null });
    const renderer = await renderScreen();

    await longPress(renderer, othersLink);
    const menu = renderer.root.findAllByType(ActionMenuDialog).find(dialog => dialog.props.visible)!;
    await act(async () => menu.props.actions.find((action: { label: string }) => action.label === i18n.t('collections.copyToMine')).onPress());
    await act(async () => destinationPicker(renderer).props.onClose());

    expect(destinationPicker(renderer).props.visible).toBe(false);
    expect(copyCollectionItems).not.toHaveBeenCalled();
  });
});

describe('CollectionDetailsScreen - 컬렉션에서 제거 of my own link in someone else\'s Collection', () => {
  afterEach(() => jest.clearAllMocks());

  const swipeRow = (renderer: ReactTestRenderer.ReactTestRenderer, item: CollectionItemEntry) =>
    row(renderer, item).root.findByType(SwipeableItemRow);

  it.each(['contributor', 'viewer'] as const)('as a %s: my own link has the swipe remove; someone else\'s does not', async role => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: role, ownerJupleId: 'K7MP4Q8N' }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine, theirs], nextCursor: null });
    const renderer = await renderScreen();

    expect(swipeRow(renderer, mine).props.onDelete).toEqual(expect.any(Function));
    expect(swipeRow(renderer, mine).props.deleteLabel).toBe(i18n.t('collections.removeFromCollection'));
    expect(swipeRow(renderer, theirs).props.onDelete).toBeUndefined();
  });

  it('removes only the link (after the usual confirmation), and it leaves the list - the Item itself is not deleted', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N', itemCount: 2 }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine, theirs], nextCursor: null });
    jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    const onDelete = swipeRow(renderer, mine).props.onDelete;
    await act(async () => onDelete());
    const confirm = renderer.root.findAllByType(ConfirmDialog).find(dialog => dialog.props.visible && dialog.props.title === i18n.t('collections.unlinkConfirmTitle'))!;
    await act(async () => confirm.props.onConfirm());

    expect(removeItemFromCollection).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, mine.itemId);
    expect(findItemList(renderer).props.data.map((item: CollectionItemEntry) => item.itemId)).toEqual([theirs.itemId]);
    // A Contributor can put it back.
    expect(renderer.root.findAllByType(Text).some(node => node.props.children === i18n.t('toast.undoAction'))).toBe(true);
    expect(addItemToCollection).not.toHaveBeenCalled();
  });

  it('a member who is now a Viewer removes it without an undo they could not use', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'viewer', ownerJupleId: 'K7MP4Q8N' }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine, theirs], nextCursor: null });
    jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    const onDelete = swipeRow(renderer, mine).props.onDelete;
    await act(async () => onDelete());
    const confirm = renderer.root.findAllByType(ConfirmDialog).find(dialog => dialog.props.visible && dialog.props.title === i18n.t('collections.unlinkConfirmTitle'))!;
    await act(async () => confirm.props.onConfirm());

    expect(removeItemFromCollection).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, mine.itemId);
    expect(renderer.root.findAllByType(Text).some(node => node.props.children === i18n.t('toast.unlinkSuccess'))).toBe(true);
    expect(renderer.root.findAllByType(Text).some(node => node.props.children === i18n.t('toast.undoAction'))).toBe(false);
  });

  it('the Owner still removes any link, including a member\'s', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine, theirs], nextCursor: null });
    const renderer = await renderScreen();

    expect(swipeRow(renderer, theirs).props.onDelete).toEqual(expect.any(Function));
    expect(swipeRow(renderer, mine).props.onDelete).toEqual(expect.any(Function));
  });
});

/** The shared row's own (host) Pressable style, resolved for the idle state. */
const rowStyle = (entry: ReactTestRenderer.ReactTestInstance) => {
  const host = entry.findAll(node => node.props.accessibilityRole === 'button' && node.props.testID === entry.props.testID)[0];
  return typeof host.props.style === 'function' ? host.props.style({ pressed: false }) : host.props.style;
};

describe('CollectionDetailsScreen - 승인 대기 (links proposed for the Owner)', () => {
  afterEach(() => jest.clearAllMocks());

  const pendingEntry = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    header(renderer).root.findAll(node => node.props.testID === 'collection-details-pending' && typeof node.props.onPress === 'function')[0];

  const approvalSheet = (renderer: ReactTestRenderer.ReactTestRenderer, variant: 'owner' | 'mine') =>
    renderer.root.findAllByType(ApprovalSubmissionSheet).find(sheet => sheet.props.variant === variant)!;

  it('the Owner sees 승인 대기 N next to the link count, and it opens the approval popup (not a screen)', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true, itemCount: 18, pendingSubmissionCount: 3 }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    const renderer = await renderScreen();

    const entry = pendingEntry(renderer);
    expect(entry.findByType(Text).props.children).toBe('받은 승인 요청 3');
    expect(entry.props.accessibilityLabel).toBe('받은 승인 요청 3개 보기');
    // The link count is the links only - proposals are never counted in it.
    expect(header(renderer).root.findAllByType(Text).some(node => node.props.children === i18n.t('collections.detailItemCount', { count: 18 }))).toBe(true);
    expect(approvalSheet(renderer, 'owner').props.visible).toBe(false);
    await act(async () => entry.props.onPress());
    expect(approvalSheet(renderer, 'owner').props.visible).toBe(true);
    expect(approvalSheet(renderer, 'owner').props.collectionId).toBe(COLLECTION_ID);
    expect(mockNavigate).not.toHaveBeenCalled();
    // Answering inside the popup refreshes this Collection (its count and links) without leaving it.
    expect(approvalSheet(renderer, 'owner').props.onChanged).toEqual(expect.any(Function));
  });

  it('it is a clear one-line row of its own - below the title/header actions and above the sort chips, a full touch target, not small inline text', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true, itemCount: 18, pendingSubmissionCount: 1 }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    const renderer = await renderScreen();

    const entry = pendingEntry(renderer);
    expect(entry.findByType(Text).props.children).toBe('받은 승인 요청 1');
    expect(StyleSheet.flatten(rowStyle(entry))).toEqual(expect.objectContaining({ minHeight: 44, flexDirection: 'row', backgroundColor: colors.brandSoft, borderColor: colors.brand }));
    expect(entry.type).toBe(PendingActionRow);
    // Order inside the list header: title, header actions, this row, then the sort chips.
    const order = header(renderer).root
      .findAll(node => typeof node.type === 'string' && ['collection-details-title', 'collection-details-favorite', 'collection-details-pending', 'collection-sort-date'].includes(node.props.testID))
      .map(node => node.props.testID)
      .filter((id: string, index: number, all: string[]) => all.indexOf(id) === index);
    expect(order).toEqual(['collection-details-title', 'collection-details-favorite', 'collection-details-pending', 'collection-sort-date']);
  });

  describe('참여 요청 N (people waiting to join) - a row of its own beside 받은 승인 요청', () => {
    const joinEntry = (renderer: ReactTestRenderer.ReactTestRenderer) =>
      header(renderer).root.findAll(node => node.props.testID === 'collection-details-join-requests' && typeof node.props.onPress === 'function')[0];

    it('the Owner sees 참여 요청 N as a separate row of the same family - and both rows can be there together, each with its own number', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true, pendingSubmissionCount: 4, pendingJoinRequestCount: 1 }));
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
      const renderer = await renderScreen();

      expect(pendingEntry(renderer).findByType(Text).props.children).toBe('받은 승인 요청 4');
      const entry = joinEntry(renderer);
      expect(entry.findByType(Text).props.children).toBe('참여 요청 1');
      expect(entry.type).toBe(PendingActionRow);
      expect(StyleSheet.flatten(rowStyle(entry))).toEqual(expect.objectContaining({ minHeight: 44, flexDirection: 'row' }));
      // Order in the header: the link approvals, then the applicants, then the sort chips.
      const order = header(renderer).root
        .findAll(node => typeof node.type === 'string' && ['collection-details-pending', 'collection-details-join-requests', 'collection-sort-date'].includes(node.props.testID))
        .map(node => node.props.testID)
        .filter((id: string, index: number, all: string[]) => all.indexOf(id) === index);
      expect(order).toEqual(['collection-details-pending', 'collection-details-join-requests', 'collection-sort-date']);
    });

    it('it is hidden at zero, and for anyone but the Owner', async () => {
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true, pendingJoinRequestCount: 0 }));
      expect(joinEntry(await renderScreen())).toBeUndefined();

      jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', hasCollaborators: true, pendingJoinRequestCount: 2 }));
      expect(joinEntry(await renderScreen())).toBeUndefined();
    });

    it('it opens the 참여 요청 BOTTOM SHEET over the Collection - no navigation anywhere, and the approval popup stays closed', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true, pendingSubmissionCount: 2, pendingJoinRequestCount: 1 }));
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
      const renderer = await renderScreen();
      const entry = joinEntry(renderer);
      const sheet = () => renderer.root.findByType(JoinRequestsSheet);
      expect(sheet().props.visible).toBe(false);
      mockNavigate.mockClear();

      await act(async () => {
        entry.props.onPress();
      });

      expect(sheet().props.visible).toBe(true);
      expect(sheet().props.collectionId).toBe(COLLECTION_ID);
      expect(sheet().props.expectedCount).toBe(1);
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(renderer.root.findAllByType(ApprovalSubmissionSheet).every(approval => approval.props.visible !== true)).toBe(true);

      await act(async () => {
        sheet().props.onClose();
      });
      expect(sheet().props.visible).toBe(false);
    });

    it('an answered applicant refreshes the Collection (count, row and badge source) without leaving it', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true, pendingJoinRequestCount: 1 }));
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
      const renderer = await renderScreen();
      const before = jest.mocked(getCollection).mock.calls.length;
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true, pendingJoinRequestCount: 0 }));

      await act(async () => {
        renderer.root.findByType(JoinRequestsSheet).props.onChanged();
      });

      expect(jest.mocked(getCollection).mock.calls.length).toBeGreaterThan(before);
      expect(joinEntry(renderer)).toBeUndefined();
    });

    it('the Participants section holds no 참여 요청 - they are not participants yet', async () => {
      jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true, pendingJoinRequestCount: 3 }));
      jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
      const renderer = await renderScreen();

      const participantsText = renderer.root.findAll(node => String(node.props.testID ?? '').startsWith('collection-details-participants')).flatMap(node => node.findAllByType(Text).map(text => String(text.props.children)));
      expect(participantsText.join(' ')).not.toContain('참여 요청');
    });
  });

  it('a link in a date section is framed by the very same accordion row History uses', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    const renderer = await renderScreen();

    const frame = row(renderer, mine).root.findByType(SwipeableItemRow).props.containerStyle;
    // The same style objects (not look-alike copies): one definition for History and a Collection.
    expect([frame].flat(2)).toContain(dateAccordionStyles.row);
  });

  const myPendingEntry = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    header(renderer).root.findAll(node => node.props.testID === 'collection-details-my-pending' && typeof node.props.onPress === 'function')[0];

  it('a submitter with links waiting sees 내 승인 대기 N (a status row, not the Owner queue), which opens their own popup scoped to this Collection', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'submitter', ownerJupleId: 'K7MP4Q8N', myPendingSubmissionCount: 2 }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    const renderer = await renderScreen();

    const entry = myPendingEntry(renderer);
    expect(entry.findByType(Text).props.children).toBe('보낸 승인 요청 2');
    expect(entry.props.accessibilityLabel).toBe('보낸 승인 요청 2개 보기');
    expect(pendingEntry(renderer)).toBeUndefined();
    expect(approvalSheet(renderer, 'mine').props.visible).toBe(false);
    await act(async () => entry.props.onPress());
    expect(approvalSheet(renderer, 'mine').props.visible).toBe(true);
    expect(approvalSheet(renderer, 'mine').props.collectionId).toBe(COLLECTION_ID);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('nothing of mine waiting (0): no row', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'submitter', ownerJupleId: 'K7MP4Q8N', myPendingSubmissionCount: 0 }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });

    expect(myPendingEntry(await renderScreen())).toBeUndefined();
  });

  it('the row sits under the sort / List-Grid controls and right before the first link - a long row like the Owner one', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'submitter', ownerJupleId: 'K7MP4Q8N', myPendingSubmissionCount: 2 }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    const renderer = await renderScreen();

    const order = header(renderer).root
      .findAll(node => typeof node.type === 'string' && ['collection-details-title', 'collection-sort-date', 'collection-details-my-pending'].includes(node.props.testID))
      .map(node => node.props.testID)
      .filter((id: string, index: number, all: string[]) => all.indexOf(id) === index);
    expect(order).toEqual(['collection-details-title', 'collection-sort-date', 'collection-details-my-pending']);
    // It is the last thing of the header: the list's own rows (the links) follow it directly.
    const headerChildren = header(renderer).root.findAll(node => typeof node.type === 'string' && node.props.testID === 'collection-details-my-pending');
    expect(headerChildren).toHaveLength(1);
    // Same family as the Owner row: one-line, a full touch target tall, same corner radius.
    const entry = myPendingEntry(renderer);
    expect(StyleSheet.flatten(rowStyle(entry))).toEqual(expect.objectContaining({ minHeight: 44, flexDirection: 'row', borderRadius: radii.md, backgroundColor: colors.brandSoft, borderColor: colors.brand }));
    expect(entry.findByType(Text).props.children).toBe('보낸 승인 요청 2');
    // The very same shared row as the Owner's - only the text and the handler differ.
    expect(entry.type).toBe(PendingActionRow);
  });

  it('the Owner row and my row are separate rows with separate numbers - never merged', async () => {
    // (A server never gives one person both; the screen is still built to show each on its own.)
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true, pendingSubmissionCount: 3, myPendingSubmissionCount: 4 }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    const renderer = await renderScreen();

    expect(pendingEntry(renderer).findByType(Text).props.children).toBe('받은 승인 요청 3');
    expect(myPendingEntry(renderer).findByType(Text).props.children).toBe('보낸 승인 요청 4');
    expect(pendingEntry(renderer).props.accessibilityLabel).toBe('받은 승인 요청 3개 보기');
    expect(myPendingEntry(renderer).props.accessibilityLabel).toBe('보낸 승인 요청 4개 보기');
  });

  it('pull-to-refresh keeps the count honest: a new proposal raises it, an approval or decline removes it', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'submitter', ownerJupleId: 'K7MP4Q8N', myPendingSubmissionCount: 1 }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    const renderer = await renderScreen();
    expect(myPendingEntry(renderer).findByType(Text).props.children).toBe('보낸 승인 요청 1');
    const pull = async () => act(async () => {
      renderer.root.findAllByType(FlatList)[0].props.refreshControl.props.onRefresh();
    });

    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'submitter', ownerJupleId: 'K7MP4Q8N', myPendingSubmissionCount: 3 }));
    await pull();
    expect(myPendingEntry(renderer).findByType(Text).props.children).toBe('보낸 승인 요청 3');

    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'submitter', ownerJupleId: 'K7MP4Q8N', myPendingSubmissionCount: 0 }));
    await pull();
    expect(myPendingEntry(renderer)).toBeUndefined();
  });

  it('the 총 N개 line and the sort / List-Grid row are spaced like Home (the shared controls gap), the toggle at the far end', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true, itemCount: 18 }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    const renderer = await renderScreen();

    const chips = header(renderer).root.findByType(LinkSortChips);
    const controlsRow = chips.parent!;
    expect(StyleSheet.flatten(controlsRow.props.style)).toMatchObject({ flexDirection: 'row', marginTop: LINK_CONTROLS_TOP_GAP, marginBottom: LINK_CONTROLS_BOTTOM_GAP });
    // Two separate gaps: 총 N개 -> controls (top) and controls -> first link (bottom), the very values Home uses.
    expect(LINK_CONTROLS_TOP_GAP).not.toBe(LINK_CONTROLS_BOTTOM_GAP);
    // The wording is 시간순.
    expect(chips.props.dateLabel).toBe('시간순');
    const children = controlsRow.children as ReactTestRenderer.ReactTestInstance[];
    expect(children[children.length - 1].type).toBe(ViewModeToggle);
  });

  it('pull-to-refresh reloads the Collection itself, so a proposal that arrived meanwhile shows at once', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true, itemCount: 18, pendingSubmissionCount: 0 }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    const renderer = await renderScreen();
    expect(pendingEntry(renderer)).toBeUndefined();

    // B proposes a link while A stays on the screen - no navigation away and back.
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true, itemCount: 18, pendingSubmissionCount: 2 }));
    const callsBefore = jest.mocked(getCollection).mock.calls.length;
    await act(async () => {
      renderer.root.findAllByType(FlatList)[0].props.refreshControl.props.onRefresh();
    });

    expect(jest.mocked(getCollection).mock.calls.length).toBe(callsBefore + 1);
    expect(pendingEntry(renderer).findByType(Text).props.children).toBe('받은 승인 요청 2');
  });

  it('nothing waiting: no entry at all', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true, pendingSubmissionCount: 0 }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    const renderer = await renderScreen();

    expect(pendingEntry(renderer)).toBeUndefined();
  });

  it.each(['submitter', 'contributor', 'viewer'] as const)('a %s never sees it', async role => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: role, ownerJupleId: 'K7MP4Q8N', pendingSubmissionCount: 2 }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    const renderer = await renderScreen();

    expect(pendingEntry(renderer)).toBeUndefined();
  });

  it('a 승인 후 추가 member is a member like any other: their own link keeps its swipe remove, others\' links only the copy', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'submitter', ownerJupleId: 'K7MP4Q8N' }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine, theirs], nextCursor: null });
    const renderer = await renderScreen();

    expect(row(renderer, mine).root.findByType(SwipeableItemRow).props.onDelete).toEqual(expect.any(Function));
    expect(row(renderer, theirs).root.findByType(SwipeableItemRow).props.onDelete).toBeUndefined();
    expect(row(renderer, theirs).root.findByType(SwipeableItemRow).props.onLongPress).toEqual(expect.any(Function));
  });
});

describe('CollectionDetailsScreen - passing on the public link as a member', () => {
  afterEach(() => jest.clearAllMocks());

  const shareLinkButton = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    header(renderer).root.findAll(node => node.props.testID === 'collection-details-share-link' && typeof node.props.onPress === 'function')[0];

  it('public link off: no share button for a member', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'viewer', ownerJupleId: 'K7MP4Q8N' }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    jest.mocked(getCollectionShareLink).mockResolvedValue(null);
    const renderer = await renderScreen();

    expect(getCollectionShareLink).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID);
    expect(shareLinkButton(renderer)).toBeUndefined();
    expect(header(renderer).root.findAll(node => node.props.testID === 'collection-details-share')).toHaveLength(0);
  });

  const sheet = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findByType(CollectionLinkShareSheet);
  const hasToast = (renderer: ReactTestRenderer.ReactTestRenderer, message: string) =>
    renderer.root.findAllByType(Text).some(node => node.props.children === message);

  it.each(['viewer', 'contributor'] as const)('public link on (%s): the share button re-checks with the server, then opens 친구 / ID / 외부 공유 - no settings, no changes', async role => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: role, ownerJupleId: 'K7MP4Q8N', isSharePasswordProtected: true }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    jest.mocked(getCollectionShareLink).mockResolvedValue('https://dev.juple.co.kr/c/abc123');
    const renderer = await renderScreen();
    expect(getCollectionShareLink).toHaveBeenCalledTimes(1);

    const button = shareLinkButton(renderer);
    expect(button.props.accessibilityLabel).toBe(i18n.t('collections.sharePublicLinkA11y'));
    await act(async () => button.props.onPress());

    // Asked the server again at the tap - never trusting the URL loaded earlier.
    expect(getCollectionShareLink).toHaveBeenCalledTimes(2);
    expect(sheet(renderer).props.visible).toBe(true);
    expect(shareItem).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalledWith('CollectionShare', expect.anything());
    // Order: [★] [🔔] [share] [⋯] - the Owner's settings entry is not there.
    const ids = header(renderer).root
      .findAll(node => typeof node.props.testID === 'string' && typeof node.props.onPress === 'function' && /^collection-details-/.test(node.props.testID))
      .map(node => node.props.testID);
    expect(ids.indexOf('collection-details-share-link')).toBeGreaterThan(ids.indexOf('collection-details-favorite'));
    expect(ids).not.toContain('collection-details-share');
  });

  it('turned off by the Owner since the screen loaded: the tap opens nothing, the button disappears, and it says why', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'viewer', ownerJupleId: 'K7MP4Q8N' }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    jest.mocked(getCollectionShareLink).mockResolvedValueOnce('https://dev.juple.co.kr/c/abc123').mockResolvedValueOnce(null);
    const renderer = await renderScreen();

    const onPress = shareLinkButton(renderer).props.onPress;
    await act(async () => onPress());

    expect(sheet(renderer).props.visible).toBe(false);
    expect(shareItem).not.toHaveBeenCalled();
    expect(shareLinkButton(renderer)).toBeUndefined();
    expect(hasToast(renderer, '공용 컬렉션이 종료되었습니다.')).toBe(true);
  });

  it('외부 공유 checks once more and hands the URL the server has now to the OS share sheet', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'viewer', ownerJupleId: 'K7MP4Q8N' }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    jest.mocked(getCollectionShareLink)
      .mockResolvedValueOnce('https://dev.juple.co.kr/c/abc123')
      .mockResolvedValueOnce('https://dev.juple.co.kr/c/abc123')
      .mockResolvedValueOnce('https://dev.juple.co.kr/c/new456');
    const renderer = await renderScreen();
    const onPress = shareLinkButton(renderer).props.onPress;
    await act(async () => onPress());

    await act(async () => sheet(renderer).props.onShareExternally());

    expect(shareItem).toHaveBeenCalledWith('https://dev.juple.co.kr/c/new456', 'Trip');
    expect(sheet(renderer).props.visible).toBe(false);
  });

  it('sent / turned off while sending: the sheet closes and says so - an off link also hides the button', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N' }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    jest.mocked(getCollectionShareLink).mockResolvedValue('https://dev.juple.co.kr/c/abc123');
    const renderer = await renderScreen();
    const onPress = shareLinkButton(renderer).props.onPress;
    await act(async () => onPress());

    await act(async () => sheet(renderer).props.onSent(2));
    expect(sheet(renderer).props.visible).toBe(false);
    expect(hasToast(renderer, i18n.t('linkShare.sent', { count: 2 }))).toBe(true);

    const reopen = shareLinkButton(renderer).props.onPress;
    await act(async () => reopen());
    await act(async () => sheet(renderer).props.onLinkInactive());
    expect(sheet(renderer).props.visible).toBe(false);
    expect(shareLinkButton(renderer)).toBeUndefined();
    expect(hasToast(renderer, '공용 컬렉션이 종료되었습니다.')).toBe(true);
  });

  it('the Owner keeps the share button that opens the Share settings, and never asks for the member link', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    const renderer = await renderScreen();

    const ownerShare = header(renderer).root.findAll(node => node.props.testID === 'collection-details-share' && typeof node.props.onPress === 'function')[0];
    await act(async () => ownerShare.props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('CollectionShare', { collectionId: COLLECTION_ID });
    expect(getCollectionShareLink).not.toHaveBeenCalled();
    expect(shareLinkButton(renderer)).toBeUndefined();
  });

  it('turned off by the Owner elsewhere: the button goes away on the next focus refresh', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'viewer', ownerJupleId: 'K7MP4Q8N' }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    jest.mocked(getCollectionShareLink).mockResolvedValueOnce('https://dev.juple.co.kr/c/abc123').mockResolvedValueOnce(null);
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <AppToastProvider>
          <CollectionDetailsScreen navigation={navigation} route={route} />
        </AppToastProvider>,
      );
    });
    await act(async () => {
      await new Promise<void>(resolve => setImmediate(() => resolve()));
    });
    expect(shareLinkButton(renderer)).toBeDefined();

    // A refresh (the same load a focus runs) - here through the screen's refreshToken param.
    await act(async () => {
      renderer.update(
        <AppToastProvider>
          <CollectionDetailsScreen navigation={navigation} route={{ ...(route as object), params: { collectionId: COLLECTION_ID, refreshToken: 1 } } as never} />
        </AppToastProvider>,
      );
    });
    await act(async () => {
      await new Promise<void>(resolve => setImmediate(() => resolve()));
    });
    expect(shareLinkButton(renderer)).toBeUndefined();
  });
});

describe('CollectionDetailsScreen - locked Collection', () => {
  beforeEach(() => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', isLocked: true, ownerJupleId: 'K7MP4Q8N' }));
  });

  afterEach(() => {
    jest.clearAllMocks();
    clearCollectionUnlockGrants();
  });

  const emptyArea = (renderer: ReactTestRenderer.ReactTestRenderer) => {
    const list = findItemList(renderer);
    return { list, part: list.props.ListEmptyComponent ? renderPart(list.props.ListEmptyComponent) : null };
  };

  it('shows the password prompt and no links until the server accepts the password', async () => {
    jest.mocked(getCollectionItems).mockRejectedValue(lockedError);
    const renderer = await renderScreen();
    const { list, part } = emptyArea(renderer);

    expect(list.props.data).toEqual([]);
    expect(part!.root.findAll(node => node.props.testID === 'collection-unlock-panel').length).toBeGreaterThan(0);
  });

  it('tells a Contributor to ask the Owner for the password - no reset offered', async () => {
    jest.mocked(getCollectionItems).mockRejectedValue(lockedError);
    const renderer = await renderScreen();
    const { part } = emptyArea(renderer);

    expect(part!.root.findAll(node => node.props.testID === 'collection-unlock-contact-owner').length).toBeGreaterThan(0);
  });

  it('shows no "forgot password" reset to the Owner either, until the server can verify a re-sign-in', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', isLocked: true }));
    jest.mocked(getCollectionItems).mockRejectedValue(lockedError);
    const renderer = await renderScreen();
    const { part } = emptyArea(renderer);

    expect(part!.root.findAll(node => node.props.testID === 'collection-unlock-contact-owner')).toHaveLength(0);
    expect(part!.root.findAllByType(Text).some(node => /비밀번호를 잊|forgot/i.test(String(node.props.children)))).toBe(false);
  });

  it('a wrong password shows an error and stores nothing', async () => {
    jest.mocked(getCollectionItems).mockRejectedValue(lockedError);
    jest.mocked(unlockCollection).mockRejectedValue(new ApiError('forbidden', 403, 'invalidCollectionPassword'));
    const renderer = await renderScreen();
    const { part } = emptyArea(renderer);

    await act(async () => {
      part!.root.findByProps({ testID: 'collection-unlock-password' }).props.onChangeText('nope-nope');
    });
    await act(async () => {
      await part!.root.findByProps({ testID: 'collection-unlock-submit' }).props.onPress();
    });

    expect(part!.root.findAllByType(Text).some(node => node.props.children === '비밀번호가 올바르지 않습니다.')).toBe(true);
    expect(getCollectionUnlockToken(COLLECTION_ID)).toBeNull();
  });

  it('the right password stores a short-lived grant and reloads the links with it', async () => {
    jest.mocked(getCollectionItems)
      .mockRejectedValueOnce(lockedError)
      .mockResolvedValue({ items: [theirs], nextCursor: null });
    jest.mocked(unlockCollection).mockResolvedValue({ unlockToken: 'grant-1', expiresAtUtc: new Date(Date.now() + 15 * 60_000).toISOString() });
    const renderer = await renderScreen();
    const { part } = emptyArea(renderer);

    await act(async () => {
      part!.root.findByProps({ testID: 'collection-unlock-password' }).props.onChangeText('correct horse');
    });
    await act(async () => {
      await part!.root.findByProps({ testID: 'collection-unlock-submit' }).props.onPress();
    });

    expect(unlockCollection).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, 'correct horse');
    expect(getCollectionUnlockToken(COLLECTION_ID)).toBe('grant-1');
    expect(jest.mocked(getCollectionItems)).toHaveBeenLastCalledWith(expect.anything(), COLLECTION_ID, expect.objectContaining({ unlockToken: 'grant-1' }));
    expect(findItemList(renderer).props.data).toEqual([theirs]);
  });

  it('a grant already held for this visit loads the links without asking again', async () => {
    rememberCollectionUnlock(COLLECTION_ID, 'grant-2', new Date(Date.now() + 10 * 60_000).toISOString());
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [theirs], nextCursor: null });

    const renderer = await renderScreen();

    expect(jest.mocked(getCollectionItems)).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, expect.objectContaining({ unlockToken: 'grant-2' }));
    expect(findItemList(renderer).props.data).toEqual([theirs]);
    expect(unlockCollection).not.toHaveBeenCalled();
  });

  it('a grant the server no longer accepts (password changed) is dropped and the prompt returns', async () => {
    rememberCollectionUnlock(COLLECTION_ID, 'stale-grant', new Date(Date.now() + 10 * 60_000).toISOString());
    jest.mocked(getCollectionItems).mockRejectedValue(lockedError);

    const renderer = await renderScreen();

    expect(getCollectionUnlockToken(COLLECTION_ID)).toBeNull();
    expect(findItemList(renderer).props.data).toEqual([]);
    expect(emptyArea(renderer).part!.root.findAll(node => node.props.testID === 'collection-unlock-panel').length).toBeGreaterThan(0);
  });
});

describe('CollectionDetailsScreen - managing a locked Collection (Owner)', () => {
  beforeEach(() => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', isLocked: true }));
    jest.mocked(getCollectionItems).mockRejectedValue(lockedError);
  });

  afterEach(() => {
    jest.clearAllMocks();
    clearCollectionUnlockGrants();
  });

  it('without a grant, 공유 asks for the password first and then continues to the Share screen', async () => {
    jest.mocked(unlockCollection).mockResolvedValue({ unlockToken: 'grant-9', expiresAtUtc: new Date(Date.now() + 15 * 60_000).toISOString() });
    const renderer = await renderScreen();

    const top = header(renderer);
    act(() => {
      top.root.findByProps({ testID: 'collection-details-share' }).props.onPress();
    });
    expect(mockNavigate).not.toHaveBeenCalledWith('CollectionShare', expect.anything());

    const gate = renderer.root.findByProps({ testID: 'collection-details-unlock-gate' });
    await act(async () => {
      gate.findByProps({ testID: 'collection-unlock-password' }).props.onChangeText('correct horse');
    });
    await act(async () => {
      await renderer.root.findByProps({ testID: 'collection-details-unlock-gate' }).findByProps({ testID: 'collection-unlock-submit' }).props.onPress();
    });

    expect(unlockCollection).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, 'correct horse');
    expect(mockNavigate).toHaveBeenCalledWith('CollectionShare', { collectionId: COLLECTION_ID });
  });

  it('with a grant from this session, edit/share run at once without asking again', async () => {
    rememberCollectionUnlock(COLLECTION_ID, 'grant-3', new Date(Date.now() + 10 * 60_000).toISOString());
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [], nextCursor: null }); // the server accepts the grant
    const renderer = await renderScreen();

    const top = header(renderer);
    act(() => {
      top.root.findByProps({ testID: 'collection-details-share' }).props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('CollectionShare', { collectionId: COLLECTION_ID });
    expect(unlockCollection).not.toHaveBeenCalled();
    expect(renderer.root.findAll(node => node.props.testID === 'collection-details-unlock-gate')).toHaveLength(0);
  });

  it('the menu offers only 잠금 해제 - the password itself is managed in Settings', async () => {
    const renderer = await renderScreen();
    const top = header(renderer);
    act(() => {
      top.root.findByProps({ accessibilityLabel: i18n.t('collections.manageAction') }).props.onPress();
    });

    const labels = renderer.root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.accessibilityLabel === 'string')
      .map(node => node.props.accessibilityLabel);
    expect(labels).toContain(i18n.t('collections.lockRemoveAction'));
    expect(labels).not.toContain(i18n.t('collections.lockSetTitle'));
    expect(labels).not.toContain(i18n.t('settings.collectionLockChangePassword'));
  });
});

describe('CollectionDetailsScreen - 잠금 설정 under the Owner\'s lock password', () => {
  beforeEach(() => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', isLocked: false }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    jest.mocked(setCollectionLock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    clearCollectionUnlockGrants();
  });

  async function openLockDialog() {
    const renderer = await renderScreen();
    const top = header(renderer);
    act(() => {
      top.root.findByProps({ accessibilityLabel: i18n.t('collections.manageAction') }).props.onPress();
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.lockSetTitle') }).props.onPress();
    });
    return renderer;
  }

  it('with a lock password set: a confirmation, no password typed, and the Collection is locked', async () => {
    const renderer = await openLockDialog();

    expect(renderer.root.findAll(node => node.props.testID === 'lock-new-password')).toHaveLength(0);
    await act(async () => {
      await renderer.root.findByProps({ testID: 'lock-save' }).props.onPress();
    });

    expect(setCollectionLock).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID);
  });

  it('without one: "먼저 잠금 비밀번호를 설정해 주세요" and 설정하기 opens Settings > 컬렉션 잠금 - nothing is locked', async () => {
    jest.mocked(getCollectionLockPasswordStatus).mockResolvedValueOnce({ isConfigured: false, passwordChangedAtUtc: null });
    const renderer = await openLockDialog();

    await act(async () => {
      await renderer.root.findByProps({ testID: 'lock-open-settings' }).props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('CollectionLockSettings');
    expect(setCollectionLock).not.toHaveBeenCalled();
  });
});

describe('CollectionDetailsScreen - the participants popup is view-only (management lives on the Share screen)', () => {
  const ownerView = {
    participants: [
      { jupleId: 'WNER2345', displayName: '피카츄', role: 'owner', isMe: true },
      { jupleId: 'CNTRB234', displayName: '파이리', role: 'contributor' },
    ],
    pendingInvitations: [{ invitationId: 9, jupleId: 'PNDNG234', displayName: null, role: 'Contributor', createdAtUtc: '', expiresAtUtc: '' }],
    canManage: true,
  };

  beforeEach(() => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({
      accessRole: 'owner',
      hasCollaborators: true,
      participantPreview: [{ jupleId: 'CNTRB234', displayName: '파이리', role: 'contributor' }],
      otherParticipantCount: 1,
    }));
    jest.mocked(getCollectionParticipants).mockResolvedValue(ownerView as never);
  });

  afterEach(() => {
    jest.clearAllMocks();
    clearCollectionUnlockGrants();
  });

  it('the Owner sees participants and the pending invitation with NO remove / cancel controls, in List and in Grid', async () => {
    const renderer = await renderScreen();
    const top = header(renderer);
    await act(async () => {
      top.root.findByProps({ testID: 'collection-details-participants' }).props.onPress();
    });
    const ids = () => renderer.root.findAll(node => typeof node.props.testID === 'string').map(node => node.props.testID as string);

    expect(ids()).toContain('participants-sheet-avatar-CNTRB234');
    expect(ids()).toContain('participants-sheet-pending-9');
    expect(ids().filter(id => /participants-sheet-(remove|revoke)-|-manage$/.test(id))).toEqual([]);

    await act(async () => {
      renderer.root.findAll(node => node.props.testID === 'participants-sheet')[0].findByType(ViewModeToggle).props.onChange('grid');
    });
    expect(ids().filter(id => /participants-sheet-(remove|revoke)-|-manage$/.test(id))).toEqual([]);
    expect(ids()).toContain('participants-sheet-CNTRB234-avatar');
    expect(removeCollaborator).not.toHaveBeenCalled();
    expect(revokeCollectionInvitation).not.toHaveBeenCalled();
  });
});

// ---------- The Collection's own share password (separate from the Owner's lock) ----------

jest.mock('../../collections/api/sharePasswordApi', () => ({
  ...jest.requireActual('../../collections/api/sharePasswordApi'),
  unlockSharePassword: jest.fn(),
}));

describe('CollectionDetailsScreen - share password (recipient)', () => {
  const sharePasswordRequired = new ApiError('forbidden', 403, 'sharePasswordRequired');
  const { unlockSharePassword } = jest.requireMock('../../collections/api/sharePasswordApi') as { unlockSharePassword: jest.Mock };
  const grant = (token: string) => ({ unlockToken: token, expiresAtUtc: new Date(Date.now() + 15 * 60_000).toISOString() });
  const texts = (part: ReactTestRenderer.ReactTestRenderer) => part.root.findAllByType(Text).map(node => String(node.props.children));
  const emptyPart = (renderer: ReactTestRenderer.ReactTestRenderer) => {
    const list = findItemList(renderer);
    return { list, part: list.props.ListEmptyComponent ? renderPart(list.props.ListEmptyComponent) : null };
  };
  async function submit(part: ReactTestRenderer.ReactTestRenderer, password: string) {
    await act(async () => {
      part.root.findByProps({ testID: 'collection-unlock-password' }).props.onChangeText(password);
    });
    await act(async () => {
      await part.root.findByProps({ testID: 'collection-unlock-submit' }).props.onPress();
    });
  }

  beforeEach(() => {
    jest.mocked(getCollection).mockResolvedValue(
      makeCollection({ accessRole: 'viewer', ownerJupleId: 'K7MP4Q8N', isSharePasswordProtected: true }),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    clearCollectionUnlockGrants();
  });

  it('asks for the share password before any link - in its own words, never the Owner\'s lock password', async () => {
    jest.mocked(getCollectionItems).mockRejectedValue(sharePasswordRequired);
    const renderer = await renderScreen();
    const { list, part } = emptyPart(renderer);

    expect(list.props.data).toEqual([]);
    expect(part!.root.findAll(node => node.props.testID === 'collection-share-password-panel').length).toBeGreaterThan(0);
    expect(part!.root.findAll(node => node.props.testID === 'collection-unlock-panel')).toHaveLength(0);
    expect(texts(part!)).toContain(i18n.t('collections.sharePasswordLockedTitle'));
    expect(texts(part!).some(text => text.includes('잠금 비밀번호'))).toBe(false);
    expect(renderer.root.findAllByType(Text).some(node => node.props.children === 'Theirs' || node.props.children === 'Mine')).toBe(false);
  });

  it('a wrong share password shows the error and stores nothing', async () => {
    jest.mocked(getCollectionItems).mockRejectedValue(sharePasswordRequired);
    unlockSharePassword.mockRejectedValue(new ApiError('forbidden', 403, 'invalidCollectionPassword'));
    const renderer = await renderScreen();
    const { part } = emptyPart(renderer);

    await submit(part!, 'nope');

    expect(texts(part!)).toContain(i18n.t('collections.sharePasswordWrong'));
    expect(getCollectionUnlockToken(COLLECTION_ID)).toBeNull();
  });

  it('too many attempts says to wait', async () => {
    jest.mocked(getCollectionItems).mockRejectedValue(sharePasswordRequired);
    unlockSharePassword.mockRejectedValue(new ApiError('tooManyRequests', 429, 'collectionUnlockThrottled'));
    const renderer = await renderScreen();
    const { part } = emptyPart(renderer);

    await submit(part!, 'nope');

    expect(texts(part!)).toContain(i18n.t('collections.lockTooManyAttempts'));
  });

  it('the right one keeps a grant for this visit and loads the links with it', async () => {
    jest.mocked(getCollectionItems).mockImplementation(async (_request, _id, options) => {
      if (options?.unlockToken !== 'share-grant-1') {
        throw sharePasswordRequired;
      }
      return { items: [theirs], nextCursor: null };
    });
    unlockSharePassword.mockResolvedValue(grant('share-grant-1'));
    const renderer = await renderScreen();
    const { part } = emptyPart(renderer);

    await submit(part!, 'trip-2026');
    await act(async () => {
      await new Promise<void>(resolve => setImmediate(() => resolve()));
    });

    expect(unlockSharePassword).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, 'trip-2026');
    expect(getCollectionUnlockToken(COLLECTION_ID)).toBe('share-grant-1');
    expect(findItemList(renderer).props.data).toEqual([theirs]);
    expect(jest.mocked(getCollectionItems)).toHaveBeenLastCalledWith(expect.anything(), COLLECTION_ID, expect.objectContaining({ unlockToken: 'share-grant-1' }));
  });

  it('after the Owner changes it, the old grant is dropped and the prompt comes back', async () => {
    rememberCollectionUnlock(COLLECTION_ID, 'share-grant-old', new Date(Date.now() + 10 * 60_000).toISOString());
    jest.mocked(getCollectionItems).mockRejectedValue(sharePasswordRequired);

    const renderer = await renderScreen();

    expect(getCollectionUnlockToken(COLLECTION_ID)).toBeNull();
    expect(emptyPart(renderer).part!.root.findAll(node => node.props.testID === 'collection-share-password-panel').length).toBeGreaterThan(0);
  });

  it('the Owner is never asked for it - their own lock is the only thing they may be asked', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', isSharePasswordProtected: true }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine], nextCursor: null });
    const renderer = await renderScreen();

    expect(findItemList(renderer).props.data).toEqual([mine]);
    expect(renderer.root.findAll(node => node.props.testID === 'collection-share-password-panel')).toHaveLength(0);

    // Locked as well: the lock panel - never a share-password panel, and no share password opens it.
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', isLocked: true, isSharePasswordProtected: true }));
    jest.mocked(getCollectionItems).mockRejectedValue(lockedError);
    const locked = await renderScreen();
    const { part } = emptyPart(locked);
    expect(part!.root.findAll(node => node.props.testID === 'collection-unlock-panel').length).toBeGreaterThan(0);
    expect(part!.root.findAll(node => node.props.testID === 'collection-share-password-panel')).toHaveLength(0);
    expect(unlockSharePassword).not.toHaveBeenCalled();
  });
});
