import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { attentionCounts, createAttentionStore, loadAttentionCollections, type AttentionCollection, type AttentionInvitation, type AttentionFriendRequest } from '../lib/attentionState.ts';
import { ApiHttpError } from '../lib/appApi.ts';
import { resetUnreadCount, setUnreadCount } from '../lib/notificationState.ts';

const invitations = [{ invitationId: 1 }, { invitationId: 2 }];
const friends = [{ requestId: 1, direction: 'incoming' }, { requestId: 2, direction: 'incoming' }, { requestId: 3, direction: 'incoming' }, { requestId: 4, direction: 'outgoing' }];
const collections: readonly AttentionCollection[] = [{ id: 1, isFavorite: true, accessRole: 'owner', hasCollaborators: true, attentionCount: 3, unreadNewLinkCount: 1 }];
const make = (loaders = { invitations: async () => invitations, friends: async () => friends, collections: async () => collections }, now?: () => number) => createAttentionStore<AttentionInvitation, AttentionFriendRequest, AttentionCollection>(loaders, now);

describe('cross-platform attention policy', () => {
  it('is the same portable implementation in Web and Mobile', () => {
    assert.equal(readFileSync(new URL('../lib/attentionState.ts', import.meta.url), 'utf8'), readFileSync(new URL('../../mobile/src/attention/attentionState.ts', import.meta.url), 'utf8'));
  });
  it('hides zero; invitations belong to shared and the collection parent, incoming friends to the account', () => {
    assert.deepEqual(attentionCounts([], [], []).types, { favorites: 0, all: 0, owned: 0, shared: 0 });
    const result = attentionCounts(invitations, friends, []);
    assert.equal(result.collections, 2);
    assert.equal(result.types.shared, 2);
    assert.equal(result.types.all, 0, 'an unaccepted collection is not a member of the all list');
    assert.equal(result.friends, 3);
    assert.equal(result.myPage, 3, 'a mirrored location, not a second event');
    assert.equal(result.home + result.archive, 0);
  });
  it('deduplicates records and never sums overlapping type tabs or notification unread totals', () => {
    const result = attentionCounts([...invitations, ...invitations], [...friends, ...friends], [...collections, ...collections]);
    assert.equal(result.collections, 5);
    assert.deepEqual(result.types, { favorites: 3, all: 3, owned: 3, shared: 5 });
    assert.equal(result.friends, 3);
  });
  it('keeps pending requests after reading notifications; only unread new links are removed', async () => {
    const store = make();
    await store.refresh();
    setUnreadCount(20);
    setUnreadCount(0);
    assert.equal(store.getSnapshot().counts.collections, 5);
    assert.equal(store.getSnapshot().counts.friends, 3);
    store.newLinksRead();
    assert.equal(store.getSnapshot().counts.collections, 4, 'two invitations plus two owner tasks remain');
    assert.equal(store.getSnapshot().counts.types.shared, 4);
    resetUnreadCount();
  });
  it('updates answer counts immediately, without affecting sent requests or other devices', async () => {
    const store = make();
    await store.refresh();
    store.removeInvitation(1);
    store.removeInvitation(1);
    store.removeFriendRequest(1);
    assert.equal(store.getSnapshot().counts.collections, 4);
    assert.equal(store.getSnapshot().counts.friends, 2);
    store.removeInvitation(2);
    assert.equal(store.getSnapshot().counts.types.shared, 3);
    store.collectionChanged({ ...collections[0], isFavorite: false });
    assert.equal(store.getSnapshot().counts.types.favorites, 0);
  });
});

