import { ApiError } from '../ApiError';
import { requestApi } from '../apiClient';

jest.mock('../apiConfig', () => ({
  apiConfig: { baseUrl: 'https://api.test' },
}));

describe('requestApi transport retry (GET only, transport failures only)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('retries a GET request once on transport failure and resolves once the server responds', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ ok: true }),
      } as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const promise = requestApi({ method: 'GET', path: '/x' });
    await jest.advanceTimersByTimeAsync(2_000);

    await expect(promise).resolves.toEqual({ status: 200, body: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after a bounded number of retries (2 attempts total) and throws (never hangs indefinitely)', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('network error'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const promise = requestApi({ method: 'GET', path: '/x' });
    await Promise.all([
      expect(promise).rejects.toBeInstanceOf(ApiError),
      jest.advanceTimersByTimeAsync(2_000),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bounds the total automatic wait to ~17s worst case (2 attempts * 8s timeout + 1s backoff)', async () => {
    // A fetch that never settles on its own - only reacts to the AbortSignal, exactly like a real
    // hung connection would once apiClient.ts's own per-attempt timer aborts it.
    const fetchMock = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const abortError = new Error('The operation was aborted.');
            abortError.name = 'AbortError';
            reject(abortError);
          });
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    let settled = false;
    const promise = requestApi({ method: 'GET', path: '/x' });
    promise.catch(() => {
      settled = true;
    });

    // 1ms short of the full worst-case budget (8s + 1s + 8s): still waiting on the second attempt.
    await jest.advanceTimersByTimeAsync(16_999);
    expect(settled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Crossing the 17s mark fires the second attempt's own timeout and the request finally gives up.
    await jest.advanceTimersByTimeAsync(1);
    await expect(promise).rejects.toMatchObject({ kind: 'timeout' });
    expect(settled).toBe(true);
  });

  it('does not retry a POST request on transport failure (avoids duplicating a possible write)', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('network error'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      requestApi({ method: 'POST', path: '/x', body: {} }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry once any real HTTP response is received, even for GET (a 500 is a genuine server error, not a transport failure)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ status: 500 } as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(requestApi({ method: 'GET', path: '/x' })).rejects.toMatchObject({
      kind: 'unavailable',
      status: 500,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never retries a 401/403 response (auth errors are not transport failures)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ status: 401 } as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(requestApi({ method: 'GET', path: '/x' })).rejects.toMatchObject({
      kind: 'unauthorized',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
