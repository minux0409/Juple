import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { AppToastProvider } from '../../components/AppToast';
import { SelectionBarProvider, useSelectionBarModel, type SelectionBarModel } from '../../selection/SelectionBarContext';
import {
  deleteCollection,
  getCollectionNotificationPreference,
  setCollectionFavorite,
  setCollectionLock,
  setMemberCollectionLock,
  type Collection,
} from '../api/collectionsApi';
import { leaveCollection } from '../api/collaborationApi';
import { collectionShortcutService } from '../../shortcuts/CollectionShortcutService';
import { useCollectionSelection } from '../useCollectionSelection';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
}));
jest.mock('../api/collectionsApi', () => ({
  ...jest.requireActual('../api/collectionsApi'),
  deleteCollection: jest.fn(),
  restoreCollection: jest.fn(),
  getCollectionNotificationPreference: jest.fn(),
  setCollectionNotificationPreference: jest.fn(),
  setCollectionFavorite: jest.fn(),
  setCollectionLock: jest.fn(),
  setMemberCollectionLock: jest.fn(),
}));
jest.mock('../api/collaborationApi', () => ({
  ...jest.requireActual('../api/collaborationApi'),
  leaveCollection: jest.fn(),
}));
jest.mock('../../shortcuts/CollectionShortcutService', () => ({
  collectionShortcutService: {
    isSupported: jest.fn(() => true),
    isHomeShortcutSupported: jest.fn(async () => true),
    getPinnedCollectionIds: jest.fn(async () => new Set<number>()),
    requestHomeShortcut: jest.fn(),
    unpin: jest.fn(async () => undefined),
    applyKnownCollections: jest.fn(async () => undefined),
  },
}));

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Hook = ReturnType<typeof useCollectionSelection>;

const owned = (id: number, overrides: Partial<Collection> = {}): Collection => ({
  id,
  name: `Mine ${id}`,
  isFavorite: false,
  itemCount: 0,
  createdAtUtc: '2026-01-01T00:00:00Z',
  updatedAtUtc: '2026-01-01T00:00:00Z',
  icon: 'Folder',
  color: null,
  accessRole: 'owner',
  ...overrides,
});
const shared = (id: number, overrides: Partial<Collection> = {}) => owned(id, { name: `Theirs ${id}`, accessRole: 'contributor', hasCollaborators: true, ...overrides });

let barModel: SelectionBarModel | null = null;
function BarProbe() {
  barModel = useSelectionBarModel();
  return null;
}
function Harness({ options, onHook }: { readonly options: Parameters<typeof useCollectionSelection>[0]; readonly onHook: (hook: Hook) => void }) {
  const hook = useCollectionSelection(options);
  onHook(hook);
  return <Text>{hook.topBar}{hook.element}</Text>;
}

const mounted: Renderer[] = [];
afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach(renderer => renderer.unmount());
  });
  jest.clearAllMocks();
  barModel = null;
});

async function mount(collections: readonly Collection[]) {
  const onManage = jest.fn();
  const onChanged = jest.fn();
  const onCollectionUpdated = jest.fn();
  let hook!: Hook;
  let renderer!: Renderer;
  jest.mocked(getCollectionNotificationPreference).mockResolvedValue({ newItemNotificationsEnabled: true });
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <AppToastProvider><SelectionBarProvider>
        <Harness onHook={value => { hook = value; }} options={{ collections, onCollectionUpdated, onChanged, onManage }} />
        <BarProbe />
      </SelectionBarProvider></AppToastProvider>,
    );
  });
  mounted.push(renderer);
  return { renderer, hook: () => hook, onManage, onChanged, onCollectionUpdated };
}

const barKeys = () => (barModel?.actions ?? []).map(action => action.key);
const barLabel = (key: string) => barModel!.actions.find(action => action.key === key)!.label;
const pressBar = async (key: string) => { await act(async () => { barModel!.actions.find(action => action.key === key)!.onPress!(); }); };
const select = async (hook: () => Hook, collections: readonly Collection[]) => {
  await act(async () => hook().startSelection(collections[0]));
  for (const collection of collections.slice(1)) {
    await act(async () => hook().cardSelection(collection)!.onToggle());
  }
};
const dialog = (renderer: Renderer, title: string) => renderer.root.findAll(node => node.props.title === title && node.props.visible === true)[0];

