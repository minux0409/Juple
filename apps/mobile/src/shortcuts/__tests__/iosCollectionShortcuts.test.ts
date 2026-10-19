import type { Collection } from '../../collections/api/collectionsApi';
import NativeCollectionShortcutsIOS from '../../share/specs/NativeCollectionShortcutsIOS';
import { IOS_SHORTCUT_MAX_CHOICES, iosCollectionShortcuts } from '../iosCollectionShortcuts';

let mockStored = '[]';
jest.mock('../../share/specs/NativeCollectionShortcutsIOS', () => ({
  __esModule: true,
  default: {
    getShortcutCollections: jest.fn(async () => mockStored),
    setShortcutCollections: jest.fn(async (json: string) => { mockStored = json; }),
    clearShortcutCollections: jest.fn(async () => { mockStored = '[]'; }),
  },
}));

const collection = (id: number, name: string, isLocked = false) => ({ id, name, isLocked }) as unknown as Collection;
const stored = () => JSON.parse(mockStored);

beforeEach(() => {
  mockStored = '[]';
  jest.clearAllMocks();
});

describe('iosCollectionShortcuts', () => {
  it('adds only what the person chose, id and name only; adding again just refreshes the name', async () => {
    expect(await iosCollectionShortcuts.add(collection(1, 'Trips'))).toEqual({ status: 'added' });
    expect(await iosCollectionShortcuts.add(collection(1, 'Trips 2026'))).toEqual({ status: 'added' });
    expect(stored()).toEqual([{ id: 1, name: 'Trips 2026' }]);
  });

  it('never offers a locked Collection (its name would show outside Juple)', async () => {
    expect(await iosCollectionShortcuts.add(collection(1, 'Secret', true))).toEqual({ status: 'locked' });
    expect(NativeCollectionShortcutsIOS!.setShortcutCollections).not.toHaveBeenCalled();
  });

  it('stops at the native limit', async () => {
    mockStored = JSON.stringify(Array.from({ length: IOS_SHORTCUT_MAX_CHOICES }, (_, index) => ({ id: index + 1, name: `C${index}` })));
    expect(await iosCollectionShortcuts.add(collection(999, 'One more'))).toEqual({ status: 'limit', max: IOS_SHORTCUT_MAX_CHOICES });
  });

  it('known Collections: a rename follows, a now-locked one is removed, an unseen one is left alone', async () => {
    mockStored = JSON.stringify([{ id: 1, name: 'Old' }, { id: 2, name: 'Will lock' }, { id: 3, name: 'Unseen' }]);
    await iosCollectionShortcuts.applyKnownCollections([collection(1, 'New'), collection(2, 'Will lock', true)]);
    expect(stored()).toEqual([{ id: 1, name: 'New' }, { id: 3, name: 'Unseen' }]);
  });

  it('a complete view removes a judged Collection that is gone, and keeps one that was not judged', async () => {
    mockStored = JSON.stringify([{ id: 1, name: 'Kept' }, { id: 2, name: 'Deleted' }, { id: 3, name: 'Added meanwhile' }]);
    await iosCollectionShortcuts.applyAuthoritativeCollections([collection(1, 'Kept')], new Set([1, 2]));
    expect(stored()).toEqual([{ id: 1, name: 'Kept' }, { id: 3, name: 'Added meanwhile' }]);
  });

  it('sign-out clears everything natively', async () => {
    mockStored = JSON.stringify([{ id: 1, name: 'Trips' }]);
    await iosCollectionShortcuts.clear();
    expect(NativeCollectionShortcutsIOS!.clearShortcutCollections).toHaveBeenCalledTimes(1);
    expect(stored()).toEqual([]);
  });

  it('a malformed stored value reads as empty instead of failing', async () => {
    mockStored = 'not json';
    expect(await iosCollectionShortcuts.getChoices()).toEqual([]);
  });
});
