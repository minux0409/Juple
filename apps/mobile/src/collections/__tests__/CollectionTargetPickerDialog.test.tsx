import ReactTestRenderer, { act } from 'react-test-renderer';
import i18n from '../../i18n';
import { CollectionTargetPickerDialog } from '../CollectionTargetPickerDialog';
import type { Collection } from '../api/collectionsApi';
import { spacing } from '../../theme/tokens';

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
