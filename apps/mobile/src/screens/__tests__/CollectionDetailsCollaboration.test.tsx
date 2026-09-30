import { ActionMenuDialog } from '../../components/ActionMenuDialog';
import { BellIcon } from '../../icons/BellIcon';
import { CopyIcon } from '../../icons/CopyIcon';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CollectionParticipantsSheet } from '../../collections/CollectionParticipantsSheet';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Switch, Text } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { AppToastProvider } from '../../components/AppToast';
import { CollectionDetailsScreen } from '../CollectionDetailsScreen';
import {
  copyCollectionItems,
  getCollection,
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
  MAX_ITEMS_PER_COPY: 200,
}));
jest.mock('../../categories/categorySnapshotSync', () => ({ syncCategorySnapshotToNative: jest.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  jest.mocked(getCollectionNotificationPreference).mockResolvedValue({ newItemNotificationsEnabled: true });
});

jest.mock('../../items/shareItem', () => ({ shareItem: jest.fn() }));
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
 * 일자순 as the server now serves it, standing in for GET collections/{id}/items/sections: every
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
 * The link list, whichever one the current sort renders: 일자순 (the default) is one flat list of
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
  // The 일자순 list is the one without columns (이름순 always sets numColumns).
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
  // 일자순 loads the section summary, then the open section's first page - let both land.
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

    expect(top.root.findAllByType(Text).some(node => node.props.children === '피카츄')).toBe(true);
    for (const label of [
      i18n.t('common.edit'),
      i18n.t('common.delete'),
      i18n.t('collections.shareAction'),
    ]) {
      expect(hasLabel(top, label)).toBe(false);
    }
    // [★] [🔔] [⋯]: their own 새 링크 알림 is the bell; the ⋯ holds only copying into their own Collection.
    expect(headerButtonIds(top)).toEqual(['collection-details-favorite', 'collection-details-notifications', 'collection-details-more']);
    expect(await recipientMenuLabels(renderer)).toEqual([i18n.t('collections.copyToMine')]);
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
    expect(mockNavigate).toHaveBeenLastCalledWith('CollectionSharedItem', { collectionId: COLLECTION_ID, itemId: 2 });
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
    const destination = renderer.root.findAll(node => node.props.accessibilityLabel === 'My Picks' && typeof node.props.onPress === 'function')[0];
    await act(async () => destination.props.onPress());

    expect(copyCollectionItems).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, [2, 1], 7, null);
    expect(renderer.root.findAllByType(Text).some(node => node.props.children === '2개 중 1개를 복사했어요. 1개는 이미 컬렉션에 있어요.')).toBe(true);
    // Selection mode is over.
    expect(renderer.root.findAll(node => node.props.testID === 'collection-copy-bar')).toHaveLength(0);
  });

  it('never offers copying while the content is still behind the share password', async () => {
    jest.mocked(getCollection).mockResolvedValue(
      makeCollection({ accessRole: 'viewer', isSharePasswordProtected: true, ownerJupleId: 'K7MP4Q8N' }),
    );
    jest.mocked(getCollectionItems).mockRejectedValue(new ApiError('forbidden', 403, 'sharePasswordRequired'));
    const renderer = await renderScreen();

    // Nothing to copy yet, so no ⋯ at all - their own bell is still there.
    const top = header(renderer);
    expect(top.root.findAll(node => node.props.testID === 'collection-details-more')).toHaveLength(0);
    expect(headerButtonIds(top)).toEqual(['collection-details-favorite', 'collection-details-notifications']);
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

    expect(top.root.findAllByType(Text).some(node => node.props.children === '피카츄')).toBe(true);
    for (const label of [
      i18n.t('common.edit'),
      i18n.t('common.delete'),
      i18n.t('collections.shareAction'),
    ]) {
      expect(hasLabel(top, label)).toBe(false);
    }
    // Their own bell in the header; the ⋯ holds only copying into their own Collection.
    expect(headerButtonIds(top)).toContain('collection-details-notifications');
    expect(await recipientMenuLabels(renderer)).toEqual([i18n.t('collections.copyToMine')]);
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
    expect(mockNavigate).toHaveBeenLastCalledWith('CollectionSharedItem', { collectionId: COLLECTION_ID, itemId: 2 });

    pressRow(mine);
    // Opened from the Collection, but a Contributor may not take links out of it.
    expect(mockNavigate).toHaveBeenLastCalledWith('ItemDetails', { itemId: 1, collectionContext: { collectionId: COLLECTION_ID, canRemove: false } });
  });

  it('never offers removing a link from the Category, nor the Add/Move menu', async () => {
    const renderer = await renderScreen();

    for (const item of [mine, theirs]) {
      const itemRow = row(renderer, item);
      const actionNames = itemRow.root
        .findAll(node => Array.isArray(node.props.accessibilityActions))[0]
        .props.accessibilityActions.map((action: { name: string }) => action.name);
      expect(actionNames).not.toContain('delete');
      expect(hasLabel(itemRow, i18n.t('collections.itemManageAction'))).toBe(false);
    }
  });
});

