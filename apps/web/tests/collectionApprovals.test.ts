import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiHttpError, type AppApi } from '../lib/appApi.ts';
import { answerJoinRequest, answerLinkSubmission, cancelMySubmission, loadLinkSubmissions, ownerRequestCollections } from '../lib/collectionApprovals.ts';
import { nextUnreadPollDelayMs, UNREAD_POLL_INTERVAL_MS, UNREAD_POLL_MAX_INTERVAL_MS } from '../lib/notificationState.ts';

const recording = (respond: (request: { method?: string; path: string }) => unknown) => {
  const calls: string[] = [];
  const api = (async (request: { method?: string; path: string }) => {
    calls.push(`${request.method ?? 'GET'} ${request.path}`);
    const result = respond(request);
    if (result instanceof Error) throw result;
    return result;
  }) as AppApi;
  return { api, calls };
};

describe('received requests (Owner)', () => {
  it('only my own Collections with something waiting are listed, with links and join requests added', () => {
    const rows = ownerRequestCollections([
      { id: 1, name: 'A', icon: 'Folder', color: null, itemCount: 0, isFavorite: false, accessRole: 'owner', pendingSubmissionCount: 2, pendingJoinRequestCount: 1 },
      { id: 2, name: 'B', icon: 'Folder', color: null, itemCount: 0, isFavorite: false, accessRole: 'owner' },
      { id: 3, name: 'C', icon: 'Folder', color: null, itemCount: 0, isFavorite: false, accessRole: 'contributor', pendingSubmissionCount: 9 },
    ]);
    assert.deepEqual(rows.map(row => [row.id, row.requestCount]), [[1, 3]]);
    assert.deepEqual(ownerRequestCollections(null), []);
  });

  it('approving is a POST and rejecting a DELETE on the existing endpoints; join requests POST approve / reject', async () => {
    const { api, calls } = recording(() => undefined);
    assert.equal(await answerLinkSubmission(api, 5, 7, true), 'done');
    assert.equal(await answerLinkSubmission(api, 5, 7, false), 'done');
    assert.equal(await answerJoinRequest(api, 5, 8, true), 'done');
    assert.equal(await answerJoinRequest(api, 5, 8, false), 'done');
    assert.deepEqual(calls, [
      'POST /api/v1/collections/5/submissions/7/approve',
      'DELETE /api/v1/collections/5/submissions/7',
      'POST /api/v1/collections/5/join-requests/8/approve',
      'POST /api/v1/collections/5/join-requests/8/reject',
    ]);
  });

  it('a request that was already answered (404 / 409) is "gone", never a failure; any other error is thrown', async () => {
    for (const status of [404, 409]) {
      const { api } = recording(() => new ApiHttpError(status, null));
      assert.equal(await answerLinkSubmission(api, 1, 2, true), 'gone');
      assert.equal(await answerJoinRequest(api, 1, 2, false), 'gone');
      assert.equal(await cancelMySubmission(api, 3), 'gone');
    }
    const { api } = recording(() => new ApiHttpError(403, null));
    await assert.rejects(answerLinkSubmission(api, 1, 2, true));
  });

  it('every page of the queue is read (once each) so the list agrees with the badge', async () => {
    const { api, calls } = recording(request => request.path.endsWith('submissions')
      ? { items: [{ submissionId: 1 }], nextCursor: 2 }
      : request.path.endsWith('cursor=2') ? { items: [{ submissionId: 2 }], nextCursor: 3 } : { items: [{ submissionId: 3 }], nextCursor: null });
    const rows = await loadLinkSubmissions(api, 9);
    assert.deepEqual(rows.map(row => row.submissionId), [1, 2, 3]);
    assert.equal(calls.length, 3);
  });
});

describe('Web badge refresh without a push channel', () => {
  it('polls at the base interval and backs off per consecutive failure up to the cap (no 429 storm)', () => {
    assert.equal(nextUnreadPollDelayMs(0), UNREAD_POLL_INTERVAL_MS);
    assert.equal(nextUnreadPollDelayMs(1), UNREAD_POLL_INTERVAL_MS * 2);
    assert.equal(nextUnreadPollDelayMs(2), UNREAD_POLL_INTERVAL_MS * 4);
    assert.equal(nextUnreadPollDelayMs(50), UNREAD_POLL_MAX_INTERVAL_MS);
    assert.equal(nextUnreadPollDelayMs(-3), UNREAD_POLL_INTERVAL_MS);
  });
});