describe('the Collections list selection bar', () => {
  it('long-press starts selection with that Collection chosen and the bar replaces the tab bar', async () => {
    const list = [owned(1), owned(2)];
    const { hook } = await mount(list);
    expect(barModel).toBeNull();
    await act(async () => hook().startSelection(list[0]));
    expect(hook().selection.isActive).toBe(true);
    expect(hook().cardSelection(list[0])!.selected).toBe(true);
    expect(hook().cardSelection(list[1])!.selected).toBe(false);
    expect(barKeys()).toEqual(['favorite', 'lock', 'shortcut', 'deleteOrLeave', 'more']);
  });

  it('several Collections: no 더보기 (rename, share and notifications belong to one Collection)', async () => {
    const list = [owned(1), owned(2)];
    const { hook } = await mount(list);
    await select(hook, list);
    expect(barKeys()).toEqual(['favorite', 'lock', 'deleteOrLeave']);
  });

  it('바로가기 is not drawn where the launcher cannot pin an icon', async () => {
    jest.mocked(collectionShortcutService.isHomeShortcutSupported).mockResolvedValue(false);
    const list = [owned(1)];
    const { hook } = await mount(list);
    await act(async () => hook().startSelection(list[0]));
    expect(barKeys()).not.toContain('shortcut');
    jest.mocked(collectionShortcutService.isHomeShortcutSupported).mockResolvedValue(true);
  });

  it('a tap while selecting only chooses; 전체 선택 / 전체 해제 / 종료', async () => {
    const list = [owned(1), owned(2), owned(3)];
    const { hook } = await mount(list);
    await act(async () => hook().startSelection(list[0]));
    await act(async () => hook().cardSelection(list[1])!.onToggle());
    expect(hook().selection.count).toBe(2);
  });
});

describe('즐겨찾기', () => {
  it('none favorite: adds all of them, one request each', async () => {
    jest.mocked(setCollectionFavorite).mockImplementation(async (_request, id, desired) => owned(id, { isFavorite: desired }));
    const list = [owned(1), owned(2)];
    const { hook, onCollectionUpdated } = await mount(list);
    await select(hook, list);
    expect(barLabel('favorite')).toBe('Add to favorites');
    await pressBar('favorite');
    expect(jest.mocked(setCollectionFavorite).mock.calls.map(call => [call[1], call[2]])).toEqual([[1, true], [2, true]]);
    expect(onCollectionUpdated).toHaveBeenCalledTimes(2);
    expect(barModel).toBeNull();
  });

  it('all favorite: removes all of them', async () => {
    jest.mocked(setCollectionFavorite).mockImplementation(async (_request, id, desired) => owned(id, { isFavorite: desired }));
    const list = [owned(1, { isFavorite: true }), owned(2, { isFavorite: true })];
    const { hook } = await mount(list);
    await select(hook, list);
    expect(barLabel('favorite')).toBe('Remove from favorites');
    await pressBar('favorite');
    expect(jest.mocked(setCollectionFavorite).mock.calls.map(call => call[2])).toEqual([false, false]);
  });

  it('a mix asks which direction; nothing changes until a direction is chosen, and cancelling changes nothing', async () => {
    jest.mocked(setCollectionFavorite).mockImplementation(async (_request, id, desired) => owned(id, { isFavorite: desired }));
    const list = [owned(1, { isFavorite: true }), owned(2)];
    const { renderer, hook } = await mount(list);
    await select(hook, list);
    await pressBar('favorite');

    const choice = dialog(renderer, 'Some are favorites, some are not');
    expect(choice.props.actions.map((action: { label: string }) => action.label)).toEqual(['Add all to favorites', 'Remove all from favorites']);
    expect(setCollectionFavorite).not.toHaveBeenCalled();
    await act(async () => choice.props.onCancel());
    expect(setCollectionFavorite).not.toHaveBeenCalled();

    await pressBar('favorite');
    const again = dialog(renderer, 'Some are favorites, some are not');
    await act(async () => again.props.actions[0].onPress());
    await act(async () => again.props.onDismiss?.());
    // Only the Collection that was not a favorite needed a request.
    expect(jest.mocked(setCollectionFavorite).mock.calls.map(call => [call[1], call[2]])).toEqual([[2, true]]);
  });

  it('a failure keeps the failed Collection selected for a retry and says it was partial', async () => {
    jest.mocked(setCollectionFavorite).mockImplementation(async (_request, id, desired) => {
      if (id === 2) {
        throw new ApiError('unavailable', 503);
      }
      return owned(id, { isFavorite: desired });
    });
    const list = [owned(1), owned(2)];
    const { renderer, hook } = await mount(list);
    await select(hook, list);
    await pressBar('favorite');
    expect([...hook().selection.selectedIds]).toEqual([2]);
    expect(renderer.root.findAll(node => typeof node.props.message === 'string' && String(node.props.message).includes('Updated 1 of 2')).length).toBeGreaterThan(0);
  });
});