describe('CollectionDetailsScreen - Owner viewing a Contributor\'s link', () => {
  beforeEach(() => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: true }));
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [mine, theirs], nextCursor: null });
  });

  afterEach(() => jest.clearAllMocks());

  it('can remove the association, but gets no Add/Move menu for an Item that is not theirs', async () => {
    const renderer = await renderScreen();
    const theirRow = row(renderer, theirs);

    const actionNames = theirRow.root
      .findAll(node => Array.isArray(node.props.accessibilityActions))[0]
      .props.accessibilityActions.map((action: { name: string }) => action.name);
    expect(actionNames).toContain('delete');
    expect(hasLabel(theirRow, i18n.t('collections.itemManageAction'))).toBe(false);
    expect(hasLabel(row(renderer, mine), i18n.t('collections.itemManageAction'))).toBe(true);
  });
});

describe('CollectionDetailsScreen - who added each link', () => {
  const addedByTexts = (part: ReactTestRenderer.ReactTestRenderer) =>
    part.root
      .findAll(node => typeof node.type === 'string' && node.props.testID === 'saved-link-added-by')
      .flatMap(node => node.findAllByType(Text).map(text => text.props.children));

  afterEach(() => jest.clearAllMocks());

  it('in a shared Collection every link says who added it: 나, the Owner, or another member', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N' }));
    const ownersLink = makeItem({ itemId: 2, title: 'Theirs', isMine: false, addedBy: { kind: 'owner', jupleId: 'K7MP4Q8N', displayName: '피카츄' } });
    const membersLink = makeItem({ itemId: 3, title: 'Member', isMine: false, addedBy: { kind: 'member', jupleId: 'CNTRC234', displayName: null } });
    const myLink = makeItem({ itemId: 1, title: 'Mine', isMine: true, addedBy: { kind: 'me' } });
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [myLink, ownersLink, membersLink], nextCursor: null });
    const renderer = await renderScreen();

    expect(addedByTexts(row(renderer, myLink))).toEqual([i18n.t('collections.addedByMe')]);
    expect(addedByTexts(row(renderer, ownersLink))).toEqual([i18n.t('collections.addedByOwner', { name: '피카츄' })]);
    expect(addedByTexts(row(renderer, membersLink))).toEqual(['CNTR-C234']);
    expect(i18n.getFixedT('ko')('collections.addedByOwner', { name: '피카츄' })).toBe('피카츄 · 소유자');
  });

  it('a link that came in through the 모든 사용자 link says only that - never who', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: false }));
    const publicLink = makeItem({ itemId: 2, title: 'Via link', isMine: false, addedBy: { kind: 'publicLink' } });
    const myLink = makeItem({ itemId: 1, title: 'Mine', isMine: true, addedBy: { kind: 'me' } });
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [myLink, publicLink], nextCursor: null });
    const renderer = await renderScreen();

    expect(addedByTexts(row(renderer, publicLink))).toEqual([i18n.t('collections.addedViaPublicLink')]);
    expect(addedByTexts(row(renderer, myLink))).toEqual([i18n.t('collections.addedByMe')]);
  });

  it('a private Collection stays as quiet as before - no "added by" line at all', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({ accessRole: 'owner', hasCollaborators: false }));
    const myLink = makeItem({ itemId: 1, title: 'Mine', isMine: true, addedBy: { kind: 'me' } });
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [myLink], nextCursor: null });
    const renderer = await renderScreen();

    expect(addedByTexts(row(renderer, myLink))).toEqual([]);
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

