import ReactTestRenderer, { act } from 'react-test-renderer';
import i18n from '../../i18n';
import { CollectionsScreen } from '../CollectionsScreen';
import { ActionMenuDialog } from '../../components/ActionMenuDialog';
import { ViewModeToggle } from '../../components/ViewModeToggle';
import {
  getCollectionNotificationPreference,
  getCollections,
  getMyPendingSubmissionTotal,
  setCollectionFavorite,
  setCollectionNotificationPreference,
  type Collection,
} from '../../collections/api/collectionsApi';
import NativeIncomingShare, { type PinnedCollectionShortcut } from '../../share/specs/NativeIncomingShare';

const mockNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate, setParams: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: undefined }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
}));
jest.mock('@react-navigation/bottom-tabs', () => ({ useBottomTabBarHeight: () => 80 }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../collections/api/collectionsApi');
jest.mock('../../collections/api/collaborationApi', () => ({
  ...jest.requireActual('../../collections/api/collaborationApi'),
  getReceivedCollectionInvitations: jest.fn().mockResolvedValue([]),
}));

// The device's pinned set, in memory - so pinning / unpinning really goes through CollectionShortcutService.
let stored: PinnedCollectionShortcut[] = [];
let maxShortcuts = 4;
jest.mock('../../share/specs/NativeIncomingShare', () => ({
  __esModule: true,
  default: {
    getPinnedCollectionShortcuts: jest.fn(),
    setPinnedCollectionShortcuts: jest.fn(),
    getMaxPinnedCollectionShortcuts: jest.fn(),
    clearPinnedCollectionShortcuts: jest.fn(),
    isHomeShortcutSupported: jest.fn(),
    requestHomeShortcut: jest.fn(),
  },
}));
const native = NativeIncomingShare!;

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

const collection = (overrides: Partial<Collection>): Collection => ({
  id: 1,
  name: 'Collection',
  isFavorite: false,
  itemCount: 0,
  createdAtUtc: '2026-01-01T00:00:00Z',
  updatedAtUtc: '2026-01-01T00:00:00Z',
  icon: 'Folder',
  color: null,
  ...overrides,
});

type Renderer = ReactTestRenderer.ReactTestRenderer;
const mounted: Renderer[] = [];

/** The id and name of each stored entry - the visual fields have their own tests. */
const idName = (entries: readonly { id: number; name: string }[]) => entries.map(({ id, name }) => ({ id, name }));

beforeEach(() => {
  stored = [];
  maxShortcuts = 4;
  jest.clearAllMocks();
  jest.mocked(getMyPendingSubmissionTotal).mockResolvedValue(0);
  jest.mocked(getCollectionNotificationPreference).mockResolvedValue({ newItemNotificationsEnabled: true });
  jest.mocked(setCollectionNotificationPreference).mockResolvedValue(undefined as never);
  jest.mocked(native.getPinnedCollectionShortcuts).mockImplementation(async () => stored);
  jest.mocked(native.setPinnedCollectionShortcuts).mockImplementation(async json => { stored = JSON.parse(json); });
  jest.mocked(native.getMaxPinnedCollectionShortcuts).mockImplementation(async () => maxShortcuts);
  jest.mocked(native.isHomeShortcutSupported).mockResolvedValue(true);
  jest.mocked(native.requestHomeShortcut).mockResolvedValue('requested');
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(renderer => renderer.unmount());
  });
});

async function renderWith(items: readonly Collection[], mode: 'grid' | 'list' = 'grid') {
  jest.mocked(getCollections).mockResolvedValue({ items, nextCursor: null });
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<CollectionsScreen />);
  });
  mounted.push(renderer);
  if (mode === 'list') {
    await act(async () => renderer.root.findByType(ViewModeToggle).props.onChange('list'));
  }
  return renderer;
}

/** The card (grid tile or list row) showing this Collection name - found by its text, since a plain shared card has no custom spoken label. */
const cardFor = (renderer: Renderer, name: string) =>
  renderer.root.findAll(node =>
    typeof node.props.onLongPress === 'function'
    && Array.isArray(node.props.accessibilityActions)
    && node.findAll(inner => typeof inner.type === 'function' && inner.props.children === name).length > 0)[0];

