import ReactTestRenderer, { act } from 'react-test-renderer';
import '../../i18n';
import { CategoryPickerModal } from '../CategoryPickerModal';
import { CheckIcon } from '../../icons/CheckIcon';
import type { Collection } from '../api/collectionsApi';

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
