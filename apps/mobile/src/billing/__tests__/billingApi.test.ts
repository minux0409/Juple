import { getGoogleCatalog, restoreGooglePurchases, verifyGooglePurchase } from '../billingApi';

const respond = (body: unknown) => jest.fn(async () => ({ status: 200, body }));

describe('getGoogleCatalog', () => {
  it('asks the Backend and returns only the configured product, base plan and opaque account id', async () => {
    const request = respond({ enabled: true, productId: 'juple_monthly', basePlanId: 'monthly', obfuscatedAccountId: 'key', somethingElse: 1 });

    const catalog = await getGoogleCatalog(request as never);

    expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/api/v1/billing/google/catalog' });
    expect(catalog).toEqual({ enabled: true, productId: 'juple_monthly', basePlanId: 'monthly', obfuscatedAccountId: 'key' });
  });

  it.each([
    [{ enabled: false, productId: null, basePlanId: null, obfuscatedAccountId: null }],
    [{ enabled: true, productId: 'x' }],
    [{ enabled: 'true', productId: 'x', basePlanId: 'y', obfuscatedAccountId: 'z' }],
    [undefined],
  ])('treats a disabled or partial answer (%#) as not enabled - never a guessed product', async body => {
    expect(await getGoogleCatalog(respond(body) as never)).toEqual({ enabled: false, productId: null, basePlanId: null, obfuscatedAccountId: null });
  });
});

describe('verifyGooglePurchase', () => {
  it('sends ONLY the purchase token - nothing a client could lie about', async () => {
    const request = respond({ outcome: 'verified', state: 'active', acknowledged: true });

    const result = await verifyGooglePurchase(request as never, 'tok');

    expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/api/v1/billing/google/verify', body: { purchaseToken: 'tok' } });
    expect(result).toEqual({ outcome: 'verified', state: 'active', acknowledged: true });
  });

  it('refuses an answer it does not understand rather than treating it as success', async () => {
    await expect(verifyGooglePurchase(respond({ outcome: 'granted' }) as never, 'tok')).rejects.toThrow();
    await expect(verifyGooglePurchase(respond(undefined) as never, 'tok')).rejects.toThrow();
  });

  it('keeps the three known outcomes', async () => {
    for (const outcome of ['verified', 'pending', 'notEntitled']) {
      expect((await verifyGooglePurchase(respond({ outcome, state: 's', acknowledged: false }) as never, 't')).outcome).toBe(outcome);
    }
  });
});

describe('restoreGooglePurchases', () => {
  it('posts the candidate tokens and returns the Backend outcome', async () => {
    const request = respond({ outcome: 'belongsToAnotherJupleAccount' });

    expect(await restoreGooglePurchases(request as never, ['a', 'b'])).toBe('belongsToAnotherJupleAccount');
    expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/api/v1/billing/google/restore', body: { purchaseTokens: ['a', 'b'] } });
  });

  it('an unknown outcome is a temporary failure, never "restored"', async () => {
    expect(await restoreGooglePurchases(respond({ outcome: 'restoredEverything' }) as never, [])).toBe('temporaryFailure');
    expect(await restoreGooglePurchases(respond(undefined) as never, [])).toBe('temporaryFailure');
  });
});
