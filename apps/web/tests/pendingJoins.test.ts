import assert from 'node:assert/strict';
import { it } from 'node:test';
import { loadPendingJoins, cancelPendingJoin, filterPendingJoins } from '../lib/pendingJoins.ts';
import type { AppApi } from '../lib/appApi.ts';
it('loads the same real mine endpoint as mobile and cancels only one request', async () => {
  const calls: unknown[] = [];
  const item = { requestId: 9, publicId: 'pub', name: 'Trip', color: null, icon: 'Folder' };
  const api = (async (request: unknown) => { calls.push(request); return { items: [item] }; }) as AppApi;
  assert.deepEqual(await loadPendingJoins(api), [item]);
  await cancelPendingJoin(api, 9);
  assert.deepEqual(calls, [{ path: '/api/v1/collections/join-requests/mine' }, { method: 'DELETE', path: '/api/v1/collections/join-requests/mine/9' }]);
  assert.deepEqual(filterPendingJoins([item], 'trip'), [item]);
  assert.deepEqual(filterPendingJoins([item], 'absent'), []);
});
it('does not turn failed cancellation into success', async () => {
  const api = (async () => { throw new Error('offline'); }) as AppApi;
  await assert.rejects(cancelPendingJoin(api, 9), /offline/);
});
