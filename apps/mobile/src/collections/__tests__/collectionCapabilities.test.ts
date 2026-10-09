import type { Collection } from '../api/collectionsApi';
import { getCollectionCapabilities } from '../collectionCapabilities';
import { getShortcutIneligibility } from '../../shortcuts/collectionShortcutEligibility';

const collection = (overrides: Partial<Collection> = {}): Collection => ({
  id: 1,
  name: 'C',
  isFavorite: false,
  itemCount: 0,
  createdAtUtc: '2026-01-01T00:00:00Z',
  updatedAtUtc: '2026-01-01T00:00:00Z',
  icon: 'Folder',
  color: null,
  ...overrides,
});

describe('getCollectionCapabilities - the one role matrix', () => {
  it('Owner: edits, locks and deletes; never leaves; adds links; no notifications while private', () => {
    expect(getCollectionCapabilities(collection({ accessRole: 'owner' }))).toEqual({
      isOwner: true,
      canEdit: true,
      canDelete: true,
      canLeave: false,
      canChangeLock: true,
      canAddItem: true,
      canToggleFavorite: true,
      canToggleNotification: false,
      canPinShortcut: true,
    });
  });

  it('a Collection with no accessRole (older fixtures) reads as owned', () => {
    expect(getCollectionCapabilities(collection()).isOwner).toBe(true);
  });

  it('Owner of a Collection with members gets 새 링크 알림', () => {
    expect(getCollectionCapabilities(collection({ accessRole: 'owner', hasCollaborators: true })).canToggleNotification).toBe(true);
    expect(getCollectionCapabilities(collection({ accessRole: 'owner', isPublicShareActive: true })).canToggleNotification).toBe(true);
  });

  it.each(['contributor', 'submitter', 'viewer'] as const)('%s: leaves (never deletes), cannot edit or change the lock, has favorite and notifications', accessRole => {
    const capabilities = getCollectionCapabilities(collection({ accessRole }));
    expect(capabilities).toEqual(expect.objectContaining({
      isOwner: false,
      canEdit: false,
      canDelete: false,
      canLeave: true,
      canChangeLock: false,
      canToggleFavorite: true,
      canToggleNotification: true,
    }));
  });

  it('adding links: Owner, Contributor and Submitter (as proposals) - never a Viewer', () => {
    expect(getCollectionCapabilities(collection({ accessRole: 'contributor' })).canAddItem).toBe(true);
    expect(getCollectionCapabilities(collection({ accessRole: 'submitter' })).canAddItem).toBe(true);
    expect(getCollectionCapabilities(collection({ accessRole: 'viewer' })).canAddItem).toBe(false);
  });

  it('Delete and Leave are mutually exclusive for every role', () => {
    for (const accessRole of [undefined, 'owner', 'contributor', 'submitter', 'viewer'] as const) {
      const capabilities = getCollectionCapabilities(collection({ accessRole }));
      expect(capabilities.canDelete && capabilities.canLeave).toBe(false);
      expect(capabilities.canDelete || capabilities.canLeave).toBe(true);
    }
  });

  it('a shortcut destination must be writable and not behind a lock or an access password', () => {
    expect(getCollectionCapabilities(collection({ isLocked: true })).canPinShortcut).toBe(false);
    expect(getCollectionCapabilities(collection({ accessRole: 'contributor', isSharePasswordProtected: true })).canPinShortcut).toBe(false);
    expect(getCollectionCapabilities(collection({ accessRole: 'viewer' })).canPinShortcut).toBe(false);
    expect(getCollectionCapabilities(collection({ accessRole: 'contributor' })).canPinShortcut).toBe(true);
  });

  it('says why a Collection is not a shortcut destination', () => {
    expect(getShortcutIneligibility(collection({ accessRole: 'viewer' }))).toBe('cannotAdd');
    expect(getShortcutIneligibility(collection({ isLocked: true }))).toBe('locked');
    expect(getShortcutIneligibility(collection())).toBeNull();
  });
});
