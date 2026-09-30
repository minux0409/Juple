import ReactTestRenderer, { act } from 'react-test-renderer';
import i18n from '../../i18n';
import { CategoryPickerModal } from '../CategoryPickerModal';
import { CheckIcon } from '../../icons/CheckIcon';
import { KeyIcon } from '../../icons/KeyIcon';
import type { Collection } from '../api/collectionsApi';
import { clearCollectionUnlockGrants } from '../collectionUnlockGrants';

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
