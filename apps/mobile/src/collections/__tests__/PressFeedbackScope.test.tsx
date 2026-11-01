import type { ReactNode } from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';
import { CategoryField } from '../CategoryField';
import { CollectionChoiceGrid } from '../CollectionChoiceGrid';
import { PressedShape } from '../../components/PressedShape';
import { colors, minTouchTarget, radii } from '../../theme/tokens';
import type { Collection } from '../api/collectionsApi';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
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

function render(element: ReactNode) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(element as React.ReactElement);
  });
  return renderer;
}

/** What a control's children draw while it is held (or not), rendered in a throwaway tree. */
function drawn(control: ReactTestRenderer.ReactTestInstance, pressed: boolean) {
  const children = typeof control.props.children === 'function' ? control.props.children({ pressed, hovered: false }) : control.props.children;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<View>{children}</View>);
  });
  return tree.root;
}

const shapesOf = (root: ReactTestRenderer.ReactTestInstance) => root.findAll(node => node.props.testID === 'press-feedback-shape' && typeof node.type === 'string');
/** The nearest real (host) view above a node - past the PressedShape component itself. */
function hostParent(node: ReactTestRenderer.ReactTestInstance) {
  let current = node.parent;
  while (current && typeof current.type !== 'string') {
    current = current.parent;
  }
  return current!;
}
const controlOf = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];

const baseProps = {
  isLoadingOptions: false,
  isLoadingMore: false,
  onLoadMore: jest.fn(),
  onOpenCreateDialog: jest.fn(),
  onToggle: jest.fn(),
  selectedIds: new Set<number>([1]),
  noneTile: { label: '컬렉션 없음', isSelected: false, onPress: jest.fn() },
  viewModeKey: 'categoryPickerViewMode' as const,
};

describe('a press shows on the icon only - never on the whole cell or row that holds it', () => {
  it('PressedShape draws nothing at rest and, held, one non-touchable layer in the icon\'s own shape', () => {
    const rest = render(<PressedShape borderRadius={14} pressed={false} />);
    expect(shapesOf(rest.root)).toHaveLength(0);

    const held = render(<PressedShape borderRadius={14} pressed />);
    const [shape] = shapesOf(held.root);
    expect(shape.props.pointerEvents).toBe('none');
    expect(StyleSheet.flatten(shape.props.style)).toMatchObject({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 14, backgroundColor: colors.pressedOverlay });

    const strong = render(<PressedShape borderRadius={22} pressed strong />);
    expect(StyleSheet.flatten(shapesOf(strong.root)[0].props.style).backgroundColor).toBe(colors.pressedOverlayStrong);
  });

  it('컬렉션 변경 grid: the whole cell stays the one touch target, but a held cell shows its press on the 48pt icon tile only (a collection and the 컬렉션 없음 tile)', () => {
    const renderer = render(<CollectionChoiceGrid {...baseProps} collectionPool={[makeCollection()]} />);

    for (const testID of ['category-picker-option-1', 'category-picker-none']) {
      const cell = controlOf(renderer, testID);
      // The control keeps its own onPress (the full cell) and opts out of the default whole-cell layer...
      expect(cell.props.pressFeedback).toBe(false);
      expect(typeof cell.props.onPress).toBe('function');
      // ...and nothing shows at rest, one icon-shaped layer shows while held.
      expect(shapesOf(drawn(cell, false))).toHaveLength(0);
      const [shape] = shapesOf(drawn(cell, true));
      expect(StyleSheet.flatten(shape.props.style)).toMatchObject({ borderRadius: radii.md + 6 });
      // Its parent is the icon slot (the tile's own box) - not the cell and not the label.
      expect(StyleSheet.flatten(hostParent(shape).props.style)).toMatchObject({ position: 'relative' });
    }
    // The selection is the corner check badge, never a tint of the cell.
    expect(renderer.root.findAll(node => node.props.testID === 'category-picker-selected-1').length).toBeGreaterThan(0);
  });

  it('컬렉션 변경 list: a row is meant to be pressed as a whole - it keeps the app Pressable\'s own whole-row layer and draws no icon-only one', () => {
    const renderer = render(<CollectionChoiceGrid {...baseProps} collectionPool={[makeCollection()]} defaultViewMode="list" />);

    const row = controlOf(renderer, 'category-picker-option-1');
    expect(row.props.pressFeedback).toBeUndefined();
    expect(shapesOf(drawn(row, true))).toHaveLength(0);
  });

  it('상세 컬렉션 행: the whole row still opens the picker, but a held row shows its press on the pencil button only (a 44pt round layer) - not the chips or the empty text', () => {
    const onPress = jest.fn();
    const withChips = render(<CategoryField error={null} isLoading={false} onPress={onPress} selectedCollections={[makeCollection({ id: 5, name: 'Music' })]} />);
    const empty = render(<CategoryField error={null} isLoading={false} onPress={onPress} selectedCollections={[]} />);

    for (const renderer of [withChips, empty]) {
      const row = renderer.root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function')[0];
      expect(row.props.pressFeedback).toBe(false);
      act(() => row.props.onPress());
      expect(shapesOf(drawn(row, false))).toHaveLength(0);
      const [shape] = shapesOf(drawn(row, true));
      expect(StyleSheet.flatten(shape.props.style)).toMatchObject({ borderRadius: minTouchTarget / 2, backgroundColor: colors.pressedOverlayStrong });
      // The layer's parent is the pencil's own 44pt box.
      expect(StyleSheet.flatten(hostParent(shape).props.style)).toMatchObject({ minHeight: minTouchTarget, minWidth: minTouchTarget });
    }
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});
