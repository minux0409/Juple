import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Linking, Modal, StyleSheet, Text } from 'react-native';
import { ActionMenuDialog } from '../../components/ActionMenuDialog';
import { LinkSortChips } from '../../components/LinkSortChips';
import { SavedLinkGridCard } from '../../components/SavedLinkGridCard';
import { SavedLinkImageRow } from '../../components/SavedLinkImageTile';
import { SavedLinkRow } from '../../components/SavedLinkRow';
import { ViewModeToggle } from '../../components/ViewModeToggle';
import i18n from '../../i18n';
import { EmptyTrashIcon } from '../../icons/EmptyTrashIcon';
import { RestoreIcon } from '../../icons/RestoreIcon';
import { TrashIcon } from '../../icons/TrashIcon';
import { colors } from '../../theme/tokens';
import { SwipeableItemRow } from '../../components/SwipeableItemRow';
import { TrashScreen } from '../TrashScreen';
import {
  emptyTrash,
  getTrashItems,
  permanentlyDeleteItem,
  restoreItem,
  type ItemHistoryEntry,
  type ItemTrashEntry,
} from '../../items/api/itemsApi';

const mockSetOptions = jest.fn();
const mockNavigation = { setOptions: mockSetOptions };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => {
      return callback();
    }, [callback]);
  },
}));

const mockPrefs = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockPrefs.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockPrefs.set(key, value);
    }),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../items/api/itemsApi', () => ({
  getTrashItems: jest.fn(),
  restoreItem: jest.fn(),
  permanentlyDeleteItem: jest.fn(),
  emptyTrash: jest.fn(),
  TRASH_LIST_LIMIT: 50,
}));

function makeEntry(overrides: Partial<ItemTrashEntry> = {}): ItemTrashEntry {
  return {
    id: 1,
    url: 'https://shop.example/item',
    title: 'Deleted item',
    deletedAtUtc: '2026-09-22T00:00:00Z',
    representativeImage: null,
    previewImageUrl: null,
    coverImage: null,
    ...overrides,
  };
}

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<TrashScreen />);
  });
  return renderer;
}

function findTextValues(renderer: ReactTestRenderer.ReactTestRenderer): unknown[] {
  return renderer.root.findAllByType(Text).map(node => node.props.children);
}

function getConfirmDialogButton(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  const openDialog = renderer.root.findAll(node => node.type === Modal && node.props.visible === true)[0];
  return openDialog.findAll(node => node.props.accessibilityLabel === label)[0];
}

/** Taps the card itself (there is no ⋯ button any more) - the row's own onPress opens the titleless popup. */
function openRowPopup(renderer: ReactTestRenderer.ReactTestRenderer, itemId: number) {
  const row = renderer.root.findAll(node => node.props.testID === `trash-item-${itemId}`)[0];
  row.findAll(node => typeof node.props.onPress === 'function')[0].props.onPress();
}

/** The icon-only red trash-bin button element in the navigation header's title row (the latest headerRight the screen set), or undefined. */
function findEmptyButton() {
  const calls = mockSetOptions.mock.calls;
  const headerRight = calls.length > 0 ? calls[calls.length - 1][0].headerRight : undefined;
  return headerRight ? (headerRight() as { props: Record<string, any> }) : undefined;
}

/** Opens a row's action popup, picks an action, and lets iOS's menu-dismissed hook run. */
async function chooseAction(renderer: ReactTestRenderer.ReactTestRenderer, itemId: number, label: string) {
  await act(async () => {
    openRowPopup(renderer, itemId);
  });
  const menu = renderer.root.findByType(ActionMenuDialog);
  const action = menu.props.actions.find((entry: { label: string }) => entry.label === label);
  await act(async () => {
    action.onPress();
  });
  await act(async () => {
    renderer.root.findByType(ActionMenuDialog).props.onDismiss();
  });
}

describe('TrashScreen empty state', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('shows the empty-state text when there are no deleted items', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([]);

    const renderer = await renderScreen();

    expect(findTextValues(renderer)).toContain(i18n.t('trash.empty'));
  });

  it('still shows the single 50-item limit notice when the list is empty', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([]);

    const renderer = await renderScreen();

    expect(findTextValues(renderer)).toContain(i18n.t('trash.limitNotice', { count: 50 }));
  });
});

