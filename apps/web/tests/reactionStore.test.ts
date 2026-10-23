import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { clearReactionStore, publishReactions, reactionKey, readReactions, subscribeReactions } from '../lib/reactionStore.ts';
import { lastUnreadRetryAfterSeconds, refreshUnreadCount } from '../lib/notificationState.ts';
import { ApiHttpError } from '../lib/appApi.ts';

afterEach(() => clearReactionStore());

describe('reaction store (a link card and its detail share one value)', () => {
  it('a tap in one reader is seen by the other at once; an equal value notifies nobody', () => {
    const key = reactionKey(10, 2);
    let notified = 0;
    const stop = subscribeReactions(() => { notified += 1; });
    publishReactions(key, { reactions: [{ key: 'heart', count: 1 }], myReaction: null });
    publishReactions(key, { reactions: [{ key: 'heart', count: 1 }], myReaction: null });
    assert.equal(notified, 1);
    publishReactions(key, { reactions: [{ key: 'heart', count: 2 }], myReaction: 'heart' });
    assert.equal(notified, 2);
    assert.deepEqual(readReactions(key), { reactions: [{ key: 'heart', count: 2 }], myReaction: 'heart' });
    stop();
  });

  it('keys are per Collection AND link, and the store is empty after the account ends', () => {
    publishReactions(reactionKey(10, 2), { reactions: [{ key: 'heart', count: 1 }], myReaction: null });
    assert.equal(readReactions(reactionKey(11, 2)), undefined);
    clearReactionStore();
    assert.equal(readReactions(reactionKey(10, 2)), undefined);
  });
});

describe('bell poll and Retry-After', () => {
  it('a 429 keeps its Retry-After for the next wait, and a good read forgets it', async () => {
    assert.equal(await refreshUnreadCount(() => Promise.reject(new ApiHttpError(429, null, 90))), false);
    assert.equal(lastUnreadRetryAfterSeconds(), 90);
    assert.equal(await refreshUnreadCount(() => Promise.resolve(3)), true);
    assert.equal(lastUnreadRetryAfterSeconds(), 0);
  });
});