describe('attention refresh, isolation and failure recovery', () => {
  it('does not replace an unknown full list with a single local mutation or issue a request queued before logout', async () => {
    let calls = 0;
    const store = make({ invitations: async () => { calls++; return invitations; }, friends: async () => friends, collections: async () => collections });
    store.removeInvitation(1);
    store.removeFriendRequest(1);
    assert.equal(store.getSnapshot().invitations, null);
    assert.equal(store.getSnapshot().friends, null);
    const queued = store.read('invitations');
    const rejected = assert.rejects(queued);
    store.reset();
    await rejected;
    assert.equal(calls, 0);
  });
  it('shares concurrent reads, caches for one minute and coalesces rapid push events', async () => {
    let calls = 0;
    let time = 1000;
    const store = make({ invitations: async () => { calls++; return invitations; }, friends: async () => friends, collections: async () => collections }, () => time);
    await Promise.all([store.read('invitations'), store.read('invitations'), store.read('invitations')]);
    assert.equal(calls, 1);
    await store.read('invitations');
    await store.refresh(['invitations'], true);
    assert.equal(calls, 1);
    time += 60_000;
    await store.read('invitations');
    assert.equal(calls, 2);
  });
  it('keeps known values during failures and updates independently successful resources', async () => {
    let fail = false;
    let time = 1000;
    const store = make({ invitations: async () => invitations, friends: async () => { if (fail) throw new Error('offline'); return friends; }, collections: async () => collections }, () => time);
    await store.refresh();
    fail = true;
    time += 60_000;
    await store.refresh();
    assert.equal(store.getSnapshot().counts.friends, 3);
    assert.equal(store.getSnapshot().counts.collections, 5);
    fail = false;
    time += 15_000;
    await store.read('friends');
    assert.equal(store.getSnapshot().counts.friends, 3);
  });
  it('respects Retry-After across all resources and never schedules a retry storm', async () => {
    let time = 1000;
    let friendCalls = 0;
    const error = new ApiHttpError(429, 'rateLimited', 90);
    const store = make({ invitations: async () => { throw error; }, friends: async () => { friendCalls++; return friends; }, collections: async () => [] }, () => time);
    await assert.rejects(store.read('invitations'), actual => actual === error);
    await assert.rejects(store.read('friends', true));
    time += 89_999;
    await assert.rejects(store.read('friends', true));
    assert.equal(friendCalls, 0);
    time++;
    await store.read('friends');
    assert.equal(friendCalls, 1);
  });
  it('clears the previous account immediately and rejects its late responses', async () => {
    let complete!: (rows: typeof invitations) => void;
    const store = make({ invitations: () => new Promise(resolve => { complete = resolve; }), friends: async () => [], collections: async () => [] });
    const pending = store.read('invitations');
    const rejected = assert.rejects(pending);
    await Promise.resolve();
    store.reset();
    complete(invitations);
    await rejected;
    assert.equal(store.getSnapshot().counts.collections, 0);
    assert.equal(store.getSnapshot().invitations, null);
    const other = make();
    assert.equal(other.getSnapshot().counts.collections, 0);
  });
  it('does not resurrect an answered invitation from an older request', async () => {
    let complete!: (rows: typeof invitations) => void;
    let slow = false;
    const store = make({ invitations: () => slow ? new Promise(resolve => { complete = resolve; }) : Promise.resolve(invitations), friends: async () => [], collections: async () => [] });
    await store.read('invitations');
    slow = true;
    const older = store.read('invitations', true);
    await Promise.resolve();
    store.removeInvitation(1);
    complete(invitations);
    await older;
    assert.equal(store.getSnapshot().invitations?.length, 1);
    assert.equal(store.getSnapshot().counts.collections, 1);
  });
  it('sums every metadata page, deduplicates IDs, and rejects broken pagination', async () => {
    const paths: string[] = [];
    const rows = await loadAttentionCollections<AttentionCollection>(async path => {
      paths.push(path);
      return paths.length === 1 ? { items: collections, nextCursor: 'next cursor' } : { items: [...collections, { id: 2, isFavorite: false, accessRole: 'viewer', attentionCount: 4 }], nextCursor: null };
    });
    assert.equal(rows.length, 2);
    assert.equal(attentionCounts([], [], rows).collections, 7);
    assert.match(paths[1], /cursor=next%20cursor/);
    await assert.rejects(loadAttentionCollections(async () => ({ items: [], nextCursor: 'repeat' })), /Repeated attention cursor/);
  });
  it('does not continue pagination after account logout', async () => {
    let active = true;
    let calls = 0;
    await assert.rejects(loadAttentionCollections(async () => { calls++; active = false; return { items: collections, nextCursor: 'another' }; }, () => active), /cancelled/);
    assert.equal(calls, 1);
  });
});
