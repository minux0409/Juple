import ReactTestRenderer, { act } from 'react-test-renderer';
import i18n from '../../i18n';
import { CategoryPickerModal } from '../CategoryPickerModal';
import { CheckIcon } from '../../icons/CheckIcon';
import { KeyIcon } from '../../icons/KeyIcon';
import type { Collection } from '../api/collectionsApi';
import { clearCollectionUnlockGrants } from '../collectionUnlockGrants';
import { dragSheet, settleSheet } from '../../testing/sheetGestureDriver';
import { StyleSheet } from 'react-native';
import { ViewModeToggle } from '../../components/ViewModeToggle';

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 1,
    name: 'Groceries',
    isFavorite: false,
    itemCount: 0,
    createdAtUtc: new Date().toISOString(),
    updatedAtUtc: new Date().toISOString(),
    icon: 'Folder',
    color: null,
    ...overrides,
  };
}

function render(element: React.ReactElement): ReactTestRenderer.ReactTestRenderer {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
}

const baseProps = {
  onClose: jest.fn(),
  isLoadingOptions: false,
  isLoadingMore: false,
  onLoadMore: jest.fn(),
  error: null,
  newCollectionName: '',
  onChangeNewCollectionName: jest.fn(),
  isCreatingCollection: false,
  onSubmitNewCollection: jest.fn(),
  bottomInset: 0,
  visible: true,
};

