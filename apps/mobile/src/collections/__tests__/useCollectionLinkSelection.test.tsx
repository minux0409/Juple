import Clipboard from '@react-native-clipboard/clipboard';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Platform, Text } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { AppToastProvider } from '../../components/AppToast';
import { SelectionBarProvider, useSelectionBarModel, type SelectionBarModel } from '../../selection/SelectionBarContext';
import {
  addItemToCollection,
  addItemToCollections,
  copyCollectionItems,
  getCollections,
  removeItemFromCollection,
  transferCollectionItem,
  undoTransferCollectionItem,
  type Collection,
  type CollectionItemEntry,
} from '../api/collectionsApi';
import { submitReport } from '../../safety/safetyApi';
import { useCollectionLinkSelection } from '../useCollectionLinkSelection';

beforeAll(async () => {
  await i18n.changeLanguage('en');
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
  ...jest.requireActual('../../collections/api/collectionsApi'),
  addItemToCollection: jest.fn(),
  addItemToCollections: jest.fn(),
  copyCollectionItems: jest.fn(),
  getCollectionItems: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  getCollections: jest.fn(),
  removeItemFromCollection: jest.fn(),
  transferCollectionItem: jest.fn(),
  undoTransferCollectionItem: jest.fn(),
}));
jest.mock('../../safety/safetyApi', () => ({
  ...jest.requireActual('../../safety/safetyApi'),
  submitReport: jest.fn(),
}));
jest.mock('../../items/shareItem', () => ({ shareItem: jest.fn(), shareLinks: jest.fn().mockResolvedValue(undefined) }));

type Renderer = ReactTestRenderer.ReactTestRenderer;
type Hook = ReturnType<typeof useCollectionLinkSelection>;

const COLLECTION_ID = 1;
const destination = (id: number, overrides: Partial<Collection> = {}): Collection => ({
  id,
  name: `Dest ${id}`,
  isFavorite: false,
  itemCount: 0,
  createdAtUtc: '2026-01-01T00:00:00Z',
  updatedAtUtc: '2026-01-01T00:00:00Z',
  icon: 'Folder',
  color: null,
  accessRole: 'owner',
  ...overrides,
});
const entry = (itemId: number, isMine: boolean): CollectionItemEntry => ({
  itemId,
  url: `https://example.com/${itemId}`,
  title: `Link ${itemId}`,
  memo: null,
  addedAtUtc: '2026-01-01T00:00:00Z',
  sortOrder: 0,
  representativeImage: null,
  previewImageUrl: null,
  coverImage: null,
  isMine,
});

let barModel: SelectionBarModel | null = null;
function BarProbe() {
  barModel = useSelectionBarModel();
  return null;
}

interface HarnessProps {
  readonly options: Parameters<typeof useCollectionLinkSelection>[0];
  readonly onHook: (hook: Hook) => void;
}
function Harness({ options, onHook }: HarnessProps) {
  const hook = useCollectionLinkSelection(options);
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

interface Setup {
  readonly kind: 'personal' | 'ownedShared' | 'foreignShared';
  readonly links: readonly CollectionItemEntry[];
}

async function mount({ kind, links }: Setup, overrides: Partial<Parameters<typeof useCollectionLinkSelection>[0]> = {}) {
  const collection: Collection = destination(COLLECTION_ID, {
    name: 'Source',
    accessRole: kind === 'foreignShared' ? 'contributor' : 'owner',
    hasCollaborators: kind !== 'personal',
  });
  const onRemoved = jest.fn();
  const onChanged = jest.fn();
  const options: Parameters<typeof useCollectionLinkSelection>[0] = {
    collectionId: COLLECTION_ID,
    collection,
    isOwner: kind !== 'foreignShared',
    isContentLocked: false,
    reactionsEnabled: kind !== 'personal',
    loadedItems: links,
    onRemoved,
    onChanged,
    onOpenOriginal: jest.fn(),
    onEditOwn: jest.fn(),
    onSaveOther: jest.fn(),
    onReact: jest.fn(),
    onNotice: jest.fn(),
    ...overrides,
  };
  let hook!: Hook;
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <AppToastProvider><SelectionBarProvider><Harness onHook={value => { hook = value; }} options={options} /><BarProbe /></SelectionBarProvider></AppToastProvider>,
    );
  });
  mounted.push(renderer);
  return { renderer, hook: () => hook, onRemoved, onChanged, options };
}