describe('TrashScreen limit notice', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('shows the same 50-item notice for every user, with no Plus wording in any locale', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([makeEntry()]);

    const renderer = await renderScreen();

    const notice = i18n.t('trash.limitNotice', { count: 50 });
    expect(findTextValues(renderer)).toContain(notice);
    expect(notice).toContain('50');
    expect(i18n.t('trash.limitNotice', { count: 50, lng: 'ko' })).toBe('삭제 이력은 최근 50개까지 확인할 수 있습니다.');
    for (const language of Object.keys(i18n.options.resources ?? {})) {
      expect(i18n.t('trash.limitNotice', { count: 50, lng: language })).not.toMatch(/plus|플러스/i);
    }
  });
});

describe('TrashScreen list rendering', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders a row for each item GET /trash returns', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([
      makeEntry({ id: 1, title: 'First' }),
      makeEntry({ id: 2, title: 'Second' }),
    ]);

    const renderer = await renderScreen();

    expect(findTextValues(renderer)).toContain('First');
    expect(findTextValues(renderer)).toContain('Second');
  });
});

describe('TrashScreen restore', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('gates the call behind the shared ConfirmDialog and does not call the API on tap alone', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([makeEntry({ id: 1, title: 'First' })]);
    jest.mocked(restoreItem).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    await chooseAction(renderer, 1, i18n.t('trash.restoreConfirmAction'));

    expect(restoreItem).not.toHaveBeenCalled();
  });

  it('on confirm, calls the API and removes the row from the list without a refetch or a success toast', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([makeEntry({ id: 1, title: 'First' })]);
    jest.mocked(restoreItem).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    await chooseAction(renderer, 1, i18n.t('trash.restoreConfirmAction'));

    await act(async () => {
      await getConfirmDialogButton(renderer, i18n.t('trash.restoreConfirmAction')).props.onPress();
    });

    expect(restoreItem).toHaveBeenCalledWith(expect.anything(), 1);
    expect(getTrashItems).toHaveBeenCalledTimes(1);
    expect(findTextValues(renderer)).not.toContain('First');
    expect(findTextValues(renderer)).not.toContain(i18n.t('trash.restoreSuccess'));
  });

  it('does not restore when the ConfirmDialog is cancelled', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([makeEntry({ id: 1, title: 'First' })]);
    const renderer = await renderScreen();

    await chooseAction(renderer, 1, i18n.t('trash.restoreConfirmAction'));

    await act(async () => {
      getConfirmDialogButton(renderer, i18n.t('common.cancel')).props.onPress();
    });

    expect(restoreItem).not.toHaveBeenCalled();
    expect(findTextValues(renderer)).toContain('First');
  });
});

describe('TrashScreen permanent delete', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('gates the call behind the shared ConfirmDialog, then removes the row on success', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([makeEntry({ id: 1, title: 'First' })]);
    jest.mocked(permanentlyDeleteItem).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    await chooseAction(renderer, 1, i18n.t('trash.permanentDeleteA11y'));

    expect(permanentlyDeleteItem).not.toHaveBeenCalled();

    await act(async () => {
      await getConfirmDialogButton(renderer, i18n.t('common.delete')).props.onPress();
    });

    expect(permanentlyDeleteItem).toHaveBeenCalledWith(expect.anything(), 1);
    expect(findTextValues(renderer)).not.toContain('First');
    expect(findTextValues(renderer)).not.toContain(i18n.t('trash.permanentDeleteSuccess'));
  });
});