describe('CategoryPickerModal selection indicator', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('shows no CheckIcon and marks the row unselected for an option not in selectedIds', () => {
    const collection = makeCollection({ id: 1, name: 'Groceries' });
    const renderer = render(
      <CategoryPickerModal
        {...baseProps}
        collectionPool={[collection]}
        onToggle={jest.fn()}
        selectedIds={new Set()}
      />,
    );

    expect(renderer.root.findAllByType(CheckIcon)).toHaveLength(0);
    const row = renderer.root.findByProps({ accessibilityLabel: 'Groceries' });
    expect(row.props.accessibilityState).toEqual({ selected: false });
  });

  it('a share password puts no key badge on an option - the Collection lock keeps its own badge', () => {
    const renderer = render(
      <CategoryPickerModal
        {...baseProps}
        collectionPool={[makeCollection({ id: 1, name: 'Groceries', accessRole: 'owner', isLocked: true, isSharePasswordProtected: true })]}
        onToggle={jest.fn()}
        selectedIds={new Set()}
      />,
    );

    expect(renderer.root.findAllByType(KeyIcon)).toHaveLength(0);
    expect(renderer.root.findAll(node => node.props.testID === 'collection-badge-share-password')).toHaveLength(0);
    expect(renderer.root.findAll(node => node.props.testID === 'collection-badge-locked').length).toBeGreaterThan(0);
  });

  it('shows a CheckIcon and marks the row selected for an option in selectedIds', () => {
    const collection = makeCollection({ id: 1, name: 'Groceries' });
    const renderer = render(
      <CategoryPickerModal
        {...baseProps}
        collectionPool={[collection]}
        onToggle={jest.fn()}
        selectedIds={new Set([1])}
      />,
    );

    expect(renderer.root.findAllByType(CheckIcon)).toHaveLength(1);
    const row = renderer.root.findByProps({ accessibilityLabel: 'Groceries' });
    expect(row.props.accessibilityState).toEqual({ selected: true });
  });

  it('calls onToggle with the option when its row is pressed - multi-select semantics unchanged', () => {
    const collectionA = makeCollection({ id: 1, name: 'A' });
    const collectionB = makeCollection({ id: 2, name: 'B' });
    const onToggle = jest.fn();
    const renderer = render(
      <CategoryPickerModal
        {...baseProps}
        collectionPool={[collectionA, collectionB]}
        onToggle={onToggle}
        selectedIds={new Set([1])}
      />,
    );

    act(() => {
      renderer.root.findByProps({ accessibilityLabel: 'B' }).props.onPress();
    });

    expect(onToggle).toHaveBeenCalledWith(collectionB);
    // Toggling one option never implicitly deselects another - still a real multi-select, not a
    // single-select radio group wearing multi-select styling.
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('does not tint a selected row background - selection is communicated only via the check circle', () => {
    const collection = makeCollection({ id: 1, name: 'Groceries' });
    const renderer = render(
      <CategoryPickerModal
        {...baseProps}
        collectionPool={[collection]}
        onToggle={jest.fn()}
        selectedIds={new Set([1])}
      />,
    );

    const row = renderer.root.findByProps({ accessibilityLabel: 'Groceries' });
    const rowStyle = row.props.style;
    const flatStyle = Array.isArray(rowStyle) ? Object.assign({}, ...rowStyle.filter(Boolean)) : rowStyle;
    expect(flatStyle.backgroundColor).toBeUndefined();
  });

  it('the whole row - not just the check circle - is the touch target', () => {
    const collection = makeCollection({ id: 1, name: 'Groceries' });
    const renderer = render(
      <CategoryPickerModal
        {...baseProps}
        collectionPool={[collection]}
        onToggle={jest.fn()}
        selectedIds={new Set()}
      />,
    );

    const row = renderer.root.findByProps({ accessibilityLabel: 'Groceries' });
    expect(row.props.accessibilityRole).toBe('button');
    expect(typeof row.props.onPress).toBe('function');
  });
});

describe('CategoryPickerModal - locked Collections', () => {
  afterEach(() => {
    clearCollectionUnlockGrants();
    jest.clearAllMocks();
  });

  it('a locked Collection is tappable (the caller asks for its password), marked with a hint', () => {
    const onToggle = jest.fn();
    const renderer = render(
      <CategoryPickerModal
        {...baseProps}
        collectionPool={[makeCollection({ id: 7, name: 'Private', isLocked: true }), makeCollection({ id: 8, name: 'Open' })]}
        onToggle={onToggle}
        selectedIds={new Set()}
      />,
    );

    const locked = renderer.root.findByProps({ accessibilityLabel: 'Private' });
    expect(locked.props.disabled).toBeUndefined();
    expect(locked.props.accessibilityHint).toBeTruthy();
    expect(renderer.root.findByProps({ accessibilityLabel: 'Open' }).props.accessibilityHint).toBeUndefined();
    act(() => {
      locked.props.onPress();
    });
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  });

  it('shows the password prompt for the unlock target, over the sheet', () => {
    const renderer = render(
      <CategoryPickerModal
        {...baseProps}
        collectionPool={[makeCollection({ id: 7, name: 'Private', isLocked: true })]}
        onToggle={jest.fn()}
        selectedIds={new Set()}
        unlockTarget={makeCollection({ id: 7, name: 'Private', isLocked: true })}
      />,
    );

    expect(renderer.root.findByProps({ testID: 'collection-unlock-dialog' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: 'collection-unlock-password' })).toBeTruthy();
  });
});

describe('CategoryPickerModal - the optional 복제 mode (defaults unchanged)', () => {
  const pool = [makeCollection({ id: 1, name: 'Groceries' }), makeCollection({ id: 2, name: 'Travel' })];
  const byTestId = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
    renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];

  it('without the new props: the + tile, 닫기, no order control, nothing disabled', () => {
    const renderer = render(<CategoryPickerModal {...baseProps} collectionPool={pool} onToggle={jest.fn()} selectedIds={new Set()} />);

    expect(renderer.root.findAll(node => node.props.accessibilityLabel === i18n.t('collections.addNew') && typeof node.props.onPress === 'function')).toHaveLength(1);
    expect(renderer.root.findAll(node => node.props.testID === 'category-picker-sort')).toHaveLength(0);
    expect(renderer.root.findAll(node => node.props.testID === 'category-picker-submit')).toHaveLength(0);
    expect(byTestId(renderer, 'category-picker-option-1').props.disabled).toBeUndefined();
  });

  it('with them: its own title, 최신순 | 이름순, 이미 포함됨 not choosable, and N개 선택됨 with [취소] [복제] (off until something is chosen)', () => {
    const onSubmit = jest.fn();
    const onSort = jest.fn();
    const onToggle = jest.fn();
    const props = {
      ...baseProps,
      collectionPool: pool,
      disabledIds: new Set([1]),
      onToggle,
      showCreateTile: false,
      sort: { value: 'newest' as const, onChange: onSort },
      submit: { label: '복제', onSubmit, isSubmitting: false },
      title: '컬렉션 선택',
    };
    const renderer = render(<CategoryPickerModal {...props} selectedIds={new Set()} />);

    expect(byTestId(renderer, 'category-picker-sort-newest').props.accessibilityState).toEqual({ checked: true });
    act(() => byTestId(renderer, 'category-picker-sort-title').props.onPress());
    expect(onSort).toHaveBeenCalledWith('title');

    const included = byTestId(renderer, 'category-picker-option-1');
    expect(included.props.disabled).toBe(true);
    expect(included.props.accessibilityState).toEqual({ selected: false, disabled: true });
    expect(included.props.accessibilityHint).toBeTruthy();
    expect(byTestId(renderer, 'category-picker-submit').props.disabled).toBe(true);

    act(() => renderer.update(<CategoryPickerModal {...props} selectedIds={new Set([2])} />));
    const submit = byTestId(renderer, 'category-picker-submit');
    expect(submit.props.disabled).toBe(false);
    act(() => submit.props.onPress());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // 360dp: [취소] and [복제] share the row equally, and a long 복제 label may wrap to two lines.
    expect(byTestId(renderer, 'category-picker-cancel').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ flex: 1 })]));
    expect(renderer.root.findAll(node => node.props.testID === 'category-picker-selected-count').length).toBeGreaterThan(0);
  });
});

