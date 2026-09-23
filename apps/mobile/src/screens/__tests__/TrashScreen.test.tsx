import ReactTestRenderer, { act } from 'react-test-renderer';
import { Modal, Text } from 'react-native';
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
}));

jest.mock('../../auth/useIsPlusUser', () => ({
  useIsPlusUser: jest.fn(() => false),
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
