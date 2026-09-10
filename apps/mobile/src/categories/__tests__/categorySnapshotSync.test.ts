import { syncCategorySnapshotToNative } from '../categorySnapshotSync';
import { getCollections, type Collection } from '../../collections/api/collectionsApi';
import NativeIncomingShare from '../../share/specs/NativeIncomingShare';

jest.mock('../../collections/api/collectionsApi', () => ({
  getCollections: jest.fn(),
}));

jest.mock('../../share/specs/NativeIncomingShare', () => ({
  __esModule: true,
  default: {
    setCategorySnapshot: jest.fn(),
  },
}));

function makeCollection(overrides: Partial<Collection>): Collection {
  return {
    id: 1,
    name: 'Collection',
    isFavorite: false,
    itemCount: 0,
    createdAtUtc: '2026-01-01T00:00:00Z',
    updatedAtUtc: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('syncCategorySnapshotToNative', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends favorites first, then most-recently-updated, as a JSON string', async () => {
    const stale = makeCollection({ id: 1, name: 'Stale', isFavorite: false, updatedAtUtc: '2026-01-01T00:00:00Z' });
    const recent = makeCollection({ id: 2, name: 'Recent', isFavorite: false, updatedAtUtc: '2026-01-03T00:00:00Z' });
    const favorite = makeCollection({ id: 3, name: 'Favorite', isFavorite: true, updatedAtUtc: '2026-01-02T00:00:00Z' });
    jest.mocked(getCollections).mockResolvedValue({ items: [stale, recent, favorite], nextCursor: null });

    await syncCategorySnapshotToNative(jest.fn());

    const sentJson = jest.mocked(NativeIncomingShare!.setCategorySnapshot).mock.calls[0][0];
    expect(JSON.parse(sentJson)).toEqual([
      { id: 3, name: 'Favorite', isFavorite: true },
      { id: 2, name: 'Recent', isFavorite: false },
      { id: 1, name: 'Stale', isFavorite: false },
    ]);
  });

  it('walks every page rather than only the first', async () => {
    const page1 = makeCollection({ id: 1, name: 'Page 1' });
    const page2 = makeCollection({ id: 2, name: 'Page 2' });
    jest
      .mocked(getCollections)
      .mockResolvedValueOnce({ items: [page1], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: [page2], nextCursor: null });

    await syncCategorySnapshotToNative(jest.fn());

    expect(getCollections).toHaveBeenCalledTimes(2);
    const sentJson = jest.mocked(NativeIncomingShare!.setCategorySnapshot).mock.calls[0][0];
    expect(JSON.parse(sentJson)).toHaveLength(2);
  });
});