describe('CollectionDetailsScreen - participant management on a locked Collection (Owner)', () => {
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
      isLocked: true,
      hasCollaborators: true,
      participantPreview: [{ jupleId: 'CNTRB234', displayName: '파이리', role: 'contributor' }],
      otherParticipantCount: 1,
    }));
    jest.mocked(getCollectionItems).mockRejectedValue(lockedError);
    jest.mocked(getCollectionParticipants).mockResolvedValue(ownerView as never);
    jest.mocked(unlockCollection).mockResolvedValue({ unlockToken: 'grant-5', expiresAtUtc: new Date(Date.now() + 15 * 60_000).toISOString() });
  });

  afterEach(() => {
    jest.clearAllMocks();
    clearCollectionUnlockGrants();
  });

  async function openSheet() {
    const renderer = await renderScreen();
    const top = header(renderer);
    await act(async () => {
      top.root.findByProps({ testID: 'collection-details-participants' }).props.onPress();
    });
    return renderer;
  }

  async function confirmRemoval(renderer: ReactTestRenderer.ReactTestRenderer) {
    await act(async () => {
      renderer.root.findByProps({ testID: 'participants-sheet-remove-CNTRB234' }).props.onPress();
    });
    const dialog = renderer.root.findAllByType(ConfirmDialog).find(node => node.props.title === i18n.t('collaboration.removeConfirmTitle'))!;
    await act(async () => {
      dialog.props.onConfirm();
    });
  }

  async function unlockWith(renderer: ReactTestRenderer.ReactTestRenderer, password: string) {
    const gate = () => renderer.root.findByProps({ testID: 'collection-details-unlock-gate' });
    await act(async () => {
      gate().findByProps({ testID: 'collection-unlock-password' }).props.onChangeText(password);
    });
    await act(async () => {
      await gate().findByProps({ testID: 'collection-unlock-submit' }).props.onPress();
    });
  }

  const sheetVisible = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root.findByType(CollectionParticipantsSheet).props.visible;

  it('the list itself opens without unlocking', async () => {
    const renderer = await openSheet();

    expect(sheetVisible(renderer)).toBe(true);
    expect(renderer.root.findByProps({ testID: 'participants-sheet-CNTRB234' })).toBeTruthy();
    expect(unlockCollection).not.toHaveBeenCalled();
  });

  it('removing a collaborator asks for the password, then removes them and refreshes the list', async () => {
    const renderer = await openSheet();
    await confirmRemoval(renderer);

    expect(removeCollaborator).not.toHaveBeenCalled();
    expect(sheetVisible(renderer)).toBe(false); // stepped aside for the password prompt

    await unlockWith(renderer, 'correct horse');

    expect(removeCollaborator).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, 'CNTRB234');
    expect(sheetVisible(renderer)).toBe(true);
    expect(jest.mocked(getCollectionParticipants).mock.calls.length).toBeGreaterThanOrEqual(3); // reloaded after the change
  });

  it('cancelling a pending invitation asks for the password, then revokes it', async () => {
    const renderer = await openSheet();
    await act(async () => {
      renderer.root.findByProps({ testID: 'participants-sheet-revoke-9' }).props.onPress();
    });

    expect(revokeCollectionInvitation).not.toHaveBeenCalled();
    await unlockWith(renderer, 'correct horse');

    expect(revokeCollectionInvitation).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, 9);
  });

  it('a wrong password never runs the action', async () => {
    jest.mocked(unlockCollection).mockRejectedValue(new ApiError('forbidden', 403, 'invalidCollectionPassword'));
    const renderer = await openSheet();
    await confirmRemoval(renderer);

    await unlockWith(renderer, 'wrong-guess');

    expect(removeCollaborator).not.toHaveBeenCalled();
    expect(renderer.root.findAll(node => node.props.testID === 'collection-details-unlock-gate').length).toBeGreaterThan(0);
  });

  it('cancelling the password prompt never runs the action, and brings the list back', async () => {
    const renderer = await openSheet();
    await act(async () => {
      renderer.root.findByProps({ testID: 'participants-sheet-revoke-9' }).props.onPress();
    });

    const cancel = renderer.root.findByProps({ testID: 'collection-details-unlock-gate' })
      .findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function')
      .find(node => node.findAllByType(Text).some(text => text.props.children === i18n.t('common.cancel')))!;
    await act(async () => {
      cancel.props.onPress();
    });

    expect(revokeCollectionInvitation).not.toHaveBeenCalled();
    expect(sheetVisible(renderer)).toBe(true);
  });

  it('with a grant from this session, the action runs at once without asking', async () => {
    rememberCollectionUnlock(COLLECTION_ID, 'grant-6', new Date(Date.now() + 10 * 60_000).toISOString());
    jest.mocked(getCollectionItems).mockResolvedValue({ items: [], nextCursor: null });
    const renderer = await openSheet();

    await act(async () => {
      renderer.root.findByProps({ testID: 'participants-sheet-revoke-9' }).props.onPress();
    });

    expect(revokeCollectionInvitation).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, 9);
    expect(unlockCollection).not.toHaveBeenCalled();
    expect(renderer.root.findAll(node => node.props.testID === 'collection-details-unlock-gate')).toHaveLength(0);
  });

  it('a Contributor gets the same list with no management controls at all', async () => {
    jest.mocked(getCollection).mockResolvedValue(makeCollection({
      accessRole: 'contributor',
      isLocked: true,
      ownerJupleId: 'WNER2345',
      participantPreview: [{ jupleId: 'WNER2345', displayName: '피카츄', role: 'owner' }],
      otherParticipantCount: 1,
    }));
    jest.mocked(getCollectionParticipants).mockResolvedValue({ ...ownerView, pendingInvitations: [], canManage: false } as never);
    const renderer = await openSheet();

    expect(renderer.root.findByProps({ testID: 'participants-sheet-CNTRB234' })).toBeTruthy();
    expect(renderer.root.findAll(node => String(node.props.testID).startsWith('participants-sheet-remove-'))).toHaveLength(0);
    expect(renderer.root.findAll(node => String(node.props.testID).startsWith('participants-sheet-revoke-'))).toHaveLength(0);
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
