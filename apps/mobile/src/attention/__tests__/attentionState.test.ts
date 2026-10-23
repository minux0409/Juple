import { attentionCounts, createAttentionStore, loadAttentionCollections } from '../attentionState';
import { ApiError } from '../../api/ApiError';

const pending = [{ invitationId: 1 }, { invitationId: 2 }];
const requests = [{ requestId: 1, direction: 'incoming' }, { requestId: 2, direction: 'outgoing' }];
const collections = [{ id: 1, isFavorite: true, accessRole: 'owner', hasCollaborators: true, attentionCount: 3, unreadNewLinkCount: 1 }];

describe('Mobile attention state (same policy as Web)', () => {
  it('deduplicates invitations, tasks and overlapping filters; sent requests do not count', () => {
    const result = attentionCounts([...pending, ...pending], requests, [...collections, ...collections]);
    expect(result.collections).toBe(5);
    expect(result.types).toEqual({ favorites: 3, all: 3, owned: 3, shared: 5 });
    expect(result.myPage).toBe(1);
    expect(result.home + result.archive).toBe(0);
  });
  it('keeps tasks when notification read receipts clear new-link indicators', async () => {
    const store = createAttentionStore({ invitations: async () => pending, friends: async () => requests, collections: async () => collections });
    await store.refresh();
    store.newLinksRead(1);
    expect(store.getSnapshot().counts.collections).toBe(4);
    expect(store.getSnapshot().counts.friends).toBe(1);
    store.removeInvitation(1);
    store.removeFriendRequest(1);
    expect(store.getSnapshot().counts.collections).toBe(3);
    expect(store.getSnapshot().counts.myPage).toBe(0);
  });
  it('shares in-flight requests and caches page focus refreshes', async () => {
    const load = jest.fn(async () => pending);
    const store = createAttentionStore({ invitations: load, friends: async () => requests, collections: async () => collections });
    await Promise.all([store.read('invitations'), store.read('invitations')]);
    await store.read('invitations');
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('honors 429 Retry-After without timers, keeping existing counts', async () => {
    let time = 1000;
    let fail = false;
    const load = jest.fn(async () => { if (fail) throw new ApiError('tooManyRequests', 429, undefined, 120); return pending; });
    const store = createAttentionStore({ invitations: load, friends: async () => requests, collections: async () => collections }, () => time);
    await store.read('invitations');
    fail = true;
    await expect(store.read('invitations', true)).rejects.toHaveProperty('status', 429);
    await expect(store.read('friends', true)).rejects.toBeDefined();
    expect(store.getSnapshot().counts.collections).toBe(2);
    time += 119_000;
    await expect(store.read('invitations', true)).rejects.toBeDefined();
    expect(load).toHaveBeenCalledTimes(2);
    fail = false;
    time += 1000;
    await store.read('invitations', true);
    expect(load).toHaveBeenCalledTimes(3);
  });
  it('does not let a late account A response repopulate the cleared session', async () => {
    let resolve!: (value: typeof pending) => void;
    const store = createAttentionStore({ invitations: () => new Promise<typeof pending>(done => { resolve = done; }), friends: async () => requests, collections: async () => collections });
    const first = store.read('invitations');
    const failure = expect(first).rejects.toThrow();
    await Promise.resolve();
    store.reset();
    resolve(pending);
    await failure;
    expect(store.getSnapshot().counts.collections).toBe(0);
    expect(store.getSnapshot().invitations).toBeNull();
  });
  it('loads all existing collection metadata pages rather than reporting a first-page total', async () => {
    let page = 0;
    const all = await loadAttentionCollections(async () => ++page === 1 ? { items: collections, nextCursor: '2' } : { items: [{ ...collections[0], id: 2, attentionCount: 4 }], nextCursor: null });
    expect(attentionCounts([], [], all).collections).toBe(7);
  });
});
