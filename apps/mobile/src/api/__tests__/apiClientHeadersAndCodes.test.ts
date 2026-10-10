import { ApiError } from '../ApiError';
import { requestApi } from '../apiClient';
import { subscribeSubscriptionRequired } from '../../billing/subscriptionRequired';

jest.mock('../apiConfig', () => ({
  apiConfig: { baseUrl: 'https://api.test' },
}));

describe('requestApi extra headers and problem codes', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function respondWith(status: number, body?: unknown) {
    const fetchMock = jest.fn().mockResolvedValue({
      status,
      json: async () => body,
    } as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it('a 403 subscriptionRequired is still a forbidden ApiError with its code - and announces itself once', async () => {
    respondWith(403, { code: 'subscriptionRequired' });
    const listener = jest.fn();
    const unsubscribe = subscribeSubscriptionRequired(listener);

    await expect(requestApi({ method: 'POST', path: '/x', accessToken: 't' })).rejects.toMatchObject({ kind: 'forbidden', status: 403, code: 'subscriptionRequired' });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('any other 403 announces nothing', async () => {
    respondWith(403, { code: 'collectionLocked' });
    const listener = jest.fn();
    const unsubscribe = subscribeSubscriptionRequired(listener);

    await expect(requestApi({ method: 'GET', path: '/x', accessToken: 't' })).rejects.toMatchObject({ kind: 'forbidden', code: 'collectionLocked' });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('sends extra headers, but never lets them replace the Authorization header', async () => {
    const fetchMock = respondWith(204);

    await requestApi({
      method: 'GET',
      path: '/x',
      accessToken: 'real-token',
      headers: { 'X-Juple-Collection-Unlock': 'grant', Authorization: 'Bearer forged' },
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual(expect.objectContaining({
      'X-Juple-Collection-Unlock': 'grant',
      Authorization: 'Bearer real-token',
    }));
  });

  it.each([
    [403, 'forbidden', 'collectionLocked'],
    [403, 'forbidden', 'invalidCollectionPassword'],
    [409, 'conflict', 'publicShareActive'],
    [429, 'tooManyRequests', 'collectionUnlockThrottled'],
  ])('maps %i to %s and keeps the machine-readable code %s', async (status, kind, code) => {
    respondWith(status, { status, title: 'x', code });

    const error = await requestApi({ method: 'POST', path: '/x' }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe(kind);
    expect((error as ApiError).code).toBe(code);
  });

  it('still maps a 403/409 without a ProblemDetails body by status alone', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 409,
      json: async () => {
        throw new Error('no body');
      },
    } as unknown as Response) as unknown as typeof fetch;

    const error = (await requestApi({ method: 'POST', path: '/x' }).catch((caught: unknown) => caught)) as ApiError;
    expect(error.kind).toBe('conflict');
    expect(error.code).toBeUndefined();
  });
});