const barKeys = () => (barModel?.actions ?? []).map(action => action.key);
const pressBar = async (key: string) => {
  await act(async () => { barModel!.actions.find(action => action.key === key)!.onPress!(); });
};
const select = async (hook: () => Hook, ...ids: number[]) => {
  await act(async () => hook().startSelection(entry(ids[0], true)));
  for (const id of ids.slice(1)) {
    await act(async () => hook().rowSelection(entry(id, true))!.onToggle());
  }
};
const byTestId = (renderer: Renderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];

describe('which actions each kind of Collection and selection offers', () => {
  it('a personal Collection: 삭제, 이동, 복사, 더보기', async () => {
    const { hook } = await mount({ kind: 'personal', links: [entry(1, true), entry(2, true)] });
    await select(hook, 1, 2);
    expect(barKeys()).toEqual(['delete', 'move', 'copy', 'more']);
  });

  it('a shared Collection I own: my links only', async () => {
    const { hook } = await mount({ kind: 'ownedShared', links: [entry(1, true), entry(2, true)] });
    await select(hook, 1, 2);
    expect(barKeys()).toEqual(['delete', 'move', 'copy', 'more']);
  });

  it('a shared Collection I own: mixed keeps 이동 (for my links) and has no 신고 button', async () => {
    const { hook } = await mount({ kind: 'ownedShared', links: [entry(1, true), entry(2, false)] });
    await select(hook, 1, 2);
    expect(barKeys()).toEqual(['delete', 'move', 'copy', 'more']);
    expect((barModel!.actions.find(action => action.key === 'more')!.menu ?? []).map(row => row.key)).toContain('reportOthers');
  });

  it("a shared Collection I own: other people's links only - no 이동, with 신고", async () => {
    const { hook } = await mount({ kind: 'ownedShared', links: [entry(2, false), entry(3, false)] });
    await select(hook, 2, 3);
    expect(barKeys()).toEqual(['delete', 'copy', 'report', 'more']);
  });

  it("someone else's Collection: my links only - 삭제, 복사 (이동 is kept behind 더보기)", async () => {
    const { hook } = await mount({ kind: 'foreignShared', links: [entry(1, true)] });
    await select(hook, 1);
    expect(barKeys()).toEqual(['delete', 'copy', 'more']);
    expect((barModel!.actions.find(action => action.key === 'more')!.menu ?? []).map(row => row.key)).toContain('move');
  });

  it("someone else's Collection: a mixed selection has no 삭제 and no 이동 on the bar", async () => {
    const { hook } = await mount({ kind: 'foreignShared', links: [entry(1, true), entry(2, false)] });
    await select(hook, 1, 2);
    expect(barKeys()).toEqual(['copy', 'more']);
  });

  it("someone else's Collection: other people's links only - 복사, 신고", async () => {
    const { hook } = await mount({ kind: 'foreignShared', links: [entry(2, false)] });
    await select(hook, 2);
    expect(barKeys()).toEqual(['copy', 'report', 'more']);
  });

  it('the bar follows the selection as it changes', async () => {
    const { hook } = await mount({ kind: 'foreignShared', links: [entry(1, true), entry(2, false)] });
    await select(hook, 1);
    expect(barKeys()).toContain('delete');
    await act(async () => hook().rowSelection(entry(2, false))!.onToggle());
    expect(barKeys()).not.toContain('delete');
    await act(async () => hook().rowSelection(entry(1, true))!.onToggle());
    expect(barKeys()).toEqual(['copy', 'report', 'more']);
  });

  it('nothing can be selected while the content is locked', async () => {
    const { hook } = await mount({ kind: 'personal', links: [entry(1, true)] }, { isContentLocked: true });
    await act(async () => hook().startSelection(entry(1, true)));
    expect(barModel).toBeNull();
  });
});