describe('CategoryPickerModal - the Collection list could not be loaded', () => {
  const hostTexts = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
    renderer.root
      .findAll(node => node.props.testID === testID && typeof node.type === 'string')
      .flatMap(node => node.findAll(child => typeof child.type === 'string' && typeof child.props.children === 'string').map(child => child.props.children as string));

  it('nothing listed yet: a centered load-failure state INSIDE the open sheet, with the standard words and a retry', () => {
    const onRetryLoad = jest.fn();
    const renderer = render(
      <CategoryPickerModal
        {...baseProps}
        collectionPool={[]}
        loadFailure={{ cause: new Error('offline'), notice: null }}
        onRetryLoad={onRetryLoad}
        onToggle={jest.fn()}
        selectedIds={new Set()}
      />,
    );

    expect(hostTexts(renderer, 'category-picker-load-failure')).toEqual([i18n.t('importantState.loadFailedTitle'), i18n.t('importantState.loadFailedMessage'), i18n.t('importantState.retry')]);
    // Never the old small red sentence.
    expect(renderer.root.findAll(node => node.props.testID === 'category-picker-error')).toHaveLength(0);
    act(() => renderer.root.findAll(node => node.props.testID === 'category-picker-load-failure-retry' && typeof node.props.onPress === 'function')[0].props.onPress());
    expect(onRetryLoad).toHaveBeenCalledTimes(1);
  });

  it('some already listed (a next page failed): they stay usable, with a compact non-blocking retry row', () => {
    const onRetryLoad = jest.fn();
    const onToggle = jest.fn();
    const renderer = render(
      <CategoryPickerModal
        {...baseProps}
        collectionPool={[makeCollection({ id: 1, name: 'Groceries' })]}
        loadFailure={{ cause: new Error('offline'), notice: null }}
        onRetryLoad={onRetryLoad}
        onToggle={onToggle}
        selectedIds={new Set()}
      />,
    );

    expect(renderer.root.findAll(node => node.props.testID === 'category-picker-load-failure')).toHaveLength(0);
    act(() => renderer.root.findByProps({ accessibilityLabel: 'Groceries' }).props.onPress());
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(hostTexts(renderer, 'category-picker-more-failure')).toEqual([i18n.t('importantState.loadFailedTitle'), i18n.t('importantState.retry')]);
    act(() => renderer.root.findAll(node => node.props.testID === 'category-picker-more-failure-retry' && typeof node.props.onPress === 'function')[0].props.onPress());
    expect(onRetryLoad).toHaveBeenCalledTimes(1);
  });
});


const sheetDragArea = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onMoveShouldSetResponder === 'function')[0].props;
const headerArea = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID && typeof node.type === 'string')[0];
const headerTexts = (area: ReactTestRenderer.ReactTestInstance) =>
  area.findAll(node => typeof node.type === 'string' && typeof node.props.children === 'string').map(node => node.props.children as string);
const hasHandle = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(node => node.props.testID === 'sheet-handle' && typeof node.type === 'string').length > 0;

