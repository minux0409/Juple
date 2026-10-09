import type { Collection } from '../../collections/api/collectionsApi';
import NativeIncomingShare, { type PinnedCollectionShortcut } from '../../share/specs/NativeIncomingShare';
import { collectionShortcutService, collectionVisual } from '../CollectionShortcutService';

// An in-memory stand-in for the device's pinned set, so the service's read-modify-write is really exercised.
let stored: PinnedCollectionShortcut[] = [];
let max = 4;

jest.mock('../../share/specs/NativeIncomingShare', () => ({
  __esModule: true,
  default: {
    getPinnedCollectionShortcuts: jest.fn(),
    setPinnedCollectionShortcuts: jest.fn(),
    getMaxPinnedCollectionShortcuts: jest.fn(),
    clearPinnedCollectionShortcuts: jest.fn(),
    isHomeShortcutSupported: jest.fn(),
    requestHomeShortcut: jest.fn(),
  },
}));

const native = NativeIncomingShare!;

const collection = (overrides: Partial<Collection> = {}): Collection => ({
  id: 1,
  name: 'Trips',
  isFavorite: false,
  itemCount: 0,
  createdAtUtc: '2026-01-01T00:00:00Z',
  updatedAtUtc: '2026-01-01T00:00:00Z',
  icon: 'Folder',
  color: null,
  ...overrides,
});

/** The id and name of each stored entry - the visual fields have their own tests. */
const idName = (entries: readonly { id: number; name: string }[]) => entries.map(({ id, name }) => ({ id, name }));

beforeEach(() => {
  stored = [];
  max = 4;
  jest.clearAllMocks();
  jest.mocked(native.getPinnedCollectionShortcuts).mockImplementation(async () => stored);
  jest.mocked(native.setPinnedCollectionShortcuts).mockImplementation(async json => { stored = JSON.parse(json); });
  jest.mocked(native.getMaxPinnedCollectionShortcuts).mockImplementation(async () => max);
  jest.mocked(native.clearPinnedCollectionShortcuts).mockImplementation(async () => { stored = []; });
  jest.mocked(native.isHomeShortcutSupported).mockResolvedValue(true);
  jest.mocked(native.requestHomeShortcut).mockResolvedValue('requested');
});

describe('collectionVisual - the Collection icon is drawn from the SAME fields its card is drawn from', () => {
  it('A. a Collection with its own photo: the photo (link + version) is part of the recipe, with its configured icon and color behind it', () => {
    const visual = collectionVisual(collection({ id: 3, icon: 'Travel', color: 'Mint', iconImageUrl: 'https://blob.test/p', iconImageVersion: 'v7' }));

    expect(visual).toEqual({ iconKey: 'Travel', tileColor: '#EAF5EE', glyphColor: '#5C9878', imageVersion: 'v7', imageUrl: 'https://blob.test/p' });
  });

  it('B. no photo: the configured icon on the configured color - the very tile its card shows', () => {
    expect(collectionVisual(collection({ icon: 'Music', color: 'Rose' }))).toEqual({
      iconKey: 'Music', tileColor: '#FBEDEE', glyphColor: '#B97278', imageVersion: null, imageUrl: null,
    });
  });

  it('a Collection without an explicit color uses the id-deterministic default tile of the card, never a random one', () => {
    expect(collectionVisual(collection({ id: 1, color: null })).tileColor).toBe(collectionVisual(collection({ id: 1, color: null })).tileColor);
    expect(collectionVisual(collection({ id: 1, color: null })).tileColor).not.toBe('');
  });

  it('a photo without a version (an older server) or a version without a link is not used - it could never be cached or refreshed correctly', () => {
    expect(collectionVisual(collection({ iconImageUrl: 'https://blob.test/p', iconImageVersion: null })).imageUrl).toBeNull();
    expect(collectionVisual(collection({ iconImageUrl: null, iconImageVersion: 'v1' })).imageVersion).toBeNull();
  });

  it('E. an unknown icon key is resolved exactly as the card resolves it (the default icon) - the native side then never sees an unknown key', () => {
    expect(collectionVisual(collection({ icon: 'FutureServerOnlyIcon' })).iconKey).toBe('Folder');
  });
});

