import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import '../../i18n';
import { SwipeableItemRow } from '../../components/SwipeableItemRow';
import { closeOpenRow } from '../../components/swipeableRowCoordinator';
import { getCollections, type Collection, type GetCollectionsOptions } from '../api/collectionsApi';
import { useCategoryPickerModal, type UseCategoryPickerModalResult } from '../useCategoryPickerModal';

jest.mock('../api/collectionsApi', () => ({
  ...jest.requireActual('../api/collectionsApi'),
  getCollections: jest.fn(),
  createCollection: jest.fn(),
}));

jest.mock('../../categories/collectionShortcutSync', () => ({
  reconcileCollectionShortcuts: jest.fn().mockResolvedValue(undefined),
}));

function makeCollection(id: number, overrides: Partial<Collection> = {}): Collection {
  return {
    id,
    name: `C${id}`,
    isFavorite: false,
    itemCount: 0,
    createdAtUtc: '2026-01-01T00:00:00Z',
    updatedAtUtc: '2026-01-01T00:00:00Z',
    icon: 'Folder',
    color: null,
    ...overrides,
  };
}

describe('SwipeableItemRow without a delete action (Contributor / another member\'s link)', () => {
  afterEach(() => closeOpenRow());

  it('offers share only - no delete button and no delete accessibility action', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <SwipeableItemRow onPress={jest.fn()} onShare={jest.fn()}>
          <Text>Row</Text>
        </SwipeableItemRow>,
      );
    });

    const content = renderer.root.findAll(node => Array.isArray(node.props.accessibilityActions))[0];
    expect(content.props.accessibilityActions.map((action: { name: string }) => action.name)).toEqual(['share']);

    await act(async () => {
      content.props.onResponderGrant({
        touchHistory: { touchBank: [], numberActiveTouches: 0, indexOfSingleActiveTouch: -1, mostRecentTimeStamp: 0 },
        nativeEvent: {},
      });
    });
    const labels = renderer.root.findAll(node => node.props.accessibilityRole === 'button').map(node => node.props.accessibilityLabel);
    expect(labels).not.toContain('삭제');
    expect(labels).not.toContain('Delete');
  });
});

describe('useCategoryPickerModal - owned Categories first, then shared ones', () => {
  let hook!: UseCategoryPickerModalResult;

  function Harness() {
    hook = useCategoryPickerModal(jest.fn() as never, ((key: string) => key) as never);
    return null;
  }

  afterEach(() => jest.clearAllMocks());

  it('appends Categories shared with me after the owned ones, so a Contributor can add their link there', async () => {
    jest.mocked(getCollections).mockImplementation(async (_request, options: GetCollectionsOptions = {}) =>
      options.scope === 'shared'
        ? { items: [makeCollection(9, { accessRole: 'contributor' })], nextCursor: null }
        : { items: [makeCollection(1, { accessRole: 'owner' })], nextCursor: null });

    await act(async () => {
      ReactTestRenderer.create(<Harness />);
    });
    await act(async () => {
      await hook.open();
    });

    expect(hook.collectionPool.map(collection => collection.id)).toEqual([1, 9]);
  });

  it('finishes paging owned Categories before starting the shared list', async () => {
    jest.mocked(getCollections)
      .mockResolvedValueOnce({ items: [makeCollection(1)], nextCursor: 'owned-2' })
      .mockResolvedValueOnce({ items: [makeCollection(2)], nextCursor: null })
      .mockResolvedValueOnce({ items: [makeCollection(9, { accessRole: 'contributor' })], nextCursor: null });

    await act(async () => {
      ReactTestRenderer.create(<Harness />);
    });
    await act(async () => {
      await hook.open();
    });
    expect(hook.collectionPool.map(collection => collection.id)).toEqual([1]);

    await act(async () => {
      hook.loadMore();
    });
    await act(async () => {
      hook.loadMore();
    });

    expect(hook.collectionPool.map(collection => collection.id)).toEqual([1, 2, 9]);
    const scopes = jest.mocked(getCollections).mock.calls.map(([, options]) => options?.scope);
    expect(scopes).toEqual([undefined, undefined, 'shared']);
  });
});
