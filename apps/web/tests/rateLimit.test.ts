import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createAppApi, ApiHttpError, AuthExpiredError } from '../lib/appApi.ts';
import { RequestCooldown, retryAfterSeconds } from '../lib/retryAfter.ts';
import { PublicRateLimitError, getPublicCollection, getPublicCollectionItems } from '../lib/publicApi.ts';

for (const method of ['GET', 'POST', 'PUT', 'DELETE'] as const) {
  it(`Web ${method} does not replay 429, refresh auth, or send repeated requests before Retry-After`, async () => {
    let calls = 0;
    const refreshes: boolean[] = [];
    const api = createAppApi({ apiBaseUrl: 'https://api.test',
      getAccessToken: async ({ forceRefresh }) => { refreshes.push(forceRefresh); return 'session-a'; },
      fetchImpl: async () => { calls++; return Response.json({ code: 'rateLimited' }, { status: 429, headers: { 'Retry-After': '60' } }); },
    });
    for (let i = 0; i < 5; i++) {
      await assert.rejects(api({ method, path: '/limited' }), error => error instanceof ApiHttpError && error.status === 429 && error.retryAfterSeconds === 60);
    }
    assert.equal(calls, 1);
    assert.equal(refreshes.includes(true), false);
  });
}

it('Web cooldown handles dates, independent operations and changed sessions', () => {
  const now = Date.parse('2026-10-21T00:00:00Z');
  assert.equal(retryAfterSeconds('Wed, 21 Oct 2026 00:01:00 GMT', now), 60);
  assert.equal(retryAfterSeconds('invalid'), 2);
  const gate = new RequestCooldown();
  gate.defer('a', 'POST', '/api/v1/items/123/images?q=private', 60);
  assert.equal(gate.remaining('a', 'POST', '/api/v1/items/456/images'), 60);
  assert.equal(gate.remaining('a', 'GET', '/api/v1/items'), 0);
  assert.equal(gate.remaining('b', 'POST', '/api/v1/items/123/images'), 0);
});

it('Web keeps the same account cooldown across refreshed JWTs and ignores stale account responses', () => {
  const token = (oid: string, signature: string) => `header.${Buffer.from(JSON.stringify({ tid: '11111111-1111-1111-1111-111111111111', oid, name: '한글' })).toString('base64url')}.${signature}`;
  const first = token('22222222-2222-2222-2222-222222222222', 'old');
  const refreshed = token('22222222-2222-2222-2222-222222222222', 'new');
  const other = token('33333333-3333-3333-3333-333333333333', 'other');
  const gate = new RequestCooldown();
  gate.defer(first, 'GET', '/items', 60);
  assert.equal(gate.remaining(refreshed, 'GET', '/items'), 60);
  assert.equal(gate.remaining(other, 'GET', '/items'), 0);
  gate.defer(other, 'GET', '/items', 30);
  gate.defer(first, 'GET', '/items', 120);
  assert.equal(gate.remaining(other, 'GET', '/items'), 30);
});

it('Public reads expose a typed 429 without treating it as not found or an expired grant', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 429, headers: { 'Retry-After': '20' } }); };
  try {
    await assert.rejects(getPublicCollection('https://api.test', 'public-id'), error => error instanceof PublicRateLimitError && error.retryAfterSeconds === 20);
    await assert.rejects(getPublicCollectionItems('https://api.test', 'public-id'), PublicRateLimitError);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

it('Web recovers after Retry-After and permits logout cleanup, logout and another account', async t => {
  let now = Date.parse('2026-10-21T00:00:00Z');
  t.mock.method(Date, 'now', () => now);
  let token: string | null = 'account-a';
  let calls = 0;
  const refreshes: boolean[] = [];
  const api = createAppApi({ apiBaseUrl: 'https://api.test',
    getAccessToken: async ({ forceRefresh }) => { refreshes.push(forceRefresh); return token; },
    fetchImpl: async () => {
      calls++;
      return calls === 1 ? new Response(null, { status: 429, headers: { 'Retry-After': '2' } }) : new Response(null, { status: 204 });
    },
  });
  await assert.rejects(api({ method: 'PUT', path: '/push-devices/device' }), ApiHttpError);
  await assert.rejects(api({ method: 'PUT', path: '/push-devices/device' }), ApiHttpError);
  assert.equal(calls, 1);
  now += 2000;
  await api({ method: 'PUT', path: '/push-devices/device' });
  await api({ method: 'DELETE', path: '/push-devices/device' });
  token = null;
  await assert.rejects(api({ path: '/home' }), AuthExpiredError);
  token = 'account-b';
  await api({ method: 'PUT', path: '/push-devices/device' });
  assert.equal(calls, 4);
  assert.equal(refreshes.includes(true), false);
});