describe('CollectionShortcutService - explicit, device-local pins', () => {
  it('is supported where the native module exists', () => {
    expect(collectionShortcutService.isSupported()).toBe(true);
  });

  describe('requestHomeShortcut - a real Home-screen icon, asked of the launcher', () => {
    const asked = () => jest.mocked(native.requestHomeShortcut).mock.calls;

    it('asks the launcher (its own system dialog) with the id, name and tile colors of the Collection - and does NOT mark it as a share target itself', async () => {
      const outcome = await collectionShortcutService.requestHomeShortcut(collection({ id: 4, name: 'Trips', color: 'Mint' }));

      expect(outcome).toEqual({ status: 'requested', shareable: true, lockedNotShared: false });
      expect(asked()).toEqual([[4, 'Trips', 'Folder', '#EAF5EE', '#5C9878', '', '', true]]);
      // Only the launcher's confirmation (native receiver) may add it to the share targets - tapping the entry never does.
      expect(native.setPinnedCollectionShortcuts).not.toHaveBeenCalled();
      expect(stored).toEqual([]);
    });

    it('a Collection without a color uses its deterministic tile; a custom color is used as given', async () => {
      await collectionShortcutService.requestHomeShortcut(collection({ id: 1, color: '#336699' }));

      expect(asked()[0].slice(3, 5)).toEqual(['#336699', '#001E51']);
    });

    it('a locked Collection still gets its icon (opening it asks for the password) but is never a share target', async () => {
      const outcome = await collectionShortcutService.requestHomeShortcut(collection({ isLocked: true }));

      expect(outcome).toEqual({ status: 'requested', shareable: false, lockedNotShared: true });
      expect(asked()[0][7]).toBe(false);
    });

    it('a read-only Collection gets its icon but is not a writable share destination; a Contributor and a Submitter are', async () => {
      expect(await collectionShortcutService.requestHomeShortcut(collection({ accessRole: 'viewer' }))).toEqual({ status: 'requested', shareable: false, lockedNotShared: false });
      expect((await collectionShortcutService.requestHomeShortcut(collection({ accessRole: 'contributor' }))).status).toBe('requested');
      expect(await collectionShortcutService.requestHomeShortcut(collection({ accessRole: 'submitter' }))).toEqual(expect.objectContaining({ shareable: true }));
    });

    it('at the platform limit a NEW share target is refused - nothing is requested and nothing the user chose is evicted', async () => {
      max = 2;
      stored = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];

      expect(await collectionShortcutService.requestHomeShortcut(collection({ id: 3 }))).toEqual({ status: 'limit', max: 2 });
      expect(native.requestHomeShortcut).not.toHaveBeenCalled();
      expect(stored.map(entry => entry.id)).toEqual([1, 2]);
      // One that is already a share target may get another icon.
      expect((await collectionShortcutService.requestHomeShortcut(collection({ id: 2 }))).status).toBe('requested');
      // A locked Collection takes no share-target slot, so the limit does not stop its icon.
      expect((await collectionShortcutService.requestHomeShortcut(collection({ id: 9, isLocked: true }))).status).toBe('requested');
    });

    it('a launcher that cannot pin is reported, and nothing is requested', async () => {
      jest.mocked(native.isHomeShortcutSupported).mockResolvedValue(false);

      expect(await collectionShortcutService.requestHomeShortcut(collection())).toEqual({ status: 'unsupported' });
      expect(await collectionShortcutService.isHomeShortcutSupported()).toBe(false);
      expect(native.requestHomeShortcut).not.toHaveBeenCalled();
    });

    it('a request the native side could not make is "unsupported", never a pretended success', async () => {
      jest.mocked(native.requestHomeShortcut).mockResolvedValue('unsupported');

      expect(await collectionShortcutService.requestHomeShortcut(collection())).toEqual({ status: 'unsupported' });
    });
  });

  it('unpin removes only that Collection from the share targets', async () => {
    stored = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];

    await collectionShortcutService.unpin(1);

    expect(idName(stored)).toEqual([{ id: 2, name: 'B' }]);
    await collectionShortcutService.unpin(99);
    expect(idName(stored)).toEqual([{ id: 2, name: 'B' }]);
  });

  it('a rename updates the shortcut label; a Collection that became locked or read-only is removed; an unknown one is left alone', async () => {
    stored = [{ id: 1, name: 'Old' }, { id: 2, name: 'Will lock' }, { id: 3, name: 'Will be viewer' }, { id: 4, name: 'Not loaded' }];

    await collectionShortcutService.applyKnownCollections([
      collection({ id: 1, name: 'New' }),
      collection({ id: 2, name: 'Will lock', isLocked: true }),
      collection({ id: 3, name: 'Will be viewer', accessRole: 'viewer' }),
    ]);

    expect(idName(stored)).toEqual([{ id: 1, name: 'New' }, { id: 4, name: 'Not loaded' }]);
  });

  it('with a complete view, a pinned Collection that is missing is gone - but one pinned meanwhile (not judged) survives', async () => {
    stored = [{ id: 1, name: 'Here' }, { id: 2, name: 'Deleted' }, { id: 9, name: 'Pinned meanwhile' }];

    await collectionShortcutService.applyAuthoritativeCollections([collection({ id: 1, name: 'Here' })], new Set([1, 2]));

    expect(idName(stored)).toEqual([{ id: 1, name: 'Here' }, { id: 9, name: 'Pinned meanwhile' }]);
  });

  it('clear() (sign-out / account change) removes everything, so another account never sees these names', async () => {
    stored = [{ id: 1, name: 'Private plans' }];

    await collectionShortcutService.clear();

    expect(stored).toEqual([]);
    expect(native.clearPinnedCollectionShortcuts).toHaveBeenCalledTimes(1);
  });

  it('two quick changes at once both survive (calls are serialized)', async () => {
    stored = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }];

    await Promise.all([
      collectionShortcutService.unpin(1),
      collectionShortcutService.applyKnownCollections([collection({ id: 2, name: 'B renamed' })]),
      collectionShortcutService.unpin(3),
    ]);

    expect(idName(stored)).toEqual([{ id: 2, name: 'B renamed' }]);
  });
});