describe('TrashScreen header layout', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('puts 비우기 in the navigation title row (headerRight) and keeps the limit notice below it, outside the list', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([makeEntry({ id: 1 })]);
    const renderer = await renderScreen();

    expect(findEmptyButton()).toBeDefined();
    // Not inside the screen body any more: only the notice is in the header block of the screen.
    expect(renderer.root.findAll(node => node.props.testID === 'trash-empty-button')).toHaveLength(0);
    const notice = renderer.root.findByProps({ testID: 'trash-limit-notice' });
    expect(notice.props.children).toBe(i18n.t('trash.limitNotice', { count: 50 }));
    expect(StyleSheet.flatten(notice.props.style).textAlign).toBe('center');
    expect(renderer.root.findByType(FlatList).props.ListHeaderComponent).toBeUndefined();
    expect(StyleSheet.flatten(renderer.root.findByType(FlatList).props.contentContainerStyle).paddingTop).toBe(0);
  });

  it('keeps the notice but removes 비우기 from the title row when there is nothing to empty', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([]);
    const renderer = await renderScreen();

    expect(renderer.root.findByProps({ testID: 'trash-limit-notice' }).props.children).toBe(i18n.t('trash.limitNotice', { count: 50 }));
    expect(findEmptyButton()).toBeUndefined();
    expect(findTextValues(renderer)).toContain(i18n.t('trash.empty'));
  });
});

describe('TrashScreen empty trash', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('gates the call behind the shared ConfirmDialog, then calls the API exactly once', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([makeEntry({ id: 1 }), makeEntry({ id: 2 })]);
    jest.mocked(emptyTrash).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    const emptyButton = findEmptyButton();
    await act(async () => {
      emptyButton!.props.onPress();
    });

    expect(emptyTrash).not.toHaveBeenCalled();

    await act(async () => {
      await getConfirmDialogButton(renderer, i18n.t('common.delete')).props.onPress();
    });

    expect(emptyTrash).toHaveBeenCalledTimes(1);
    expect(findTextValues(renderer)).toContain(i18n.t('trash.empty'));
    expect(findTextValues(renderer)).not.toContain(i18n.t('trash.emptyTrashSuccess'));
  });

  const progress = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByProps({ testID: 'trash-empty-progress' }).find(node => typeof node.type !== 'string');

  async function startEmpty(renderer: ReactTestRenderer.ReactTestRenderer) {
    await act(async () => {
      findEmptyButton()!.props.onPress();
    });
    await act(async () => {
      await getConfirmDialogButton(renderer, i18n.t('common.delete')).props.onPress();
    });
  }

  it('blocks the screen with the deleting overlay while the request runs, and a second confirm starts nothing', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([makeEntry({ id: 1 })]);
    let resolveEmpty!: () => void;
    jest.mocked(emptyTrash).mockReturnValue(new Promise<void>(resolve => { resolveEmpty = resolve; }));
    const renderer = await renderScreen();
    expect(progress(renderer)!.props.visible).toBe(false);

    await startEmpty(renderer);

    expect(progress(renderer)!.props.visible).toBe(true);
    expect(progress(renderer)!.props.message).toBe(i18n.t('trash.deleting'));
    // The Empty button is disabled and the confirmation is gone - nothing can start a second request.
    expect(findEmptyButton()!.props.disabled).toBe(true);
    expect(renderer.root.findAll(node => node.type === Modal && node.props.visible === true)).toHaveLength(1);
    expect(emptyTrash).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveEmpty();
    });
    expect(progress(renderer)!.props.visible).toBe(false);
    expect(findTextValues(renderer)).toContain(i18n.t('trash.empty'));
  });

  it('on failure the overlay goes away, the rows stay and the common error dialog is shown', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([makeEntry({ id: 1 })]);
    jest.mocked(emptyTrash).mockRejectedValue(new Error('boom'));
    const renderer = await renderScreen();

    await startEmpty(renderer);

    expect(progress(renderer)!.props.visible).toBe(false);
    expect(findTextValues(renderer)).toContain(i18n.t('trash.emptyTrashError'));
    expect(findTextValues(renderer)).not.toContain(i18n.t('trash.empty'));
  });
});


