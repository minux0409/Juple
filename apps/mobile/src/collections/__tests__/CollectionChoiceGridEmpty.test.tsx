import ReactTestRenderer, { act } from 'react-test-renderer';
import { CollectionChoiceGrid } from '../CollectionChoiceGrid';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

/** A brand-new account has no Collections at all (nothing is created for it): the chooser still works, for the explicit "none" and for creating one. */
describe('CollectionChoiceGrid - an account with no Collections', () => {
  async function renderEmpty(onOpenCreateDialog = jest.fn(), onNone = jest.fn()) {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <CollectionChoiceGrid
          collectionPool={[]}
          isLoadingMore={false}
          isLoadingOptions={false}
          noneTile={{ label: '선택 안 함', isSelected: true, onPress: onNone }}
          onLoadMore={jest.fn()}
          onOpenCreateDialog={onOpenCreateDialog}
          onToggle={jest.fn()}
          selectedIds={new Set()}
          title="컬렉션"
        />,
      );
    });
    return { renderer, onOpenCreateDialog, onNone };
  }
  const press = async (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => {
    const target = renderer.root.findAll(candidate => candidate.props.testID === testID && typeof candidate.props.onPress === "function")[0];
    expect(target).toBeDefined();
    await act(async () => target.props.onPress());
  };

  it('offers "선택 안 함" (selected) and "+ 새로 만들기" and nothing else; both work', async () => {
    const { renderer, onOpenCreateDialog, onNone } = await renderEmpty();
    const tileIds = renderer.root.findAll(node => typeof node.props.testID === 'string' && node.props.testID.startsWith('category-picker-option-'));
    expect(tileIds).toHaveLength(0);
    await press(renderer, 'category-picker-create');
    expect(onOpenCreateDialog).toHaveBeenCalledTimes(1);
    await press(renderer, 'category-picker-none');
    expect(onNone).toHaveBeenCalledTimes(1);
  });
});
