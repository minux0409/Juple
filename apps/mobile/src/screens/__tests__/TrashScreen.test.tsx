import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Modal, StyleSheet, Text } from 'react-native';
import i18n from '../../i18n';
import { TrashScreen } from '../TrashScreen';
import {
  emptyTrash,
  getTrashItems,
  permanentlyDeleteItem,
  restoreItem,
  type ItemTrashEntry,
} from '../../items/api/itemsApi';

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

/** Finds the Text node with exactly this children text, then walks up to its nearest onPress-bearing ancestor. */
function findPressableContainingText(renderer: ReactTestRenderer.ReactTestRenderer, text: string) {
  let node: ReactTestRenderer.ReactTestInstance | null = renderer.root.findByProps({ children: text });
  while (node && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  return node;
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

    const restoreButton = renderer.root.findByProps({ accessibilityLabel: i18n.t('trash.restoreA11y') });
    await act(async () => {
      restoreButton.props.onPress();
    });

    expect(restoreItem).not.toHaveBeenCalled();
  });

  it('on confirm, calls the API and removes the row from the list without a refetch or a success toast', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([makeEntry({ id: 1, title: 'First' })]);
    jest.mocked(restoreItem).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    const restoreButton = renderer.root.findByProps({ accessibilityLabel: i18n.t('trash.restoreA11y') });
    await act(async () => {
      restoreButton.props.onPress();
    });

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

    const restoreButton = renderer.root.findByProps({ accessibilityLabel: i18n.t('trash.restoreA11y') });
    await act(async () => {
      restoreButton.props.onPress();
    });

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

    const deleteButton = renderer.root.findByProps({
      accessibilityLabel: i18n.t('trash.permanentDeleteA11y'),
    });
    await act(async () => {
      deleteButton.props.onPress();
    });

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

  it('centers the limit notice and puts 비우기 on the same header row, outside the list', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([makeEntry({ id: 1 })]);
    const renderer = await renderScreen();

    const notice = renderer.root.findByProps({ testID: 'trash-limit-notice' });
    expect(StyleSheet.flatten(notice.props.style)).toMatchObject({ textAlign: 'center', flex: 1 });
    const headerRow = notice.parent!;
    expect(StyleSheet.flatten(headerRow.props.style)).toMatchObject({ flexDirection: 'row' });
    const emptyButton = findPressableContainingText(renderer, i18n.t('trash.emptyAction'));
    expect(headerRow.findAll(node => node === emptyButton)).toHaveLength(1);
    expect(StyleSheet.flatten(headerRow.props.style).minHeight).toBe(44);
    // Never inside the FlatList (whose own padding used to open the big gap under the notice).
    expect(renderer.root.findByType(FlatList).props.ListHeaderComponent).toBeUndefined();
    expect(StyleSheet.flatten(renderer.root.findByType(FlatList).props.contentContainerStyle).paddingTop).toBe(0);
  });

  it('centers the notice on the true center line: a leading mirror slot always matches 비우기\'s measured width', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([makeEntry({ id: 1 })]);
    const renderer = await renderScreen();

    const emptyButton = findPressableContainingText(renderer, i18n.t('trash.emptyAction'))!;
    await act(async () => {
      emptyButton.props.onLayout({ nativeEvent: { layout: { width: 57, height: 44, x: 0, y: 0 } } });
    });

    const notice = renderer.root.findByProps({ testID: 'trash-limit-notice' });
    const mirrorSlot = renderer.root.findByProps({ testID: 'trash-header-mirror-slot' });
    const headerChildren = notice.parent!.children as ReactTestRenderer.ReactTestInstance[];
    // [mirror slot][notice (flex:1, centered)][비우기] - equal-width sides => symmetric center column.
    expect(headerChildren.indexOf(mirrorSlot)).toBeLessThan(headerChildren.indexOf(notice));
    expect(StyleSheet.flatten(mirrorSlot.props.style).width).toBe(57);
  });

  it('keeps the centered notice but hides 비우기 (and its mirror slot) when there is nothing to empty', async () => {
    jest.mocked(getTrashItems).mockResolvedValue([]);
    const renderer = await renderScreen();

    expect(renderer.root.findByProps({ testID: 'trash-limit-notice' }).props.children).toBe(i18n.t('trash.limitNotice', { count: 50 }));
    expect(findTextValues(renderer)).not.toContain(i18n.t('trash.emptyAction'));
    expect(renderer.root.findAllByProps({ testID: 'trash-header-mirror-slot' })).toHaveLength(0);
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

    const emptyButton = findPressableContainingText(renderer, i18n.t('trash.emptyAction'));
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
});
