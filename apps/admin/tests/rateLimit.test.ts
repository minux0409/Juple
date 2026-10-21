import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createAdminApi, ApiHttpError } from '../lib/adminApi.ts';

it('Admin honors Retry-After without repeating requests or refreshing credentials', async () => {
  let calls = 0;
  const refreshes: boolean[] = [];
  const api = createAdminApi({ apiBaseUrl: 'https://api.test',
    getAccessToken: async ({ forceRefresh }) => { refreshes.push(forceRefresh); return 'session-a'; },
    fetchImpl: async () => { calls++; return new Response(null, { status: 429, headers: { 'Retry-After': '60' } }); },
  });
  for (let i = 0; i < 5; i++) await assert.rejects(api({ path: '/api/v1/admin/me' }), error => error instanceof ApiHttpError && error.status === 429 && error.retryAfterSeconds === 60);
  assert.equal(calls, 1);
  assert.equal(refreshes.includes(true), false);
});

it('Admin dashboard requests recover after cooldown and a different account is not blocked', async t => {
  let now = Date.parse('2026-10-21T00:00:00Z');
  t.mock.method(Date, 'now', () => now);
  let token = 'admin-a';
  let calls = 0;
  const api = createAdminApi({ apiBaseUrl: 'https://api.test',
    getAccessToken: async () => token,
    fetchImpl: async () => {
      calls++;
      return calls === 1 ? new Response(null, { status: 429, headers: { 'Retry-After': '2' } }) : new Response(null, { status: 204 });
    },
  });
  await assert.rejects(api({ path: '/api/v1/admin/analytics' }), ApiHttpError);
  await assert.rejects(api({ path: '/api/v1/admin/analytics' }), ApiHttpError);
  assert.equal(calls, 1);
  now += 2000;
  await api({ path: '/api/v1/admin/analytics' });
  token = 'admin-b';
  await Promise.all(Array.from({ length: 10 }, () => api({ path: '/api/v1/admin/dashboard' })));
  assert.equal(calls, 12);
});