describe('삭제 = remove from THIS Collection', () => {
  const confirmDialog = (renderer: Renderer) =>
    renderer.root.findAll(node => typeof node.props.onConfirm === 'function' && node.props.confirmLabel === 'Delete' && node.props.visible === true)[0];

  it('the Owner may remove any link, including other people\'s; the message says so and the saved links are not deleted', async () => {
    jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
    const { renderer, hook, onRemoved } = await mount({ kind: 'ownedShared', links: [entry(1, true), entry(2, false)] });
    await select(hook, 1, 2);
    await pressBar('delete');

    const dialog = confirmDialog(renderer);
    expect(dialog.props.title).toBe('Remove 2 links from this collection?');
    expect(dialog.props.message).toContain("The link itself won't be deleted");
    expect(dialog.props.message).toContain('1 of them were added by others');
    await act(async () => dialog.props.onConfirm());

    expect(jest.mocked(removeItemFromCollection).mock.calls.map(call => call[2]).sort()).toEqual([1, 2]);
    expect(onRemoved).toHaveBeenCalledWith([1, 2]);
    expect(barModel).toBeNull();
  });

  it('cancelling (or touching outside) removes nothing', async () => {
    const { renderer, hook, onRemoved } = await mount({ kind: 'personal', links: [entry(1, true)] });
    await select(hook, 1);
    await pressBar('delete');
    await act(async () => confirmDialog(renderer).props.onCancel());
    expect(removeItemFromCollection).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
    expect(barModel).not.toBeNull();
  });

  it('a partial failure removes what it can, reports it as partial, and keeps only the failed link selected', async () => {
    jest.mocked(removeItemFromCollection).mockImplementation(async (_request, _collectionId, itemId) => {
      if (itemId === 2) {
        throw new ApiError('forbidden', 403);
      }
    });
    const { renderer, hook, onRemoved } = await mount({ kind: 'ownedShared', links: [entry(1, true), entry(2, true)] });
    await select(hook, 1, 2);
    await pressBar('delete');
    await act(async () => confirmDialog(renderer).props.onConfirm());

    expect(onRemoved).toHaveBeenCalledWith([1]);
    expect([...hook().selection.selectedIds]).toEqual([2]);
    const notice = renderer.root.findAll(node => typeof node.props.message === 'string' && String(node.props.message).includes('Removed 1 of 2 links'));
    expect(notice.length).toBeGreaterThan(0);
  });
});

describe('이동 moves only the links I added', () => {
  it('a mixed selection says how many will move and how many will not, then moves ONLY mine', async () => {
    jest.mocked(getCollections).mockResolvedValue({ items: [destination(10)], nextCursor: null });
    jest.mocked(transferCollectionItem).mockResolvedValue({ targetMembershipCreated: true });
    const { renderer, hook, onRemoved } = await mount({ kind: 'ownedShared', links: [entry(1, true), entry(2, false), entry(3, true)] }, {
      collection: destination(COLLECTION_ID, { name: 'Source', accessRole: 'owner', hasCollaborators: false }),
    });
    await select(hook, 1, 2, 3);
    await pressBar('move');

    const warning = renderer.root.findAll(node => node.props.title === 'Only your links will move' && node.props.visible === true)[0];
    expect(warning.props.message).toBe("2 links you added will be moved. 1 links added by others won't be moved or removed.");
    await act(async () => warning.props.onConfirm());

    await act(async () => byTestId(renderer, 'category-picker-option-10').props.onPress());
    await act(async () => byTestId(renderer, 'category-picker-submit').props.onPress());

    expect(jest.mocked(transferCollectionItem).mock.calls.map(call => call[2]).sort()).toEqual([1, 3]);
    expect(removeItemFromCollection).not.toHaveBeenCalled();
    expect(onRemoved).toHaveBeenCalledWith([1, 3]);
  });

  it('cancelling the mixed-move notice moves nothing', async () => {
    const { renderer, hook } = await mount({ kind: 'ownedShared', links: [entry(1, true), entry(2, false)] });
    await select(hook, 1, 2);
    await pressBar('move');
    const warning = renderer.root.findAll(node => node.props.title === 'Only your links will move' && node.props.visible === true)[0];
    await act(async () => warning.props.onCancel());
    expect(transferCollectionItem).not.toHaveBeenCalled();
    expect(addItemToCollection).not.toHaveBeenCalled();
  });

  it('in a Collection with members the move is add-to-destination first, then remove (never the atomic move)', async () => {
    jest.mocked(getCollections).mockResolvedValue({ items: [destination(10)], nextCursor: null });
    jest.mocked(addItemToCollection).mockResolvedValue('added');
    jest.mocked(removeItemFromCollection).mockResolvedValue(undefined);
    const { renderer, hook, onRemoved } = await mount({ kind: 'foreignShared', links: [entry(1, true)] });
    await select(hook, 1);
    await act(async () => barModel!.actions.find(action => action.key === 'more')!.menu!.find(row => row.key === 'move')!.onPress());
    await act(async () => byTestId(renderer, 'category-picker-option-10').props.onPress());
    await act(async () => byTestId(renderer, 'category-picker-submit').props.onPress());

    expect(transferCollectionItem).not.toHaveBeenCalled();
    expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), 10, 1, expect.anything());
    expect(removeItemFromCollection).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, 1);
    expect(onRemoved).toHaveBeenCalledWith([1]);
  });

  it('a link is never removed from here before it really joined the destination', async () => {
    jest.mocked(getCollections).mockResolvedValue({ items: [destination(10)], nextCursor: null });
    jest.mocked(addItemToCollection).mockResolvedValue('submitted');
    const { renderer, hook, onRemoved } = await mount({ kind: 'foreignShared', links: [entry(1, true)] });
    await select(hook, 1);
    await act(async () => barModel!.actions.find(action => action.key === 'more')!.menu!.find(row => row.key === 'move')!.onPress());
    await act(async () => byTestId(renderer, 'category-picker-option-10').props.onPress());
    await act(async () => byTestId(renderer, 'category-picker-submit').props.onPress());
    expect(removeItemFromCollection).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it('an atomic move offers the same undo as before', async () => {
    jest.mocked(getCollections).mockResolvedValue({ items: [destination(10)], nextCursor: null });
    jest.mocked(transferCollectionItem).mockResolvedValue({ targetMembershipCreated: true });
    const { renderer, hook } = await mount({ kind: 'personal', links: [entry(1, true)] }, {
      collection: destination(COLLECTION_ID, { name: 'Source', accessRole: 'owner', hasCollaborators: false }),
    });
    await select(hook, 1);
    await pressBar('move');
    await act(async () => byTestId(renderer, 'category-picker-option-10').props.onPress());
    await act(async () => byTestId(renderer, 'category-picker-submit').props.onPress());
    expect(transferCollectionItem).toHaveBeenCalledWith(expect.anything(), COLLECTION_ID, 1, 10, null);
    expect(undoTransferCollectionItem).not.toHaveBeenCalled();
  });
});

