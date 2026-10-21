import { createApiClient, requestApi } from '../apiClient';
import { requestAuthenticatedApi } from '../authenticatedApiClient';
import { getValidAccessToken } from '../../auth/session/authSessionManager';
import { Buffer } from 'buffer';
import { RequestCooldown, retryAfterSeconds } from '../retryAfter';

jest.mock('../apiConfig', () => ({ apiConfig: { baseUrl: 'https://api.test' } }));
jest.mock('../../auth/session/authSessionManager', () => ({ getValidAccessToken: jest.fn() }));
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; jest.useRealTimers(); });

describe('rate limit handling shared by Android and iOS', () => {
  it.each(['GET', 'POST', 'PUT', 'DELETE'] as const)('%s respects Retry-After without auth refresh or duplicate writes', async method => {
    jest.useFakeTimers();
    const response = { status: 429, headers: { get: () => '60' }, json: async () => ({ code: 'rateLimited' }) };
    const fetchMock = jest.fn().mockResolvedValue(response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const request = { method, path: `/limited/${method}`, accessToken: 'test-session' };
    await expect(requestApi(request)).rejects.toMatchObject({ kind: 'tooManyRequests', status: 429, retryAfterSeconds: 60 });
    await Promise.all(Array.from({ length: 10 }, () => expect(requestApi(request)).rejects.toMatchObject({ kind: 'tooManyRequests' })));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60_000);
    fetchMock.mockResolvedValue({ status: 204 });
    await expect(requestApi(request)).resolves.toEqual({ status: 204 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('accepts delta seconds and HTTP dates and safely falls back for malformed headers', () => {
    expect(retryAfterSeconds('12')).toBe(12);
    const now = Date.parse('2026-10-21T00:00:00Z');
    expect(retryAfterSeconds('Wed, 21 Oct 2026 00:01:00 GMT', now)).toBe(60);
    expect(retryAfterSeconds('invalid', now)).toBe(2);
    expect(retryAfterSeconds(undefined)).toBe(2);
    expect(retryAfterSeconds('0')).toBe(1);
  });

  it('does not block a different operation or a different account/session', () => {
    const cooldown = new RequestCooldown();
    cooldown.defer('session-a', 'POST', '/api/v1/items/123/images?secret=not-retained', 60);
    expect(cooldown.remaining('session-a', 'POST', '/api/v1/items/456/images')).toBe(60);
    expect(cooldown.remaining('session-a', 'GET', '/api/v1/items')).toBe(0);
    expect(cooldown.remaining('session-b', 'POST', '/api/v1/items/456/images')).toBe(0);
  });

  it('keeps Retry-After through token refresh and ignores a previous account response', () => {
    const token = (oid: string, signature: string) => `header.${Buffer.from(JSON.stringify({ tid: '11111111-1111-1111-1111-111111111111', oid, name: '한글' })).toString('base64url')}.${signature}`;
    const first = token('22222222-2222-2222-2222-222222222222', 'old');
    const refreshed = token('22222222-2222-2222-2222-222222222222', 'new');
    const other = token('33333333-3333-3333-3333-333333333333', 'other');
    const gate = new RequestCooldown();
    gate.defer(first, 'GET', '/items', 60);
    expect(gate.remaining(refreshed, 'GET', '/items')).toBe(60);
    expect(gate.remaining(other, 'GET', '/items')).toBe(0);
    gate.defer(other, 'GET', '/items', 30);
    gate.defer(first, 'GET', '/items', 120);
    expect(gate.remaining(other, 'GET', '/items')).toBe(30);
  });

  it('429 does not force authentication refresh and still permits logout cleanup and a different account', async () => {
    const tokenSource = jest.mocked(getValidAccessToken).mockReset().mockResolvedValue('auth-account-a');
    const fetchMock = jest.fn().mockResolvedValueOnce({ status: 429, headers: { get: () => '60' }, json: async () => ({ code: 'rateLimited' }) })
      .mockResolvedValue({ status: 204 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(requestAuthenticatedApi({ method: 'PUT', path: '/api/v1/push-devices/device' })).rejects.toMatchObject({ kind: 'tooManyRequests' });
    expect(tokenSource).toHaveBeenCalledTimes(1);
    expect(tokenSource).toHaveBeenCalledWith();
    await expect(requestAuthenticatedApi({ method: 'DELETE', path: '/api/v1/push-devices/device' })).resolves.toEqual({ status: 204 });
    tokenSource.mockResolvedValue('auth-account-b');
    await expect(requestAuthenticatedApi({ method: 'PUT', path: '/api/v1/push-devices/device' })).resolves.toEqual({ status: 204 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('upload timeout aborts its fetch without a cooldown or duplicate write, then manual retry can succeed', async () => {
    jest.useFakeTimers();
    const client = createApiClient();
    const fetchMock = jest.fn().mockImplementationOnce((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
    })).mockResolvedValue({ status: 204 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const request = { method: 'POST' as const, path: '/api/v1/items/1/images', accessToken: 'upload-session', timeoutMs: 1000 };
    const failure = client(request).catch(error => error);
    await jest.advanceTimersByTimeAsync(1000);
    expect(await failure).toMatchObject({ kind: 'timeout' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(client(request)).resolves.toEqual({ status: 204 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
