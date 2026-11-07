import { getAppleCatalog, getGoogleCatalog, restoreAppleTransactions, restoreGooglePurchases, verifyAppleTransaction, verifyGooglePurchase } from '../billingApi';

const respond = (body: unknown) => jest.fn(async () => ({ status: 200, body }));

describe('getGoogleCatalog', () => {
  it('asks the Backend and returns only the configured product, base plan and opaque account id', async () => {
    const request = respond({ enabled: true, productId: 'juple_monthly', basePlanId: 'monthly', obfuscatedAccountId: 'key', somethingElse: 1 });

    const catalog = await getGoogleCatalog(request as never);

    expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/api/v1/billing/google/catalog' });
    // An older server answers only basePlanId: that one plan is the whole catalog.
    expect(catalog).toEqual({ enabled: true, productId: 'juple_monthly', basePlanId: 'monthly', basePlanIds: ['monthly'], obfuscatedAccountId: 'key' });
  });

  it.each([
    [{ enabled: false, productId: null, basePlanId: null, obfuscatedAccountId: null }],
    [{ enabled: true, productId: 'x' }],
    [{ enabled: 'true', productId: 'x', basePlanId: 'y', obfuscatedAccountId: 'z' }],
    [undefined],
  ])('treats a disabled or partial answer (%#) as not enabled - never a guessed product', async body => {
    expect(await getGoogleCatalog(respond(body) as never)).toEqual({ enabled: false, productId: null, basePlanId: null, basePlanIds: [], obfuscatedAccountId: null });
  });

  it('returns every allowed base plan (monthly and yearly) the server lists, and drops junk entries', async () => {
    const catalog = await getGoogleCatalog(respond({ enabled: true, productId: 'juple_monthly', basePlanId: 'monthly', basePlanIds: ['monthly', 'yearly', '', 7], obfuscatedAccountId: 'key' }) as never);

    expect(catalog.basePlanIds).toEqual(['monthly', 'yearly']);
  });
});

describe('getAppleCatalog', () => {
  it('asks the Backend and returns only the product ids and the App Account Token', async () => {
    const request = respond({ enabled: true, productIds: ['m', 'y'], appAccountToken: 'uuid-1', somethingElse: 1 });

    const catalog = await getAppleCatalog(request as never);

    expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/api/v1/billing/apple/catalog' });
    expect(catalog).toEqual({ enabled: true, productIds: ['m', 'y'], appAccountToken: 'uuid-1' });
  });

  it.each([
    [{ enabled: false, productIds: [], appAccountToken: null }],
    [{ enabled: true, productIds: [], appAccountToken: 'uuid' }],
    [{ enabled: true, productIds: ['m'] }],
    [{ enabled: 'true', productIds: ['m'], appAccountToken: 'uuid' }],
    [undefined],
  ])('treats a disabled or partial answer (%#) as not enabled - never a guessed product', async body => {
    expect(await getAppleCatalog(respond(body) as never)).toEqual({ enabled: false, productIds: [], appAccountToken: null });
  });
});

describe('verifyAppleTransaction', () => {
  it('sends ONLY the signed transaction - nothing a client could lie about', async () => {
    const request = respond({ outcome: 'verified', state: 'active' });

    const result = await verifyAppleTransaction(request as never, 'a.b.c');

    expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/api/v1/billing/apple/verify', body: { signedTransaction: 'a.b.c' } });
    expect(result).toEqual({ outcome: 'verified', state: 'active', acknowledged: true });
  });

  it('refuses an answer it does not understand rather than treating it as success', async () => {
    await expect(verifyAppleTransaction(respond({ outcome: 'granted' }) as never, 'x')).rejects.toThrow();
    await expect(verifyAppleTransaction(respond(undefined) as never, 'x')).rejects.toThrow();
  });
});

describe('restoreAppleTransactions', () => {
  it('sends the transactions to check and maps the outcome; anything unknown is a temporary failure', async () => {
    const request = respond({ outcome: 'restored' });

    expect(await restoreAppleTransactions(request as never, ['a'])).toBe('restored');
    expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/api/v1/billing/apple/restore', body: { signedTransactions: ['a'] } });
    expect(await restoreAppleTransactions(respond({ outcome: 'weird' }) as never, [])).toBe('temporaryFailure');
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
