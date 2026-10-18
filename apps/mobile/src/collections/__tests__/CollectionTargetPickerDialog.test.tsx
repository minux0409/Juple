import ReactTestRenderer, { act } from 'react-test-renderer';
import i18n from '../../i18n';
import { CollectionTargetPickerDialog } from '../CollectionTargetPickerDialog';
import type { Collection } from '../api/collectionsApi';
import { spacing } from '../../theme/tokens';
import { dragSheet, settleSheet } from '../../testing/sheetGestureDriver';
import { StyleSheet } from 'react-native';

// A non-zero, distinctive bottom inset (matches a typical Android gesture-nav inset) - if this
// value isn't reflected in the rendered padding, the test below would still pass with a 0 mock,
// which is exactly the bug this component's own fix addresses.
const MOCK_BOTTOM_INSET = 34;
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));

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

/**
 * Shared by Add/Move/Merge target selection (CollectionDetailsScreen's targetMode all render this
 * exact same component instance) - a single test here covers all three modes, since the fix lives
 * in the component itself, not per-caller wiring (see CollectionDetailsScreen's own existing
 * add/move/merge tests, which already exercise the real flows through this component).
 */
describe('CollectionTargetPickerDialog', () => {
  it("pads its bottom-anchored card's Cancel row past the Android system navigation inset, not just its own base padding", () => {
    const renderer = render(
      <CollectionTargetPickerDialog
        collections={[makeCollection()]}
        isLoading={false}
        isLoadingMore={false}
        onCancel={jest.fn()}
        onLoadMore={jest.fn()}
        onSelect={jest.fn()}
        visible
      />,
    );

    const cardWithInsetPadding = renderer.root.findAll(
      node =>
        Array.isArray(node.props.style)
        && node.props.style.some(
          (part: unknown) => part !== null && typeof part === 'object' && 'paddingBottom' in part,
        ),
    )[0];
    const insetStyle = cardWithInsetPadding.props.style.find(
      (part: unknown) => part !== null && typeof part === 'object' && 'paddingBottom' in part,
    );
    expect(insetStyle.paddingBottom).toBe(spacing.xl + MOCK_BOTTOM_INSET);

    // The Cancel button itself must actually be reachable/pressable - not just visually clear of
    // the inset.
    const cancelButton = renderer.root.findByProps({ accessibilityLabel: i18n.t('common.cancel') });
    expect(typeof cancelButton.props.onPress).toBe('function');
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

describe('CollectionTargetPickerDialog - the shared handle', () => {
  it('handle shown with the title; a downward drag cancels like 취소 (onCancel)', async () => {
    const onCancel = jest.fn();
    const renderer = render(
      <CollectionTargetPickerDialog collections={[makeCollection()]} isLoading={false} isLoadingMore={false} onCancel={onCancel} onLoadMore={jest.fn()} onSelect={jest.fn()} visible />,
    );
    expect(hasHandle(renderer)).toBe(true);
    const area = headerArea(renderer, 'collection-target-drag-area');
    expect(area.props.collapsable).toBe(false);
    expect(headerTexts(area).length).toBeGreaterThan(0); // the title
    // A short drag from the title snaps back.
    dragSheet(sheetDragArea(renderer, 'collection-target-drag-area'), { dy: 30, durationMs: 600 });
    await settleSheet();
    expect(onCancel).not.toHaveBeenCalled();
    dragSheet(sheetDragArea(renderer, 'collection-target-drag-area'), { dy: 160, durationMs: 600 });
    await settleSheet();
    expect(onCancel).toHaveBeenCalledTimes(1);
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

describe('CollectionTargetPickerDialog - the shared drag header', () => {
  it('the title is in the header; a drag starting on it / the empty space closes it', async () => {
    const onCancel = jest.fn();
    const renderer = render(
      <CollectionTargetPickerDialog collections={[makeCollection()]} isLoading={false} isLoadingMore={false} onCancel={onCancel} onLoadMore={jest.fn()} onSelect={jest.fn()} visible />,
    );
    const header = renderedSheetHeader(renderer, 'collection-target-drag-area');
    expectOneDragSurface(header, i18n.t('collections.targetPickerTitle'));
    dragSheet(header.area.props, { from: 'header', dy: 160, durationMs: 600 });
    await settleSheet();
    expect(onCancel).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });
});

describe('CollectionTargetPickerDialog - List | Grid', () => {
  const collections = [makeCollection({ id: 11, name: 'Alpha' }), makeCollection({ id: 12, name: 'Beta' })];
  const mount = (onSelect = jest.fn()) =>
    render(
      <CollectionTargetPickerDialog collections={collections} isLoading={false} isLoadingMore={false} onCancel={jest.fn()} onLoadMore={jest.fn()} onSelect={onSelect} visible />,
    );
  const toggleButton = (renderer: ReactTestRenderer.ReactTestRenderer, label: string) =>
    renderer.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
  const tile = (renderer: ReactTestRenderer.ReactTestRenderer, name: string) =>
    renderer.root.findAll(node => node.props.accessibilityLabel === name && typeof node.props.onPress === 'function')[0];

  it('offers the shared List / Grid toggle with the selected mode exposed, switching shows the same Collections in either layout', async () => {
    const renderer = mount();
    await act(async () => undefined);
    const list = toggleButton(renderer, i18n.t('common.viewList'));
    const grid = toggleButton(renderer, i18n.t('common.viewGrid'));
    expect(list.props.accessibilityRole).toBe('button');
    expect(grid.props.accessibilityRole).toBe('button');
    // Either way every Collection is listed once, with its name as the accessible label.
    for (const mode of [grid, list]) {
      act(() => mode.props.onPress());
      expect(tile(renderer, 'Alpha')).toBeTruthy();
      expect(tile(renderer, 'Beta')).toBeTruthy();
    }
    expect(toggleButton(renderer, i18n.t('common.viewList')).props.accessibilityState).toEqual({ selected: true });
    act(() => toggleButton(renderer, i18n.t('common.viewGrid')).props.onPress());
    expect(toggleButton(renderer, i18n.t('common.viewGrid')).props.accessibilityState).toEqual({ selected: true });
    expect(toggleButton(renderer, i18n.t('common.viewList')).props.accessibilityState).toEqual({ selected: false });
    act(() => renderer.unmount());
  });

  it('a tap picks that Collection at once in both layouts (the merge flow continues from onSelect, unchanged)', async () => {
    const onSelect = jest.fn();
    const renderer = mount(onSelect);
    await act(async () => undefined);
    act(() => toggleButton(renderer, i18n.t('common.viewGrid')).props.onPress());
    act(() => tile(renderer, 'Beta').props.onPress());
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 12 }));
    act(() => toggleButton(renderer, i18n.t('common.viewList')).props.onPress());
    act(() => tile(renderer, 'Alpha').props.onPress());
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 11 }));
    act(() => renderer.unmount());
  });
});

describe('CollectionTargetPickerDialog - default view', () => {
  it('opens as the List it always was (the Grid is an option, not the new default); a stored choice would win', async () => {
    const renderer = render(
      <CollectionTargetPickerDialog collections={[makeCollection({ id: 21, name: 'Gamma' })]} isLoading={false} isLoadingMore={false} onCancel={jest.fn()} onLoadMore={jest.fn()} onSelect={jest.fn()} visible />,
    );
    await act(async () => undefined);
    const selected = (label: string) => renderer.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0].props.accessibilityState;
    expect(selected(i18n.t('common.viewList'))).toEqual({ selected: true });
    expect(selected(i18n.t('common.viewGrid'))).toEqual({ selected: false });
    act(() => renderer.unmount());
  });
});
