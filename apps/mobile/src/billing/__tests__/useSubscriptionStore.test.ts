jest.mock('../useGoogleBilling', () => ({ useGoogleBilling: jest.fn() }));
jest.mock('../useAppleBilling', () => ({ useAppleBilling: jest.fn() }));

import type { AppleBilling } from '../appleBilling';
import type { GoogleBilling } from '../googleBilling';
import { createAppleSubscriptionStore, createGoogleSubscriptionStore } from '../useSubscriptionStore';

function fakeBilling(overrides: Partial<GoogleBilling> = {}): GoogleBilling {
  return {
    loadOffer: jest.fn(),
    loadPlans: jest.fn(),
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

  it('offers Google Play subscription management on Android only, opening the Play page without any product or account id', async () => {
    const { Linking, Platform } = require('react-native');
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const original = Platform.OS;
    try {
      Platform.OS = 'android';
      const store = createGoogleSubscriptionStore(fakeBilling());
      expect(store.canManageSubscription).toBe(true);
      await store.openSubscriptionManagement();
      expect(openURL).toHaveBeenCalledWith('https://play.google.com/store/account/subscriptions');

      Platform.OS = 'ios';
      expect(createGoogleSubscriptionStore(fakeBilling()).canManageSubscription).toBe(false);
    } finally {
      Platform.OS = original;
      openURL.mockRestore();
    }
  });
});

describe('which plan a reported subscription is on', () => {
  it('the App Store names it from its own product ids once the plans are loaded; an unknown product is null', async () => {
    const apple = {
      loadPlans: jest.fn().mockResolvedValue({
        kind: 'ready',
        plans: [
          { plan: 'yearly', productId: 'com.juple.app.membership.yearly', localizedPrice: '$19.90', priceAmount: 19.9, currencyCode: 'USD', billingPeriod: 'P1Y' },
          { plan: 'monthly', productId: 'com.juple.app.membership.monthly', localizedPrice: '$1.99', priceAmount: 1.99, currencyCode: 'USD', billingPeriod: 'P1M' },
        ],
      }),
    } as unknown as AppleBilling;
    const store = createAppleSubscriptionStore(apple);

    expect(store.planOfSubscription('com.juple.app.membership.monthly')).toBeNull();
    await store.loadPlans();
    expect(store.planOfSubscription('com.juple.app.membership.monthly')).toBe('monthly');
    expect(store.planOfSubscription('com.juple.app.membership.yearly')).toBe('yearly');
    expect(store.planOfSubscription('something.else')).toBeNull();
    expect(store.planOfSubscription(null)).toBeNull();
  });

  it('Google Play never guesses: monthly and yearly are two base plans of one product', () => {
    expect(createGoogleSubscriptionStore(fakeBilling()).planOfSubscription('juple_monthly')).toBeNull();
  });
});