async function longPress(renderer: Renderer, name: string) {
  await act(async () => cardFor(renderer, name).props.onLongPress());
}

const menu = (renderer: Renderer) => renderer.root.findAllByType(ActionMenuDialog)[0];
const labels = (renderer: Renderer) => (menu(renderer).props.actions as { label: string }[]).map(action => action.label);
const messageOf = (renderer: Renderer) =>
  renderer.root.findAll(node => typeof node.props.onConfirm === 'function' && node.props.visible === true && node.props.title === i18n.t('common.notice'))[0]?.props.message;
async function press(renderer: Renderer, label: string) {
  const action = (menu(renderer).props.actions as { label: string; onPress: () => void }[]).find(candidate => candidate.label === label);
  await act(async () => action!.onPress());
}

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

describe('Collection card long-press menu', () => {
  it('Owner of a private Collection: favorite, 수정, 잠금 설정, 앱 바로가기, then 삭제 last (destructive) - and no 나가기', async () => {
    const renderer = await renderWith([collection({ id: 1, name: 'Mine', accessRole: 'owner', isFavorite: true })]);

    await longPress(renderer, 'Mine');

    expect(labels(renderer)).toEqual([
      t('collections.removeFavorite'),
      t('common.edit'),
      t('collections.lockSetTitle'),
      t('collections.homeShortcutAdd'),
      t('collections.delete'),
    ]);
    const actions = menu(renderer).props.actions as { destructive?: boolean; icon?: unknown }[];
    expect(actions.map(action => action.destructive === true)).toEqual([false, false, false, false, true]);
    expect(actions.every(action => action.icon !== undefined)).toBe(true);
    expect(labels(renderer)).not.toContain(t('collections.leaveAction'));
    expect(getCollectionNotificationPreference).not.toHaveBeenCalled();
  });

  it('Owner of a shared Collection also gets the 새 링크 알림 row once the current setting is known', async () => {
    const renderer = await renderWith([collection({ id: 1, name: 'Team', accessRole: 'owner', hasCollaborators: true })]);

    await longPress(renderer, 'Team');

    expect(getCollectionNotificationPreference).toHaveBeenCalledWith(expect.anything(), 1);
    expect(labels(renderer)).toEqual([
      t('collections.addFavorite'),
      t('collections.newLinkNotificationsTurnOff'),
      t('common.edit'),
      t('collections.lockSetTitle'),
      t('collections.homeShortcutAdd'),
      t('collections.delete'),
    ]);
  });

  it('a locked Collection offers 잠금 해제하기 instead of 잠금 설정', async () => {
    const renderer = await renderWith([collection({ id: 1, name: 'Secret', accessRole: 'owner', isLocked: true })]);

    await longPress(renderer, 'Secret');

    expect(labels(renderer)).toContain(t('collections.lockRemoveAction'));
    expect(labels(renderer)).not.toContain(t('collections.lockSetTitle'));
  });

  it('a Contributor: favorite, 알림, 앱 바로가기, then 나가기 last - never edit, lock or delete', async () => {
    const renderer = await renderWith([collection({ id: 2, name: 'Shared', accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N' })]);

    await longPress(renderer, 'Shared');

    expect(labels(renderer)).toEqual([
      t('collections.addFavorite'),
      t('collections.newLinkNotificationsTurnOff'),
      t('collections.homeShortcutAdd'),
      t('collections.leaveAction'),
    ]);
    expect((menu(renderer).props.actions as { destructive?: boolean }[]).at(-1)!.destructive).toBe(true);
  });

  it('a Viewer can have a Home icon (it only opens the Collection) and can still leave', async () => {
    const renderer = await renderWith([collection({ id: 3, name: 'ReadOnly', accessRole: 'viewer', ownerJupleId: 'K7MP4Q8N' })]);

    await longPress(renderer, 'ReadOnly');

    expect(labels(renderer)).toContain(t('collections.homeShortcutAdd'));
    expect(labels(renderer)).toContain(t('collections.leaveAction'));
    expect(labels(renderer)).not.toContain(t('collections.shortcutRemove'));
  });

  it('no Home-shortcut row where the launcher cannot pin', async () => {
    jest.mocked(native.isHomeShortcutSupported).mockResolvedValue(false);
    const renderer = await renderWith([collection({ id: 1, name: 'Mine', accessRole: 'owner' })]);

    await longPress(renderer, 'Mine');

    expect(labels(renderer)).not.toContain(t('collections.homeShortcutAdd'));
  });

  it('the notification row is left out (never guessed) when the current setting cannot be read', async () => {
    jest.mocked(getCollectionNotificationPreference).mockRejectedValue(new Error('offline'));
    const renderer = await renderWith([collection({ id: 2, name: 'Shared', accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N' })]);

    await longPress(renderer, 'Shared');

    expect(labels(renderer)).not.toContain(t('collections.newLinkNotificationsTurnOff'));
    expect(labels(renderer)).not.toContain(t('collections.newLinkNotificationsTurnOn'));
  });

  it('List mode has the same long-press and the same menu', async () => {
    const renderer = await renderWith([collection({ id: 1, name: 'Mine', accessRole: 'owner' })], 'list');

    await longPress(renderer, 'Mine');

    expect(labels(renderer)).toEqual([
      t('collections.addFavorite'),
      t('common.edit'),
      t('collections.lockSetTitle'),
      t('collections.homeShortcutAdd'),
      t('collections.delete'),
    ]);
  });

  it('a tap still just opens the Collection, and the menu is also a screen-reader action', async () => {
    const renderer = await renderWith([collection({ id: 1, name: 'Mine', accessRole: 'owner' })]);

    await act(async () => cardFor(renderer, 'Mine').props.onPress());

    expect(mockNavigate).toHaveBeenCalledWith('CollectionDetails', { collectionId: 1 });
    expect(cardFor(renderer, 'Mine').props.accessibilityActions).toEqual([{ name: 'options', label: t('collections.collectionActionsA11y') }]);
    await act(async () => cardFor(renderer, 'Mine').props.onAccessibilityAction({ nativeEvent: { actionName: 'options' } }));
    expect(menu(renderer)).toBeDefined();
  });

  describe('each row reuses what already exists', () => {
    it('favorite uses the list\'s own favorite call', async () => {
      jest.mocked(setCollectionFavorite).mockResolvedValue(collection({ id: 1, name: 'Mine', accessRole: 'owner', isFavorite: true }));
      const renderer = await renderWith([collection({ id: 1, name: 'Mine', accessRole: 'owner' })]);
      await longPress(renderer, 'Mine');

      await press(renderer, t('collections.addFavorite'));

      expect(setCollectionFavorite).toHaveBeenCalledWith(expect.anything(), 1, true);
    });

    it('notifications use the saved preference model - nothing new', async () => {
      const renderer = await renderWith([collection({ id: 2, name: 'Shared', accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N' })]);
      await longPress(renderer, 'Shared');

      await press(renderer, t('collections.newLinkNotificationsTurnOff'));

      expect(setCollectionNotificationPreference).toHaveBeenCalledWith(expect.anything(), 2, false);
    });

    it.each([
      ['common.edit', 'edit'],
      ['collections.lockSetTitle', 'lock'],
      ['collections.delete', 'delete'],
    ])('%s opens the Collection\'s own screen with that dialog (%s)', async (labelKey, pendingAction) => {
      const renderer = await renderWith([collection({ id: 1, name: 'Mine', accessRole: 'owner' })]);
      await longPress(renderer, 'Mine');

      await press(renderer, t(labelKey));

      expect(mockNavigate).toHaveBeenCalledWith('CollectionDetails', { collectionId: 1, pendingAction });
    });

    it('a member\'s 나가기 opens the Collection\'s own leave confirmation', async () => {
      const renderer = await renderWith([collection({ id: 2, name: 'Shared', accessRole: 'contributor', ownerJupleId: 'K7MP4Q8N' })]);
      await longPress(renderer, 'Shared');

      await press(renderer, t('collections.leaveAction'));

      expect(mockNavigate).toHaveBeenCalledWith('CollectionDetails', { collectionId: 2, pendingAction: 'leave' });
    });
  });

  describe('홈 화면에 바로가기 추가', () => {
    it('asks the launcher for the real icon of the chosen Collection only - and does not mark it as a share target itself', async () => {
      const renderer = await renderWith([
        collection({ id: 1, name: 'Mine', accessRole: 'owner', color: 'Mint' }),
        collection({ id: 5, name: 'Other', accessRole: 'owner' }),
      ]);
      await longPress(renderer, 'Mine');

      await press(renderer, t('collections.homeShortcutAdd'));

      expect(native.requestHomeShortcut).toHaveBeenCalledTimes(1);
      expect(native.requestHomeShortcut).toHaveBeenCalledWith(1, 'Mine', 'Folder', '#EAF5EE', '#5C9878', '', '', true);
      // Only the launcher's confirmation (native) may add it to the share targets: a cancelled dialog leaves nothing.
      expect(stored).toEqual([]);
      await longPress(renderer, 'Mine');
      expect(labels(renderer)).not.toContain(t('collections.shortcutRemove'));
    });

    it('once the launcher confirmed (the share target exists), the menu offers taking it out of the share targets - and no row pretends to remove the Home icon', async () => {
      stored = [{ id: 1, name: 'Mine' }];
      const renderer = await renderWith([collection({ id: 1, name: 'Mine', accessRole: 'owner' })]);
      await longPress(renderer, 'Mine');

      expect(labels(renderer)).toContain(t('collections.shortcutRemove'));
      await press(renderer, t('collections.shortcutRemove'));

      expect(stored).toEqual([]);
    });

    it('at the platform limit a normal message explains it - and nothing already chosen is dropped', async () => {
      maxShortcuts = 1;
      stored = [{ id: 9, name: 'Already chosen' }];
      const renderer = await renderWith([collection({ id: 1, name: 'Mine', accessRole: 'owner' }), collection({ id: 9, name: 'Already chosen', accessRole: 'owner' })]);
      await longPress(renderer, 'Mine');

      await press(renderer, t('collections.homeShortcutAdd'));

      expect(messageOf(renderer)).toBe(t('collections.shortcutLimitReached', { count: 1 }));
      expect(native.requestHomeShortcut).not.toHaveBeenCalled();
      expect(idName(stored)).toEqual([{ id: 9, name: 'Already chosen' }]);
    });

    it('a locked Collection may get its icon but is told it is not a share target (opening it still asks for the password)', async () => {
      const renderer = await renderWith([collection({ id: 1, name: 'Secret', accessRole: 'owner', isLocked: true })]);
      await longPress(renderer, 'Secret');

      await press(renderer, t('collections.homeShortcutAdd'));

      expect(native.requestHomeShortcut).toHaveBeenCalledWith(1, 'Secret', 'Folder', expect.any(String), expect.any(String), '', '', false);
      expect(messageOf(renderer)).toBe(t('collections.homeShortcutLocked'));
      expect(stored).toEqual([]);
    });

    it('a launcher that refuses the request says so in a Juple message', async () => {
      jest.mocked(native.requestHomeShortcut).mockResolvedValue('unsupported');
      const renderer = await renderWith([collection({ id: 1, name: 'Mine', accessRole: 'owner' })]);
      await longPress(renderer, 'Mine');

      await press(renderer, t('collections.homeShortcutAdd'));

      expect(messageOf(renderer)).toBe(t('collections.homeShortcutUnsupported'));
    });

    it('the list screen itself brings the label of a share target up to date from the cards it just loaded', async () => {
      stored = [{ id: 1, name: 'Old name' }];

      await renderWith([collection({ id: 1, name: 'Renamed', accessRole: 'owner' })]);

      expect(idName(stored)).toEqual([{ id: 1, name: 'Renamed' }]);
    });

    it('and drops one that has become locked since', async () => {
      stored = [{ id: 1, name: 'Mine' }];

      await renderWith([collection({ id: 1, name: 'Mine', accessRole: 'owner', isLocked: true })]);

      expect(stored).toEqual([]);
    });
  });
});