describe('TrashScreen List / Grid, sort and persistence', () => {
  beforeEach(() => {
    mockPrefs.clear();
    jest.mocked(getTrashItems).mockResolvedValue([
      makeEntry({ id: 1, title: 'Banana', deletedAtUtc: '2026-09-20T00:00:00Z' }),
      makeEntry({ id: 2, title: 'cherry', deletedAtUtc: '2026-09-22T00:00:00Z' }),
      makeEntry({ id: 3, title: 'Apple', deletedAtUtc: '2026-09-21T00:00:00Z' }),
      makeEntry({ id: 4, title: null, url: 'https://zzz.example/x', deletedAtUtc: '2026-09-19T00:00:00Z' }),
    ]);
  });
  afterEach(() => {
    jest.clearAllMocks();
  });

  const shownIds = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    (renderer.root.findByType(FlatList).props.data as ItemTrashEntry[]).map(entry => entry.id);
  const chips = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findByType(LinkSortChips);

  it('opens in List on 시간순 ↓ (newest deleted first) with the shared sort chips and List/Grid switch', async () => {
    const renderer = await renderScreen();

    expect(renderer.root.findAllByType(ViewModeToggle)).toHaveLength(1);
    expect(chips(renderer).props.sort).toBe('newest');
    expect(shownIds(renderer)).toEqual([2, 3, 1, 4]);
    expect(renderer.root.findByType(FlatList).props.numColumns).toBe(1);
    expect(renderer.root.findAllByType(SavedLinkRow)).toHaveLength(4);
  });

  it('시간순 flips ↓ newest ↔ ↑ oldest', async () => {
    const renderer = await renderScreen();

    await act(async () => {
      chips(renderer).props.onPressDate();
    });
    expect(chips(renderer).props.sort).toBe('oldest');
    expect(shownIds(renderer)).toEqual([4, 1, 3, 2]);

    await act(async () => {
      chips(renderer).props.onPressDate();
    });
    expect(shownIds(renderer)).toEqual([2, 3, 1, 4]);
  });

  it('이름순 ↑ then ↓: the same locale-aware rule as Home / Collections (title-less links last in both)', async () => {
    const renderer = await renderScreen();

    await act(async () => {
      chips(renderer).props.onPressName();
    });
    expect(chips(renderer).props.sort).toBe('title');
    expect(shownIds(renderer)).toEqual([3, 1, 2, 4]);

    await act(async () => {
      chips(renderer).props.onPressName();
    });
    expect(chips(renderer).props.sort).toBe('titleDesc');
    expect(shownIds(renderer)).toEqual([2, 1, 3, 4]);
    expect(renderer.root.findByProps({ testID: 'trash-sort-name' }).props.accessibilityLabel).toBe(i18n.t('collections.sortNameDescA11y'));
  });

  it('persists the sort and the view mode, and restores them', async () => {
    const renderer = await renderScreen();
    await act(async () => {
      chips(renderer).props.onPressName();
    });
    await act(async () => {
      chips(renderer).props.onPressName();
    });
    await act(async () => {
      renderer.root.findByType(ViewModeToggle).props.onChange('grid');
    });
    expect(mockPrefs.get('juple.trashLinkSort')).toBe('titleDesc');
    expect(mockPrefs.get('juple.trashViewMode')).toBe('grid');

    const restored = await renderScreen();
    expect(chips(restored).props.sort).toBe('titleDesc');
    expect(shownIds(restored)).toEqual([2, 1, 3, 4]);
    expect(restored.root.findByType(FlatList).props.numColumns).toBe(2);
  });

  it('Grid shows the same SavedLinkGridCard as Home / History / Collections (two columns), not a different design', async () => {
    const renderer = await renderScreen();
    await act(async () => {
      renderer.root.findByType(ViewModeToggle).props.onChange('grid');
    });

    expect(renderer.root.findByType(FlatList).props.numColumns).toBe(2);
    expect(renderer.root.findAllByType(SavedLinkGridCard)).toHaveLength(4);
    expect(renderer.root.findAllByType(SavedLinkRow)).toHaveLength(0);
  });

  // The tiles of every line, as the line hands them over: { item, onPress, onLongPress }.
  const imageTiles = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root.findAllByType(SavedLinkImageRow).flatMap(row => (row.props.items as ItemHistoryEntry[]).map(item => ({ props: { item, onPress: row.props.onPress, onLongPress: row.props.onLongPress } })));

  it('offers a third, 3-column image-tile mode on the same toggle, with a persisted, Trash-only preference', async () => {
    const renderer = await renderScreen();
    expect(renderer.root.findByType(ViewModeToggle).props.showCompact).toBe(true);
    expect(renderer.root.findByType(FlatList).props.numColumns).toBe(1);

    await act(async () => {
      renderer.root.findByType(ViewModeToggle).props.onChange('compact');
    });
    // Juple's one image-only 9-tile primitive (as on Home / the Archive / Collections), three squares per line.
    expect(renderer.root.findAllByType(SavedLinkImageRow)).toHaveLength(2);
    expect(imageTiles(renderer)).toHaveLength(4);
    expect(renderer.root.findAllByType(SavedLinkGridCard)).toHaveLength(0);
    expect(renderer.root.findAllByType(SavedLinkRow)).toHaveLength(0);
    expect(mockPrefs.get('juple.trashViewMode')).toBe('compact');
    // No other surface's preference is touched.
    expect([...mockPrefs.keys()].filter(key => key.endsWith('ViewMode'))).toEqual(['juple.trashViewMode']);

    const restored = await renderScreen();
    expect(restored.root.findAllByType(SavedLinkImageRow)).toHaveLength(2);
  });

  it('the 3-column tiles are the picture only: no title, date or metadata under them, and the shared site fallback without a picture', async () => {
    mockPrefs.set('juple.trashViewMode', 'compact');
    const renderer = await renderScreen();

    expect(renderer.root.findAllByType(Text).filter(node => ['Banana', 'cherry', 'Apple'].includes(String(node.props.children)))).toHaveLength(0);
    expect(findTextValues(renderer).some(value => /2026|9\/2\d\/26|Sep/.test(String(value)))).toBe(false);
    expect(renderer.root.findAll(node => typeof node.type === 'string' && node.props.testID === 'saved-link-image-tile-fallback')).toHaveLength(4);
  });

  it('shows every link by scrolling, not just nine', async () => {
    mockPrefs.set('juple.trashViewMode', 'compact');
    jest.mocked(getTrashItems).mockResolvedValue(Array.from({ length: 14 }, (_, index) => makeEntry({ id: index + 1, title: `T${index}`, deletedAtUtc: `2026-09-${10 + index}T00:00:00Z` })));
    const renderer = await renderScreen();

    expect(renderer.root.findByType(FlatList).props.data).toHaveLength(5);
    expect(imageTiles(renderer).length).toBe(14);
  });

  it('switches freely between List, 2-column Grid and the 3-column tiles without losing the list', async () => {
    const renderer = await renderScreen();
    for (const mode of ['grid', 'compact', 'list', 'compact', 'grid'] as const) {
      await act(async () => {
        renderer.root.findByType(ViewModeToggle).props.onChange(mode);
      });
      expect(renderer.root.findByType(FlatList).props.numColumns).toBe(mode === 'grid' ? 2 : 1);
      expect(imageTiles(renderer)).toHaveLength(mode === 'compact' ? 4 : 0);
    }
  });

  it('an unknown stored mode falls back to List', async () => {
    mockPrefs.set('juple.trashViewMode', 'image');
    const renderer = await renderScreen();
    expect(renderer.root.findByType(FlatList).props.numColumns).toBe(1);
  });

  it('3-column tiles: a tap and a long press open the same popup, and restore / permanent delete still ask first', async () => {
    mockPrefs.set('juple.trashViewMode', 'compact');
    jest.mocked(restoreItem).mockResolvedValue(undefined);
    jest.mocked(permanentlyDeleteItem).mockResolvedValue(undefined);
    const renderer = await renderScreen();
    const tileOf = (id: number) => imageTiles(renderer).find(tile => tile.props.item.id === id)!;

    await act(async () => {
      tileOf(2).props.onPress(tileOf(2).props.item);
    });
    expect(renderer.root.findByType(ActionMenuDialog).props.visible).toBe(true);
    await act(async () => {
      renderer.root.findByType(ActionMenuDialog).props.onCancel();
    });
    await act(async () => {
      tileOf(2).props.onLongPress(tileOf(2).props.item);
    });
    const menu = renderer.root.findByType(ActionMenuDialog);
    expect(menu.props.actions.map((entry: { label: string }) => entry.label)).toEqual([i18n.t('trash.openLink'), i18n.t('trash.restoreConfirmAction'), i18n.t('trash.permanentDeleteA11y')]);

    await act(async () => {
      menu.props.actions[1].onPress();
    });
    await act(async () => {
      renderer.root.findByType(ActionMenuDialog).props.onDismiss();
    });
    expect(restoreItem).not.toHaveBeenCalled();
    await act(async () => {
      await getConfirmDialogButton(renderer, i18n.t('trash.restoreConfirmAction')).props.onPress();
    });
    expect(restoreItem).toHaveBeenCalledTimes(1);
    expect(imageTiles(renderer).map(tile => tile.props.item.id).sort()).toEqual([1, 3, 4]);

    await act(async () => {
      tileOf(1).props.onLongPress(tileOf(1).props.item);
    });
    await act(async () => {
      renderer.root.findByType(ActionMenuDialog).props.actions[2].onPress();
    });
    await act(async () => {
      renderer.root.findByType(ActionMenuDialog).props.onDismiss();
    });
    expect(permanentlyDeleteItem).not.toHaveBeenCalled();
  });

  it('the controls are not shown for an empty list', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([]);
    const renderer = await renderScreen();

    expect(renderer.root.findAllByType(LinkSortChips)).toHaveLength(0);
    expect(renderer.root.findAllByType(ViewModeToggle)).toHaveLength(0);
  });
});