describe('CategoryPickerModal - the shared handle', () => {
  it('handle shown; a downward drag closes like 닫기 (onClose)', async () => {
    const onClose = jest.fn();
    const renderer = render(<CategoryPickerModal {...baseProps} collectionPool={[]} onClose={onClose} onToggle={jest.fn()} selectedIds={new Set()} />);
    expect(hasHandle(renderer)).toBe(true);
    // The header - 컬렉션 선택 and List/Grid, under the handle - is the drag area; the tiles are not.
    const area = headerArea(renderer, 'category-picker-drag-area');
    expect(area.props.collapsable).toBe(false);
    expect(headerTexts(area)).toContain(i18n.t('collections.selectTitle'));
    expect(area.findAll(node => node.props.testID === 'category-picker-list')).toHaveLength(0);
    dragSheet(sheetDragArea(renderer, 'category-picker-drag-area'), { dy: 160, durationMs: 600 });
    await settleSheet();
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });

  it('while a Collection is being created (its close is unavailable), the drag does nothing', async () => {
    const onClose = jest.fn();
    const renderer = render(<CategoryPickerModal {...baseProps} collectionPool={[]} isCreatingCollection onClose={onClose} onToggle={jest.fn()} selectedIds={new Set()} />);
    expect(dragSheet(sheetDragArea(renderer, 'category-picker-drag-area'), { dy: 200 })).toBe(false);
    await settleSheet();
    expect(onClose).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it('while its confirming action runs (복제 / 이동), the drag does nothing either', async () => {
    const onClose = jest.fn();
    const renderer = render(
      <CategoryPickerModal {...baseProps} collectionPool={[]} onClose={onClose} onToggle={jest.fn()} selectedIds={new Set([1])} submit={{ label: 'x', onSubmit: jest.fn(), isSubmitting: true }} />,
    );
    expect(dragSheet(sheetDragArea(renderer, 'category-picker-drag-area'), { dy: 200 })).toBe(false);
    act(() => renderer.unmount());
  });
});

/** The shared SheetHeader as rendered in this sheet: the responder view, its title area and its actions. */
function renderedSheetHeader(renderer: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const area = renderer.root.findAll(node => node.props.testID === testID && typeof node.type === 'string')[0];
  const titleArea = area.findAll(node => node.props.testID === 'sheet-header-title' && typeof node.type === 'string')[0];
  const actions = area.findAll(node => node.props.testID === 'sheet-header-actions' && typeof node.type === 'string')[0];
  return { area, titleArea, actions };
}
function expectOneDragSurface(header: ReturnType<typeof renderedSheetHeader>, title: string) {
  // ONE native responder view (never flattened, full width) owns the drag...
  expect(header.area.props.collapsable).toBe(false);
  expect(typeof header.area.props.onStartShouldSetResponder).toBe('function');
  expect(typeof header.area.props.onMoveShouldSetResponderCapture).toBe('function');
  expect(StyleSheet.flatten(header.area.props.style).alignSelf).toBe('stretch');
  // ...and its title area holds the title AND takes the free width (the empty space up to the actions is inside it).
  expect(StyleSheet.flatten(header.titleArea.props.style)).toMatchObject({ flex: 1 });
  expect(header.titleArea.findAll(node => typeof node.type === 'string' && node.props.children === title).length).toBeGreaterThan(0);
  // Nothing inside has handlers of its own: the drag is the outer header's.
  expect(header.titleArea.props.onStartShouldSetResponder).toBeUndefined();
}

describe('CategoryPickerModal - the shared drag header (컬렉션 선택, empty space and List/Grid are one surface)', () => {
  it('a drag starting on the title / empty space closes it; one starting on List/Grid is captured too', async () => {
    const onClose = jest.fn();
    const renderer = render(<CategoryPickerModal {...baseProps} collectionPool={[]} onClose={onClose} onToggle={jest.fn()} selectedIds={new Set()} />);
    const header = renderedSheetHeader(renderer, 'category-picker-drag-area');
    expectOneDragSurface(header, i18n.t('collections.selectTitle'));
    expect(header.actions.findAllByType(ViewModeToggle)).toHaveLength(1);

    dragSheet(header.area.props, { from: 'header', dy: 160, durationMs: 600 });
    await settleSheet();
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());

    const onClose2 = jest.fn();
    const renderer2 = render(<CategoryPickerModal {...baseProps} collectionPool={[]} onClose={onClose2} onToggle={jest.fn()} selectedIds={new Set()} />);
    expect(dragSheet(renderedSheetHeader(renderer2, 'category-picker-drag-area').area.props, { from: 'control', dy: 160, durationMs: 600 })).toBe(true);
    await settleSheet();
    expect(onClose2).toHaveBeenCalledTimes(1);
    act(() => renderer2.unmount());
  });
});
