jest.mock('../useGoogleBilling', () => ({ useGoogleBilling: jest.fn() }));

import type { GoogleBilling } from '../googleBilling';
import { createGoogleSubscriptionStore } from '../useSubscriptionStore';

function fakeBilling(overrides: Partial<GoogleBilling> = {}): GoogleBilling {
  return {
    loadOffer: jest.fn(),
    purchase: jest.fn(),
    restore: jest.fn(),
    dispose: jest.fn(),
    ...overrides,
  };
}

describe('createGoogleSubscriptionStore', () => {
  it('exposes only the store-localized price facts - the offer token and the opaque account id never leave the Google layer', async () => {
    const billing = fakeBilling({
      loadOffer: jest.fn().mockResolvedValue({
        kind: 'ready',
        offer: { productId: 'juple_monthly', basePlanId: 'monthly', offerToken: 'secret-offer-token', localizedPrice: '₩1,300', currencyCode: 'KRW', billingPeriod: 'P1M', obfuscatedAccountId: 'opaque-id' },
      }),
    });

    const result = await createGoogleSubscriptionStore(billing).loadOffer();

    expect(result).toEqual({ kind: 'ready', offer: { localizedPrice: '₩1,300', currencyCode: 'KRW', billingPeriod: 'P1M' } });
    expect(JSON.stringify(result)).not.toMatch(/secret-offer-token|opaque-id|juple_monthly/);
  });

  it('passes an unavailable offer (disabled catalog, product / base-plan mismatch, store failure) through untouched - no price is invented', async () => {
    for (const reason of ['disabled', 'productNotFound', 'offerNotFound', 'storeUnavailable', 'unsupportedPlatform'] as const) {
      const store = createGoogleSubscriptionStore(fakeBilling({ loadOffer: jest.fn().mockResolvedValue({ kind: 'unavailable', reason }) }));
      await expect(store.loadOffer()).resolves.toEqual({ kind: 'unavailable', reason });
    }
  });

  it('purchase and restore are the existing server-authoritative Google flows, unchanged', async () => {
    const billing = fakeBilling({
      purchase: jest.fn().mockResolvedValue({ kind: 'verified', state: 'active' }),
      restore: jest.fn().mockResolvedValue({ kind: 'restored' }),
    });
    const store = createGoogleSubscriptionStore(billing);

    await expect(store.purchase()).resolves.toEqual({ kind: 'verified', state: 'active' });
    await expect(store.restore()).resolves.toEqual({ kind: 'restored' });
    expect(billing.purchase).toHaveBeenCalledTimes(1);
    expect(billing.restore).toHaveBeenCalledTimes(1);
  });
});