describe('삭제 / 나가기 are never one action', () => {
  it('one Collection keeps its own screen flow (password prompt, confirmation, undo)', async () => {
    const list = [owned(1)];
    const { hook, onManage } = await mount(list);
    await act(async () => hook().startSelection(list[0]));
    await pressBar('deleteOrLeave');
    expect(onManage).toHaveBeenCalledWith(list[0], 'delete');
    expect(deleteCollection).not.toHaveBeenCalled();
  });

  it("someone else's single Collection is left, not deleted", async () => {
    const list = [shared(5)];
    const { hook, onManage } = await mount(list);
    await act(async () => hook().startSelection(list[0]));
    expect(barLabel('deleteOrLeave')).toBe('Leave collection');
    await pressBar('deleteOrLeave');
    expect(onManage).toHaveBeenCalledWith(list[0], 'leave');
  });

  it('several of my Collections: one confirmation naming the count, then one delete request each', async () => {
    jest.mocked(deleteCollection).mockResolvedValue(undefined);
    const list = [owned(1), owned(2, { hasCollaborators: true })];
    const { renderer, hook, onChanged } = await mount(list);
    await select(hook, list);
    await pressBar('deleteOrLeave');

    const confirm = dialog(renderer, 'Delete 2 collections?');
    expect(confirm.props.message).toContain("Deleting the collection won't delete the items inside it.");
    expect(confirm.props.message).toContain('1 of them are shared');
    expect(deleteCollection).not.toHaveBeenCalled();
    await act(async () => confirm.props.onCancel());
    expect(deleteCollection).not.toHaveBeenCalled();

    await pressBar('deleteOrLeave');
    await act(async () => dialog(renderer, 'Delete 2 collections?').props.onConfirm());
    expect(jest.mocked(deleteCollection).mock.calls.map(call => call[1]).sort()).toEqual([1, 2]);
    expect(leaveCollection).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
  });

  it('a locked Collection is never deleted from here (it needs its password in its own screen) and the user is told', async () => {
    jest.mocked(deleteCollection).mockResolvedValue(undefined);
    const list = [owned(1), owned(2, { isLocked: true })];
    const { renderer, hook } = await mount(list);
    await select(hook, list);
    await pressBar('deleteOrLeave');
    await act(async () => dialog(renderer, 'Delete 1 collections?').props.onConfirm());
    expect(jest.mocked(deleteCollection).mock.calls.map(call => call[1])).toEqual([1]);
    expect([...hook().selection.selectedIds]).toEqual([2]);
    expect(renderer.root.findAll(node => typeof node.props.message === 'string' && String(node.props.message).includes('locked collections are skipped')).length).toBeGreaterThan(0);
  });

  it('several of someone else\'s Collections are LEFT after their own confirmation - never deleted', async () => {
    jest.mocked(leaveCollection).mockResolvedValue(undefined);
    const list = [shared(5), shared(6)];
    const { renderer, hook } = await mount(list);
    await select(hook, list);
    expect(barLabel('deleteOrLeave')).toBe('Leave collection');
    await pressBar('deleteOrLeave');
    await act(async () => dialog(renderer, 'Leave 2 collections?').props.onConfirm());
    expect(jest.mocked(leaveCollection).mock.calls.map(call => call[1]).sort()).toEqual([5, 6]);
    expect(deleteCollection).not.toHaveBeenCalled();
  });

  it('a mix: the user first chooses, with each count spelled out, and each kind has its own confirmation', async () => {
    jest.mocked(deleteCollection).mockResolvedValue(undefined);
    jest.mocked(leaveCollection).mockResolvedValue(undefined);
    const list = [owned(1), owned(2), shared(5)];
    const { renderer, hook } = await mount(list);
    await select(hook, list);
    expect(barLabel('deleteOrLeave')).toBe('Delete / Leave');
    await pressBar('deleteOrLeave');

    const choice = dialog(renderer, 'Delete and leave are done separately');
    expect(choice.props.actions.map((action: { label: string }) => action.label)).toEqual(['Delete 2 collections', 'Leave 1 collections']);
    // Nothing runs from the choice itself.
    expect(deleteCollection).not.toHaveBeenCalled();
    expect(leaveCollection).not.toHaveBeenCalled();

    await act(async () => choice.props.actions[1].onPress());
    await act(async () => choice.props.onDismiss?.());
    await act(async () => dialog(renderer, 'Leave 1 collections?').props.onConfirm());
    expect(jest.mocked(leaveCollection).mock.calls.map(call => call[1])).toEqual([5]);
    expect(deleteCollection).not.toHaveBeenCalled();
  });

  it('a partial failure of a bulk delete keeps only the failed ones selected', async () => {
    jest.mocked(deleteCollection).mockImplementation(async (_request, id) => {
      if (id === 2) {
        throw new ApiError('forbidden', 403);
      }
    });
    const list = [owned(1), owned(2)];
    const { renderer, hook } = await mount(list);
    await select(hook, list);
    await pressBar('deleteOrLeave');
    await act(async () => dialog(renderer, 'Delete 2 collections?').props.onConfirm());
    expect([...hook().selection.selectedIds]).toEqual([2]);
  });
});