describe('TrashScreen link actions (open / restore / delete)', () => {
  beforeEach(() => {
    mockPrefs.clear();
    jest.mocked(getTrashItems).mockResolvedValue([makeEntry({ id: 1, title: 'First', url: 'https://shop.example/first' })]);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  const menu = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findByType(ActionMenuDialog);

  it('List: the row\'s ⋯ and a tap or long press all open the popup with 링크 열기, 복구 and 영구 삭제 (destructive)', async () => {
    const renderer = await renderScreen();
    expect(menu(renderer).props.visible).toBe(false);

    await act(async () => {
      openRowPopup(renderer, 1);
    });
    expect(menu(renderer).props.visible).toBe(true);
    expect(menu(renderer).props.actions.map((action: { label: string }) => action.label)).toEqual([i18n.t('trash.openLink'), i18n.t('trash.restoreConfirmAction'), i18n.t('trash.permanentDeleteA11y')]);
    expect(menu(renderer).props.actions[2].destructive).toBe(true);
    await act(async () => {
      menu(renderer).props.onCancel();
    });

    const row = renderer.root.findAll(node => node.props.testID === 'trash-item-1')[0];
    const pressable = row.findAll(node => typeof node.props.onLongPress === 'function')[0];
    await act(async () => {
      pressable.props.onLongPress();
    });
    expect(menu(renderer).props.visible).toBe(true);
  });

  it('Grid: tapping a tile (a deleted link has no details screen) and a long press open the same popup', async () => {
    mockPrefs.set('juple.trashViewMode', 'grid');
    const renderer = await renderScreen();
    const tile = renderer.root.findAll(node => node.props.testID === 'trash-item-1' && typeof node.props.onPress === 'function')[0];

    await act(async () => {
      tile.props.onPress();
    });
    expect(menu(renderer).props.visible).toBe(true);
    expect(menu(renderer).props.actions.map((action: { label: string }) => action.label)).toEqual([i18n.t('trash.openLink'), i18n.t('trash.restoreConfirmAction'), i18n.t('trash.permanentDeleteA11y')]);
    await act(async () => {
      menu(renderer).props.onCancel();
    });
    await act(async () => {
      tile.props.onLongPress();
    });
    expect(menu(renderer).props.visible).toBe(true);
  });

  it('링크 열기 opens the raw saved URL externally and restores nothing', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    const renderer = await renderScreen();

    await chooseAction(renderer, 1, i18n.t('trash.openLink'));

    expect(openURL).toHaveBeenCalledWith('https://shop.example/first');
    expect(restoreItem).not.toHaveBeenCalled();
    expect(permanentlyDeleteItem).not.toHaveBeenCalled();
    expect(findTextValues(renderer)).toContain('First');
  });

  it('a link that cannot be opened says so in the common dialog and changes nothing', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no browser'));
    const renderer = await renderScreen();

    await chooseAction(renderer, 1, i18n.t('trash.openLink'));

    expect(findTextValues(renderer)).toContain(i18n.t('item.urlOpenFailed'));
    expect(findTextValues(renderer)).toContain('First');
  });

  it('복구 and 영구 삭제 from the popup still need their confirmation, in List and in Grid', async () => {
    jest.mocked(restoreItem).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    await chooseAction(renderer, 1, i18n.t('trash.restoreConfirmAction'));
    expect(restoreItem).not.toHaveBeenCalled();
    await act(async () => {
      await getConfirmDialogButton(renderer, i18n.t('trash.restoreConfirmAction')).props.onPress();
    });
    expect(restoreItem).toHaveBeenCalledWith(expect.anything(), 1);
    expect(findTextValues(renderer)).not.toContain('First');
  });

  it('Grid: 영구 삭제 from the popup is confirmed first, then removes the tile', async () => {
    mockPrefs.set('juple.trashViewMode', 'grid');
    jest.mocked(permanentlyDeleteItem).mockResolvedValue(undefined);
    const renderer = await renderScreen();
    const tile = renderer.root.findAll(node => node.props.testID === 'trash-item-1' && typeof node.props.onPress === 'function')[0];
    await act(async () => {
      tile.props.onPress();
    });
    await act(async () => {
      menu(renderer).props.actions[2].onPress();
    });
    await act(async () => {
      menu(renderer).props.onDismiss();
    });
    expect(permanentlyDeleteItem).not.toHaveBeenCalled();

    await act(async () => {
      await getConfirmDialogButton(renderer, i18n.t('common.delete')).props.onPress();
    });

    expect(permanentlyDeleteItem).toHaveBeenCalledWith(expect.anything(), 1);
    expect(renderer.root.findAll(node => node.props.testID === 'trash-item-1')).toHaveLength(0);
  });
});

