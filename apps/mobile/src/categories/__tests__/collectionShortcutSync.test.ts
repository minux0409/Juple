import { reconcileCollectionShortcuts } from '../collectionShortcutSync';
import { getCollections, type Collection } from '../../collections/api/collectionsApi';
import NativeIncomingShare from '../../share/specs/NativeIncomingShare';
import { collectionVisual } from '../../shortcuts/CollectionShortcutService';

jest.mock('../../collections/api/collectionsApi', () => ({
  getCollections: jest.fn(),
}));

jest.mock('../../share/specs/NativeIncomingShare', () => ({
  __esModule: true,
  default: {
    getPinnedCollectionShortcuts: jest.fn(),
    setPinnedCollectionShortcuts: jest.fn(),
    getMaxPinnedCollectionShortcuts: jest.fn(),
    clearPinnedCollectionShortcuts: jest.fn(),
  },
}));

const native = NativeIncomingShare!;

function makeCollection(overrides: Partial<Collection>): Collection {
  return {
    id: 1,
    name: 'Collection',
    isFavorite: false,
    itemCount: 0,
    createdAtUtc: '2026-01-01T00:00:00Z',
    updatedAtUtc: '2026-01-01T00:00:00Z',
    icon: 'Folder',
    color: null,
    ...overrides,
  };
}

/** The id and name of each stored entry - the visual fields have their own tests. */
const idName = (entries: readonly { id: number; name: string }[]) => entries.map(({ id, name }) => ({ id, name }));

/** A stored entry exactly as the app writes it for this Collection (name + the visual recipe of its card). */
const entryFor = (collection: Collection) => {
  const visual = collectionVisual(collection);
  return { id: collection.id, name: collection.name, iconKey: visual.iconKey, tileColor: visual.tileColor, glyphColor: visual.glyphColor, imageVersion: visual.imageVersion };
};
const sent = () => JSON.parse(jest.mocked(native.setPinnedCollectionShortcuts).mock.calls[0][0]);