describe('잠금', () => {
  it('one Collection uses its own flow (set it, or take it off with the lock password)', async () => {
    const list = [owned(1, { isLocked: true })];
    const { hook, onManage } = await mount(list);
    await act(async () => hook().startSelection(list[0]));
    expect(barLabel('lock')).toBe('Remove lock');
    await pressBar('lock');
    expect(onManage).toHaveBeenCalledWith(list[0], 'lock');
    expect(setCollectionLock).not.toHaveBeenCalled();
  });

  it('several: locks only what is not locked yet - mine with the Collection lock, a member\'s with their personal lock - after a confirmation', async () => {
    jest.mocked(setCollectionLock).mockResolvedValue(undefined);
    jest.mocked(setMemberCollectionLock).mockResolvedValue(undefined);
    const list = [owned(1), owned(2, { isLocked: true }), shared(5)];
    const { renderer, hook } = await mount(list);
    await select(hook, list);
    expect(barLabel('lock')).toBe('Lock collection');
    await pressBar('lock');

    const confirm = dialog(renderer, 'Lock 2 collections?');
    expect(confirm.props.message).toContain('1 that are already locked or can\'t be locked are skipped');
    expect(setCollectionLock).not.toHaveBeenCalled();
    await act(async () => confirm.props.onConfirm());
    expect(jest.mocked(setCollectionLock).mock.calls.map(call => call[1])).toEqual([1]);
    expect(jest.mocked(setMemberCollectionLock).mock.calls.map(call => call[1])).toEqual([5]);
  });

  it('a missing lock password is reported plainly and the Collection stays selected', async () => {
    jest.mocked(setCollectionLock).mockRejectedValue(new ApiError('conflict', 409, 'collectionLockPasswordNotConfigured'));
    const list = [owned(1), owned(2)];
    const { renderer, hook } = await mount(list);
    await select(hook, list);
    await pressBar('lock');
    await act(async () => dialog(renderer, 'Lock 2 collections?').props.onConfirm());
    expect(hook().selection.count).toBe(2);
    expect(renderer.root.findAll(node => node.props.message === 'Set a lock password first.').length).toBeGreaterThan(0);
  });

  it('taking a lock off is never offered in bulk (it needs the password)', async () => {
    const list = [owned(1, { isLocked: true }), owned(2, { isLocked: true })];
    const { hook } = await mount(list);
    await select(hook, list);
    expect(barKeys()).not.toContain('lock');
  });
});

describe('바로가기', () => {
  it('one Collection asks the system dialog straight away', async () => {
    jest.mocked(collectionShortcutService.requestHomeShortcut).mockResolvedValue({ status: 'requested', shareable: true, lockedNotShared: false });
    const list = [owned(1)];
    const { hook } = await mount(list);
    await act(async () => hook().startSelection(list[0]));
    await pressBar('shortcut');
    expect(collectionShortcutService.requestHomeShortcut).toHaveBeenCalledTimes(1);
  });

  it('stops at the platform limit and says so', async () => {
    jest.mocked(collectionShortcutService.requestHomeShortcut).mockResolvedValueOnce({ status: 'limit', max: 4 });
    const list = [owned(1)];
    const { renderer, hook } = await mount(list);
    await act(async () => hook().startSelection(list[0]));
    await pressBar('shortcut');
    expect(collectionShortcutService.requestHomeShortcut).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAll(node => typeof node.props.message === 'string' && String(node.props.message).includes('up to 4 app shortcuts')).length).toBeGreaterThan(0);
  });
});

describe('더보기 (one Collection)', () => {
  it('offers 새 링크 알림, 공유 and 수정 for my shared Collection, and routes them to its own screen', async () => {
    const list = [owned(1, { hasCollaborators: true })];
    const { hook, onManage } = await mount(list);
    await act(async () => hook().startSelection(list[0]));
    const rows = barModel!.actions.find(action => action.key === 'more')!.menu!;
    expect(rows.map(row => row.key)).toEqual(['notify', 'share', 'edit']);
    await act(async () => rows[1].onPress());
    expect(onManage).toHaveBeenCalledWith(list[0], 'share');
  });

  it("a member has no 수정 but has 알림 and 공유", async () => {
    const list = [shared(5)];
    const { hook } = await mount(list);
    await act(async () => hook().startSelection(list[0]));
    expect(barModel!.actions.find(action => action.key === 'more')!.menu!.map(row => row.key)).toEqual(['notify', 'share']);
  });
});