describe('TrashScreen gestures, titleless popup and icon-only empty button', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const FAKE = { touchHistory: { touchBank: [], numberActiveTouches: 0, indexOfSingleActiveTouch: -1, mostRecentTimeStamp: 0 }, nativeEvent: {} };
  const menuOf = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findByType(ActionMenuDialog);

  async function reveal(renderer: ReactTestRenderer.ReactTestRenderer) {
    const layer = renderer.root.findAll(node => Array.isArray(node.props.accessibilityActions))[0];
    await act(async () => {
      layer.props.onResponderGrant(FAKE);
    });
  }

  it('the action popup has no title and there is no visible ⋯ button', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([makeEntry({ id: 1, title: 'First' })]);
    const renderer = await renderScreen();
    expect(renderer.root.findAll(node => String(node.props.testID ?? '').startsWith('trash-more-'))).toHaveLength(0);

    await act(async () => {
      openRowPopup(renderer, 1);
    });
    expect(menuOf(renderer).props.visible).toBe(true);
    expect(menuOf(renderer).props.title).toBeUndefined();
  });

  it('List: swiping reveals 복구 and 영구 삭제 but executes neither; each still asks for confirmation', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([makeEntry({ id: 1, title: 'First' })]);
    mockPrefs.set('juple.trashViewMode', 'list');
    const renderer = await renderScreen();
    await reveal(renderer);

    expect(restoreItem).not.toHaveBeenCalled();
    expect(permanentlyDeleteItem).not.toHaveBeenCalled();
    const restore = renderer.root.find(node => node.props.testID === 'trash-restore-1' && typeof node.props.onPress === 'function');
    const del = renderer.root.find(node => node.props.testID === 'trash-delete-1' && typeof node.props.onPress === 'function');
    expect(restore.props.accessibilityLabel).toBe(i18n.t('trash.restoreA11y'));
    expect(del.props.accessibilityLabel).toBe(i18n.t('trash.permanentDeleteA11y'));
    // Swipe panes are icon-only everywhere (List and Grid); the full wording stays in the accessibility label.
    expect(del.findAllByType(Text)).toHaveLength(0);
    // Swipe panes are icon-only everywhere (List and Grid); the full wording stays in the accessibility label.
    expect(del.findAllByType(Text)).toHaveLength(0);

    await act(async () => {
      restore.props.onPress();
    });
    expect(getConfirmDialogButton(renderer, i18n.t('trash.restoreConfirmAction'))).toBeDefined();
    expect(restoreItem).not.toHaveBeenCalled();
  });

  it('List: the swipe-revealed 영구 삭제 is confirmed before anything is deleted', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([makeEntry({ id: 1, title: 'First' })]);
    mockPrefs.set('juple.trashViewMode', 'list');
    const renderer = await renderScreen();
    await reveal(renderer);
    await act(async () => {
      renderer.root.find(node => node.props.testID === 'trash-delete-1' && typeof node.props.onPress === 'function').props.onPress();
    });
    expect(permanentlyDeleteItem).not.toHaveBeenCalled();
    expect(getConfirmDialogButton(renderer, i18n.t('common.delete'))).toBeDefined();
  });

  it('Grid: the same swipe row - right reveals 복구, left reveals 영구 삭제 (compact: icon over a short visible label); swiping executes nothing, the actions ask first', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([makeEntry({ id: 1, title: 'First' })]);
    mockPrefs.set('juple.trashViewMode', 'grid');
    const renderer = await renderScreen();
    const swipe = renderer.root.findAllByType(SwipeableItemRow)[0];
    expect(swipe.props.compact).toBe(true);
    await reveal(renderer);

    expect(restoreItem).not.toHaveBeenCalled();
    expect(permanentlyDeleteItem).not.toHaveBeenCalled();
    const restore = renderer.root.find(node => node.props.testID === 'trash-restore-1' && typeof node.props.onPress === 'function');
    const del = renderer.root.find(node => node.props.testID === 'trash-delete-1' && typeof node.props.onPress === 'function');
    // Icon only in the narrow tile too - no visible text; the accessibility labels carry the wording.
    expect(restore.findAllByType(Text)).toHaveLength(0);
    expect(del.findAllByType(Text)).toHaveLength(0);
    expect(i18n.getFixedT('ko')('trash.permanentDeleteA11y')).toBe('영구 삭제');
    expect(restore.findAllByType(RestoreIcon)).toHaveLength(1);
    expect(del.findAllByType(TrashIcon)).toHaveLength(1);
    expect(restore.props.accessibilityLabel).toBe(i18n.t('trash.restoreA11y'));
    expect(del.props.accessibilityLabel).toBe(i18n.t('trash.permanentDeleteA11y'));
    expect(renderer.root.findAll(node => String(node.props.testID ?? '').startsWith('trash-more-'))).toHaveLength(0);

    await act(async () => {
      del.props.onPress();
    });
    expect(permanentlyDeleteItem).not.toHaveBeenCalled();
    expect(getConfirmDialogButton(renderer, i18n.t('common.delete'))).toBeDefined();
  });

  it('Grid: the revealed 복구 follows the restore confirmation, and a normal tap opens the popup without a title', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([makeEntry({ id: 1, title: 'First' })]);
    mockPrefs.set('juple.trashViewMode', 'grid');
    const renderer = await renderScreen();
    await reveal(renderer);
    await act(async () => {
      renderer.root.find(node => node.props.testID === 'trash-restore-1' && typeof node.props.onPress === 'function').props.onPress();
    });
    expect(restoreItem).not.toHaveBeenCalled();
    expect(getConfirmDialogButton(renderer, i18n.t('trash.restoreConfirmAction'))).toBeDefined();

    await act(async () => {
      openRowPopup(renderer, 1);
    });
    expect(menuOf(renderer).props.visible).toBe(true);
    expect(menuOf(renderer).props.title).toBeUndefined();
  });

  it('empty trash is an icon-only red trash button with a localized label and a 44dp target', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([makeEntry({ id: 1 })]);
    const renderer = await renderScreen();
    const button = findEmptyButton()!;
    expect(button.props.accessibilityLabel).toBe(i18n.t('trash.emptyA11y'));
    expect(StyleSheet.flatten(button.props.style).minWidth).toBe(44);
    expect(findTextValues(renderer)).not.toContain(i18n.t('trash.emptyAction'));
    // A distinct clear-all bin (with sweep lines), never the same glyph as deleting a single item; no text child.
    expect(button.props.children.type).toBe(EmptyTrashIcon);
    expect(button.props.children.type).not.toBe(TrashIcon);
    expect(button.props.children.props.color).toBe(colors.danger);
  });
});