describe('reconcileCollectionShortcuts (reconciling the Collections the user pinned as app shortcuts)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // A queued once-value from a previous test must not leak into the next.
    jest.mocked(getCollections).mockReset();
    jest.mocked(native.setPinnedCollectionShortcuts).mockResolvedValue(undefined);
  });

  it('with nothing pinned it makes no request at all - and never publishes a Collection nobody chose', async () => {
    jest.mocked(native.getPinnedCollectionShortcuts).mockResolvedValue([]);

    await reconcileCollectionShortcuts(jest.fn());

    expect(getCollections).not.toHaveBeenCalled();
    expect(native.setPinnedCollectionShortcuts).not.toHaveBeenCalled();
  });

  it('renames a pinned shortcut to the Collection\'s current name, and leaves an unchanged set alone', async () => {
    jest.mocked(native.getPinnedCollectionShortcuts).mockResolvedValue([{ id: 1, name: 'Old name' }]);
    jest.mocked(getCollections).mockResolvedValue({ items: [makeCollection({ id: 1, name: 'New name' })], nextCursor: null });

    await reconcileCollectionShortcuts(jest.fn());
    expect(idName(sent())).toEqual([{ id: 1, name: 'New name' }]);

    jest.clearAllMocks();
    jest.mocked(native.getPinnedCollectionShortcuts).mockResolvedValue([entryFor(makeCollection({ id: 1, name: 'New name' }))]);
    await reconcileCollectionShortcuts(jest.fn());
    expect(native.setPinnedCollectionShortcuts).not.toHaveBeenCalled();
  });

  it('an entry stored without the icon recipe (an older build) is upgraded in place, so its share row gets the picture of the Collection', async () => {
    jest.mocked(native.getPinnedCollectionShortcuts).mockResolvedValue([{ id: 1, name: 'Same name' }]);
    jest.mocked(getCollections).mockResolvedValue({ items: [makeCollection({ id: 1, name: 'Same name', icon: 'Travel', color: 'Mint' })], nextCursor: null });

    await reconcileCollectionShortcuts(jest.fn());

    expect(sent()[0]).toEqual(expect.objectContaining({ id: 1, iconKey: 'Travel', tileColor: '#EAF5EE', glyphColor: '#5C9878' }));
  });

  it('a NEW photo version is passed along once with its link (the link is only for preparing the photo); the same version is not written again', async () => {
    const withPhoto = makeCollection({ id: 1, name: 'Pics', iconImageUrl: 'https://blob.test/p?sig=1', iconImageVersion: 'v2' });
    jest.mocked(native.getPinnedCollectionShortcuts).mockResolvedValue([{ ...entryFor(makeCollection({ id: 1, name: 'Pics' })) }]);
    jest.mocked(getCollections).mockResolvedValue({ items: [withPhoto], nextCursor: null });

    await reconcileCollectionShortcuts(jest.fn());
    expect(sent()[0]).toEqual(expect.objectContaining({ imageVersion: 'v2', imageUrl: 'https://blob.test/p?sig=1' }));

    jest.clearAllMocks();
    jest.mocked(native.getPinnedCollectionShortcuts).mockResolvedValue([{ ...entryFor(withPhoto) }]);
    await reconcileCollectionShortcuts(jest.fn());
    expect(native.setPinnedCollectionShortcuts).not.toHaveBeenCalled();
  });

  it('removes a pinned Collection that was deleted, left or revoked (no longer reachable at all)', async () => {
    jest.mocked(native.getPinnedCollectionShortcuts).mockResolvedValue([{ id: 1, name: 'Kept' }, { id: 2, name: 'Gone' }]);
    jest.mocked(getCollections).mockResolvedValue({ items: [makeCollection({ id: 1, name: 'Kept' })], nextCursor: null });

    await reconcileCollectionShortcuts(jest.fn());

    expect(idName(sent())).toEqual([{ id: 1, name: 'Kept' }]);
  });

  it('removes a pinned Collection that is now locked, behind an access password, or read-only (its name must not show outside Juple)', async () => {
    jest.mocked(native.getPinnedCollectionShortcuts).mockResolvedValue([
      { id: 1, name: 'Locked now' },
      { id: 2, name: 'Password now' },
      { id: 3, name: 'Viewer now' },
      { id: 4, name: 'Fine' },
    ]);
    jest.mocked(getCollections).mockResolvedValue({
      items: [
        makeCollection({ id: 1, name: 'Locked now', isLocked: true }),
        makeCollection({ id: 2, name: 'Password now', accessRole: 'contributor', isSharePasswordProtected: true }),
        makeCollection({ id: 3, name: 'Viewer now', accessRole: 'viewer' }),
        makeCollection({ id: 4, name: 'Fine', accessRole: 'contributor' }),
      ],
      nextCursor: null,
    });

    await reconcileCollectionShortcuts(jest.fn());

    expect(idName(sent())).toEqual([{ id: 4, name: 'Fine' }]);
  });

  it('walks pages only until every pinned Collection has been seen - never one request per Collection', async () => {
    jest.mocked(native.getPinnedCollectionShortcuts).mockResolvedValue([entryFor(makeCollection({ id: 2, name: 'Two' }))]);
    jest
      .mocked(getCollections)
      .mockResolvedValueOnce({ items: [makeCollection({ id: 1, name: 'One' })], nextCursor: 'c2' })
      .mockResolvedValueOnce({ items: [makeCollection({ id: 2, name: 'Two' })], nextCursor: 'c3' })
      .mockResolvedValueOnce({ items: [makeCollection({ id: 3, name: 'Three' })], nextCursor: null });

    await reconcileCollectionShortcuts(jest.fn());

    expect(getCollections).toHaveBeenCalledTimes(2);
    expect(jest.mocked(getCollections).mock.calls.every(([, options]) => options?.scope === 'all')).toBe(true);
    expect(native.setPinnedCollectionShortcuts).not.toHaveBeenCalled();
  });

  it('a failed request leaves every shortcut exactly as it was - a flaky network never removes the user\'s choices', async () => {
    jest.mocked(native.getPinnedCollectionShortcuts).mockResolvedValue([{ id: 1, name: 'One' }]);
    jest.mocked(getCollections).mockRejectedValue(new Error('offline'));

    await expect(reconcileCollectionShortcuts(jest.fn())).rejects.toThrow('offline');

    expect(native.setPinnedCollectionShortcuts).not.toHaveBeenCalled();
  });
});
