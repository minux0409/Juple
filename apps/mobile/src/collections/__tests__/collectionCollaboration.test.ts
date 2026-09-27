import { formatJupleId } from '../api/collaborationApi';
import { inviteCollaborator, removeCollaborator, revokeCollectionInvitation } from '../api/collaborationApi';
import {
  addItemToCollection,
  COLLECTION_UNLOCK_HEADER,
  deleteCollection,
  enableCollectionShare,
  renameCollection,
  revokeCollectionShare,
  setCollectionColor,
  setCollectionIcon,
  mergeCollection,
  moveCollectionItem,
  removeItemFromCollection,
} from '../api/collectionsApi';
import { isCollaborative, isCollectionLocked, isSharedWithMe, needsUnlockForContent } from '../collectionAccess';
import {
  clearCollectionUnlockGrants,
  forgetCollectionUnlock,
  getCollectionUnlockToken,
  beginCollectionVisit,
  rememberCollectionUnlock,
} from '../collectionUnlockGrants';

describe('collection access readers (always the server-provided accessRole, never inferred)', () => {
  it('treats only an explicit contributor role as shared-with-me', () => {
    expect(isSharedWithMe({ accessRole: 'contributor' })).toBe(true);
    expect(isSharedWithMe({ accessRole: 'owner' })).toBe(false);
    expect(isSharedWithMe({})).toBe(false); // older payloads read as owned
  });

  it('marks a Collection collaborative when shared with me, or when I own it and it has collaborators', () => {
    expect(isCollaborative({ accessRole: 'contributor' })).toBe(true);
    expect(isCollaborative({ accessRole: 'owner', hasCollaborators: true })).toBe(true);
    expect(isCollaborative({ accessRole: 'owner', hasCollaborators: false })).toBe(false);
  });

  it('reads the lock flag strictly', () => {
    expect(isCollectionLocked({ isLocked: true })).toBe(true);
    expect(isCollectionLocked({ isLocked: false })).toBe(false);
    expect(isCollectionLocked({})).toBe(false);
  });
});

describe('Juple ID display', () => {
  it('shows an 8-character ID as XXXX-XXXX and leaves anything else untouched', () => {
    expect(formatJupleId('K7MP4Q8N')).toBe('K7MP-4Q8N');
    expect(formatJupleId('SHORT')).toBe('SHORT');
  });
});

describe('in-memory unlock grants', () => {
  const now = Date.parse('2026-09-26T00:00:00Z');

  afterEach(() => clearCollectionUnlockGrants());

  it('returns a stored grant until shortly before it expires, then forgets it', () => {
    rememberCollectionUnlock(5, 'grant-5', '2026-09-26T00:15:00Z');

    expect(getCollectionUnlockToken(5, now)).toBe('grant-5');
    expect(getCollectionUnlockToken(5, now + 14 * 60_000)).toBe('grant-5');
    // Treated as expired 30s early so a request never races the server-side expiry.
    expect(getCollectionUnlockToken(5, now + 14 * 60_000 + 31_000)).toBeNull();
    expect(getCollectionUnlockToken(5, now)).toBeNull();
  });

  it('keeps grants per Collection and can drop one explicitly', () => {
    rememberCollectionUnlock(5, 'grant-5', '2026-09-26T00:15:00Z');
    rememberCollectionUnlock(6, 'grant-6', '2026-09-26T00:15:00Z');

    forgetCollectionUnlock(5);

    expect(getCollectionUnlockToken(5, now)).toBeNull();
    expect(getCollectionUnlockToken(6, now)).toBe('grant-6');
    expect(getCollectionUnlockToken(7, now)).toBeNull();
  });
});