describe('복사', () => {
  it("my links join the chosen Collections as themselves; other people's links become my own new links - each through its own call", async () => {
    jest.mocked(getCollections).mockResolvedValue({ items: [destination(10), destination(11)], nextCursor: null });
    jest.mocked(addItemToCollections).mockResolvedValue({ addedCount: 2, skippedCount: 0 });
    jest.mocked(copyCollectionItems).mockResolvedValue({ copiedCount: 1, skippedCount: 0, unavailableCount: 0 });
    const { renderer, hook, onChanged } = await mount({ kind: 'ownedShared', links: [entry(1, true), entry(2, false)] });
    await select(hook, 1, 2);
    await pressBar('copy');
    await act(async () => byTestId(renderer, 'category-picker-option-10').props.onPress());
    await act(async () => byTestId(renderer, 'category-picker-option-11').props.onPress());
    await act(async () => byTestId(renderer, 'category-picker-submit').props.onPress());

    expect(addItemToCollections).toHaveBeenCalledTimes(1);
    expect(addItemToCollections).toHaveBeenCalledWith(expect.anything(), 1, [10, 11], {});
    // The Owner's copy of other people's links: one request per destination, carrying only THEIR ids (never mine - the server refuses that).
    expect(jest.mocked(copyCollectionItems).mock.calls.map(call => [call[1], call[2], call[3]])).toEqual([[COLLECTION_ID, [2], 10], [COLLECTION_ID, [2], 11]]);
    expect(onChanged).toHaveBeenCalled();
    expect(barModel).toBeNull();
  });

  it('the source keeps every link (nothing is removed by a copy)', async () => {
    jest.mocked(getCollections).mockResolvedValue({ items: [destination(10)], nextCursor: null });
    jest.mocked(addItemToCollections).mockResolvedValue({ addedCount: 1, skippedCount: 0 });
    const { renderer, hook, onRemoved } = await mount({ kind: 'personal', links: [entry(1, true)] });
    await select(hook, 1);
    await pressBar('copy');
    await act(async () => byTestId(renderer, 'category-picker-option-10').props.onPress());
    await act(async () => byTestId(renderer, 'category-picker-submit').props.onPress());
    expect(removeItemFromCollection).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it('a partial failure is reported as one and only the failed link stays selected', async () => {
    jest.mocked(getCollections).mockResolvedValue({ items: [destination(10)], nextCursor: null });
    jest.mocked(addItemToCollections).mockImplementation(async (_request, itemId) => {
      if (itemId === 2) {
        throw new ApiError('unavailable', 503);
      }
      return { addedCount: 1, skippedCount: 0 };
    });
    const { renderer, hook } = await mount({ kind: 'personal', links: [entry(1, true), entry(2, true)] });
    await select(hook, 1, 2);
    await pressBar('copy');
    await act(async () => byTestId(renderer, 'category-picker-option-10').props.onPress());
    await act(async () => byTestId(renderer, 'category-picker-submit').props.onPress());
    expect([...hook().selection.selectedIds]).toEqual([2]);
    expect(renderer.root.findAll(node => typeof node.props.message === 'string' && String(node.props.message).includes('Copied 1 of 2 links')).length).toBeGreaterThan(0);
  });

  it('everything failing keeps the picker open and the selection untouched', async () => {
    jest.mocked(getCollections).mockResolvedValue({ items: [destination(10)], nextCursor: null });
    jest.mocked(addItemToCollections).mockRejectedValue(new ApiError('unavailable', 503));
    const { renderer, hook } = await mount({ kind: 'personal', links: [entry(1, true)] });
    await select(hook, 1);
    await pressBar('copy');
    await act(async () => byTestId(renderer, 'category-picker-option-10').props.onPress());
    await act(async () => byTestId(renderer, 'category-picker-submit').props.onPress());
    expect([...hook().selection.selectedIds]).toEqual([1]);
    expect(byTestId(renderer, 'category-picker-submit')).toBeDefined();
  });
});

describe('신고: every selected link of another person is its OWN report', () => {
  async function openReport(links: CollectionItemEntry[], ids: number[], kind: Setup['kind'] = 'ownedShared') {
    const mountResult = await mount({ kind, links });
    await select(mountResult.hook, ...ids);
    await pressBar('report');
    return mountResult;
  }
  const reportButton = (renderer: Renderer) => byTestId(renderer, 'report-submit');

  it('one request per link with the same reason and words - never several links in one report', async () => {
    jest.mocked(submitReport).mockResolvedValue({ alreadyReported: false });
    const { renderer, hook, onRemoved } = await openReport([entry(2, false), entry(3, false)], [2, 3]);

    await act(async () => byTestId(renderer, 'report-reason-Spam').props.onPress());
    await act(async () => reportButton(renderer).props.onPress());

    expect(submitReport).toHaveBeenCalledTimes(2);
    const targets = jest.mocked(submitReport).mock.calls.map(call => call[1]);
    expect(targets).toEqual([
      { type: 'Item', itemId: 2, collectionId: COLLECTION_ID },
      { type: 'Item', itemId: 3, collectionId: COLLECTION_ID },
    ]);
    expect(jest.mocked(submitReport).mock.calls.every(call => call[2] === 'Spam')).toBe(true);
    // Reporting never deletes the link or removes anyone.
    expect(removeItemFromCollection).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
    expect(hook().selection.isActive).toBe(false);
  });

  it('a mixed selection reports only the other people\'s links (from 더보기)', async () => {
    jest.mocked(submitReport).mockResolvedValue({ alreadyReported: false });
    const { renderer, hook } = await mount({ kind: 'ownedShared', links: [entry(1, true), entry(2, false)] });
    await select(hook, 1, 2);
    await act(async () => barModel!.actions.find(action => action.key === 'more')!.menu!.find(row => row.key === 'reportOthers')!.onPress());
    await act(async () => byTestId(renderer, 'report-reason-Harassment').props.onPress());
    await act(async () => reportButton(renderer).props.onPress());
    expect(jest.mocked(submitReport).mock.calls.map(call => call[1])).toEqual([{ type: 'Item', itemId: 2, collectionId: COLLECTION_ID }]);
  });

  it('each link\'s own result is kept apart: received, already reported and failed are told apart; the failed one stays selected', async () => {
    jest.mocked(submitReport).mockImplementation(async (_request, target) => {
      if (target.type === 'Item' && target.itemId === 3) {
        return { alreadyReported: true };
      }
      if (target.type === 'Item' && target.itemId === 4) {
        throw new ApiError('unavailable', 503);
      }
      return { alreadyReported: false };
    });
    const { renderer, hook } = await openReport([entry(2, false), entry(3, false), entry(4, false)], [2, 3, 4]);
    await act(async () => byTestId(renderer, 'report-reason-Other').props.onPress());
    await act(async () => reportButton(renderer).props.onPress());

    expect([...hook().selection.selectedIds]).toEqual([4]);
    const text = renderer.root.findAll(node => typeof node.props.message === 'string' && String(node.props.message).includes('reports received'));
    expect(String(text[0].props.message)).toContain('2 reports received.');
    expect(String(text[0].props.message)).toContain('1 of them were already reported.');
    expect(String(text[0].props.message)).toContain('1 could not be sent and stay selected.');
  });

  it('the hourly report limit stops the rest from being sent and says so; the unsent links stay selected', async () => {
    jest.mocked(submitReport).mockImplementation(async (_request, target) => {
      if (target.type === 'Item' && target.itemId >= 3) {
        throw new ApiError('tooManyRequests', 429, 'rateLimited', 3600);
      }
      return { alreadyReported: false };
    });
    const { renderer, hook } = await openReport([entry(2, false), entry(3, false), entry(4, false), entry(5, false)], [2, 3, 4, 5]);
    await act(async () => byTestId(renderer, 'report-reason-Spam').props.onPress());
    await act(async () => reportButton(renderer).props.onPress());

    expect([...hook().selection.selectedIds].sort()).toEqual([3, 4, 5]);
    const text = renderer.root.findAll(node => typeof node.props.message === 'string' && String(node.props.message).includes('reports received'));
    expect(String(text[0].props.message)).toContain('Reports are limited to 20 per hour');
  });

  it('every report failing keeps the dialog open with the draft', async () => {
    jest.mocked(submitReport).mockRejectedValue(new ApiError('unavailable', 503));
    const { renderer, hook } = await openReport([entry(2, false), entry(3, false)], [2, 3]);
    await act(async () => byTestId(renderer, 'report-reason-Spam').props.onPress());
    await act(async () => reportButton(renderer).props.onPress());
    expect(renderer.root.findAllByProps({ testID: 'report-error' }).length).toBeGreaterThan(0);
    expect(hook().selection.count).toBe(2);
  });

  it('cancelling the dialog reports nothing', async () => {
    const { renderer } = await openReport([entry(2, false)], [2]);
    await act(async () => byTestId(renderer, 'report-cancel').props.onPress());
    expect(submitReport).not.toHaveBeenCalled();
  });
});

describe('더보기 for one link keeps the old long-press menu\'s single-link features', () => {
  it("my own link: open, copy link, edit, react, share", async () => {
    const { hook } = await mount({ kind: 'ownedShared', links: [entry(1, true)] });
    await select(hook, 1);
    expect((barModel!.actions.find(action => action.key === 'more')!.menu ?? []).map(row => row.key)).toEqual(['open', 'copyLinks', 'edit', 'react', 'shareLinks']);
  });

  it("another person's link: 링크 저장 instead of 수정", async () => {
    const { hook } = await mount({ kind: 'foreignShared', links: [entry(2, false)] });
    await select(hook, 2);
    expect((barModel!.actions.find(action => action.key === 'more')!.menu ?? []).map(row => row.key)).toEqual(['open', 'copyLinks', 'save', 'react', 'shareLinks']);
  });

  it('several links: only copy and share as one text', async () => {
    const { hook } = await mount({ kind: 'personal', links: [entry(1, true), entry(2, true)] });
    await select(hook, 1, 2);
    expect((barModel!.actions.find(action => action.key === 'more')!.menu ?? []).map(row => row.key)).toEqual(['copyLinks', 'shareLinks']);
  });

  it('a private Collection has no reaction row', async () => {
    const { hook } = await mount({ kind: 'personal', links: [entry(1, true)] });
    await select(hook, 1);
    expect((barModel!.actions.find(action => action.key === 'more')!.menu ?? []).map(row => row.key)).not.toContain('react');
  });
});

describe('복사/이동 names and link-list text', () => {
  it('the bar says Copy to collection / Move to collection, never a bare Copy or Move', async () => {
    const { hook } = await mount({ kind: 'personal', links: [entry(1, true)] });
    await select(hook, 1);
    const labels = barModel!.actions.map(action => action.label);
    expect(labels).toContain('Move to collection');
    expect(labels).toContain('Copy to collection');
    expect(labels).not.toContain('Copy');
    expect(labels).not.toContain('Move');
  });

  it('copying several links puts one blank line between them, in the order shown (not the order tapped)', async () => {
    const { hook } = await mount({ kind: 'personal', links: [entry(1, true), entry(2, true), entry(3, true)] });
    await select(hook, 3, 1, 2);
    const more = barModel!.actions.find(action => action.key === 'more')!.menu!;
    await act(async () => more.find(row => row.key === 'copyLinks')!.onPress());
    expect(Clipboard.setString).toHaveBeenLastCalledWith('https://example.com/1\n\nhttps://example.com/2\n\nhttps://example.com/3');
  });

  it('copying one link has no surrounding newline', async () => {
    const { hook } = await mount({ kind: 'personal', links: [entry(1, true)] });
    await select(hook, 1);
    await act(async () => barModel!.actions.find(action => action.key === 'more')!.menu!.find(row => row.key === 'copyLinks')!.onPress());
    expect(Clipboard.setString).toHaveBeenLastCalledWith('https://example.com/1');
  });
});

describe('selection ends by itself when nothing valid is chosen', () => {
  it('un-choosing the last link ends it', async () => {
    const { hook } = await mount({ kind: 'personal', links: [entry(1, true), entry(2, true)] });
    await select(hook, 1);
    await act(async () => hook().rowSelection(entry(1, true))!.onToggle());
    expect(hook().selection.isActive).toBe(false);
    expect(barModel).toBeNull();
  });

  it('a refresh that removed the chosen link ends it - but not while the list is loading', async () => {
    const mountResult = await mount({ kind: 'personal', links: [entry(1, true), entry(2, true)] });
    await select(mountResult.hook, 1);
    const rerender = async (loadedItems: CollectionItemEntry[], isLoading: boolean) => {
      await act(async () => {
        mountResult.renderer.update(
          <AppToastProvider><SelectionBarProvider><Harness onHook={() => undefined} options={{ ...mountResult.options, loadedItems, isLoading }} /><BarProbe /></SelectionBarProvider></AppToastProvider>,
        );
      });
    };
    await rerender([], true);
    expect(barModel).not.toBeNull();
    await rerender([entry(2, true)], false);
    expect(barModel).toBeNull();
  });
});

describe('copy confirmation: the app says it only where the OS does not', () => {
  const originalOS = Platform.OS;
  const originalVersion = Platform.Version;
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    Object.defineProperty(Platform, 'Version', { value: originalVersion, configurable: true });
  });
  const toastShown = (renderer: Renderer, text: string) =>
    renderer.root.findAll(node => node.type === Text && [node.props.children].flat().join('') === text).length > 0;
  const copyTwo = async () => {
    const { renderer, hook } = await mount({ kind: 'personal', links: [entry(1, true), entry(2, true)] });
    await select(hook, 1, 2);
    await act(async () => barModel!.actions.find(action => action.key === 'more')!.menu!.find(row => row.key === 'copyLinks')!.onPress());
    return renderer;
  };

  it('Android 13+: the system already confirms, so the app shows no second message (the text is still copied)', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    Object.defineProperty(Platform, 'Version', { value: 34, configurable: true });
    const renderer = await copyTwo();
    expect(Clipboard.setString).toHaveBeenLastCalledWith(['https://example.com/1', 'https://example.com/2'].join(String.fromCharCode(10, 10)));
    expect(toastShown(renderer, '2 links copied')).toBe(false);
  });

  it('Android 12 and iOS: the app keeps its own confirmation', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    Object.defineProperty(Platform, 'Version', { value: 32, configurable: true });
    expect(toastShown(await copyTwo(), '2 links copied')).toBe(true);
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    expect(toastShown(await copyTwo(), '2 links copied')).toBe(true);
  });

  it('a failure is always reported, on every OS version', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    Object.defineProperty(Platform, 'Version', { value: 34, configurable: true });
    jest.mocked(Clipboard.setString).mockImplementationOnce(() => { throw new Error('denied'); });
    expect(toastShown(await copyTwo(), "Couldn't copy the link")).toBe(true);
  });
});