describe('content changes carry the unlock grants of this session', () => {
  const later = () => new Date(Date.now() + 10 * 60_000).toISOString();
  const request = jest.fn(async () => ({ status: 200, body: { undoOperationId: null } }));

  afterEach(() => {
    clearCollectionUnlockGrants();
    request.mockClear();
  });

  function headersOfCall(index: number): Readonly<Record<string, string>> | undefined {
    return (request.mock.calls[index] as unknown as [{ headers?: Readonly<Record<string, string>> }])[0].headers;
  }

  it('sends no grant header for a Collection that was never unlocked', async () => {
    await addItemToCollection(request as never, 1, 99);
    expect(headersOfCall(0)).toBeUndefined();
  });

  it('attaches the stored grant to add/remove/reorder, and every involved grant to a merge', async () => {
    rememberCollectionUnlock(1, 'grant-1', later());
    rememberCollectionUnlock(2, 'grant-2', later());

    await addItemToCollection(request as never, 1, 99);
    await removeItemFromCollection(request as never, 1, 99);
    await moveCollectionItem(request as never, 1, 99, null);
    await mergeCollection(request as never, 1, 2);

    for (const index of [0, 1, 2]) {
      expect(headersOfCall(index)).toEqual({ [COLLECTION_UNLOCK_HEADER]: 'grant-1' });
    }
    expect(headersOfCall(3)).toEqual({ [COLLECTION_UNLOCK_HEADER]: 'grant-1,grant-2' });
  });

  it('managing a locked Collection (rename/icon/color/delete/share/collaboration) carries its grant too', async () => {
    rememberCollectionUnlock(1, 'grant-1', later());
    const managementRequest = jest.fn(async () => ({
      status: 200,
      body: { id: 1, publicId: 'p', shareUrl: 'u', invitationId: 1, jupleId: 'A', role: 'Contributor', createdAtUtc: '', expiresAtUtc: '' },
    }));
    const calls = [
      () => renameCollection(managementRequest as never, 1, 'x'),
      () => setCollectionIcon(managementRequest as never, 1, 'Folder'),
      () => setCollectionColor(managementRequest as never, 1, 'Mint'),
      () => deleteCollection(managementRequest as never, 1),
      () => enableCollectionShare(managementRequest as never, 1),
      () => revokeCollectionShare(managementRequest as never, 1),
      () => inviteCollaborator(managementRequest as never, 1, 'AAAA2345'),
      () => revokeCollectionInvitation(managementRequest as never, 1, 9),
      () => removeCollaborator(managementRequest as never, 1, 'AAAA2345'),
    ];
    for (const call of calls) {
      await call();
    }
    for (const [options] of managementRequest.mock.calls as unknown as [{ headers?: Record<string, string> }][]) {
      expect(options.headers).toEqual({ [COLLECTION_UNLOCK_HEADER]: 'grant-1' });
    }
    expect(managementRequest).toHaveBeenCalledTimes(calls.length);
  });

  it('treats a locked Collection as needing the password until it is unlocked', () => {
    expect(needsUnlockForContent({ id: 1, isLocked: true })).toBe(true);
    expect(needsUnlockForContent({ id: 1, isLocked: false })).toBe(false);
    rememberCollectionUnlock(1, 'grant-1', later());
    expect(needsUnlockForContent({ id: 1, isLocked: true })).toBe(false);
  });
});

describe('unlock grants last for one Collection visit', () => {
  const later = () => new Date(Date.now() + 10 * 60_000).toISOString();

  afterEach(() => clearCollectionUnlockGrants());

  it('are forgotten when the visit ends, and kept while it lasts', () => {
    const endVisit = beginCollectionVisit(1);
    rememberCollectionUnlock(1, 'grant-1', later());
    rememberCollectionUnlock(2, 'grant-2', later());
    expect(getCollectionUnlockToken(1)).toBe('grant-1');

    endVisit();
    expect(getCollectionUnlockToken(1)).toBeNull();
    // Only that Collection's grant goes.
    expect(getCollectionUnlockToken(2)).toBe('grant-2');
    endVisit(); // idempotent
  });

  it('a Collection open twice in the stack keeps its grant until both visits end', () => {
    const outer = beginCollectionVisit(1);
    const inner = beginCollectionVisit(1);
    rememberCollectionUnlock(1, 'grant-1', later());

    inner();
    expect(getCollectionUnlockToken(1)).toBe('grant-1');
    outer();
    expect(getCollectionUnlockToken(1)).toBeNull();
  });
});
