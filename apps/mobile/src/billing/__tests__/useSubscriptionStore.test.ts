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

  it('uses the exact displayed quote across reloads and publishes a new quote without exposing store identifiers', async () => {
    const original = {
      productId: 'juple_monthly', basePlanId: 'monthly', plan: 'monthly', localizedPrice: '₩1,300', priceAmount: 1300,
      priceAmountMicros: 1300000000, currencyCode: 'KRW', billingPeriod: 'P1M', offerToken: 'old', obfuscatedAccountId: 'opaque',
    };
    const fresh = { ...original, localizedPrice: '₩2,700', priceAmount: 2700, priceAmountMicros: 2700000000, offerToken: 'new' };
    const billing = fakeBilling({
      loadPlans: jest.fn().mockResolvedValueOnce({ kind: 'ready', offers: [original] }).mockResolvedValueOnce({ kind: 'ready', offers: [fresh] }),
      purchase: jest.fn().mockResolvedValueOnce({ kind: 'priceChanged', offers: [fresh] }).mockResolvedValueOnce({ kind: 'cancelled' }),
    });
    const store = createGoogleSubscriptionStore(billing);
    const shown = await store.loadPlans();
    await store.loadPlans();
    if (shown.kind !== 'ready') {
      throw new Error('Expected initial quote');
    }

    const updated = await store.purchase('monthly', shown.plans[0]);
    expect(billing.purchase).toHaveBeenLastCalledWith('monthly', original);
    expect(updated).toEqual({ kind: 'priceChanged', plans: [{ key: 'monthly', localizedPrice: '₩2,700', priceAmount: 2700, currencyCode: 'KRW', billingPeriod: 'P1M' }] });
    if (updated.kind !== 'priceChanged') {
      throw new Error('Expected updated quote');
    }
    await store.purchase('monthly', updated.plans[0]);
    expect(billing.purchase).toHaveBeenLastCalledWith('monthly', fresh);
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

  it('matches a Google subscription only by both the verified product and base plan IDs', async () => {
    const billing = fakeBilling({
      loadPlans: jest.fn().mockResolvedValue({
        kind: 'ready',
        offers: [
          { productId: 'juple_monthly', basePlanId: 'monthly', plan: 'monthly' },
          { productId: 'juple_monthly', basePlanId: 'yearly', plan: 'yearly' },
        ],
      }),
    });
    const store = createGoogleSubscriptionStore(billing);
    await store.loadPlans();

    expect(store.planOfSubscription('juple_monthly', 'monthly')).toBe('monthly');
    expect(store.planOfSubscription('juple_monthly', 'yearly')).toBe('yearly');
    expect(store.planOfSubscription('another-product', 'yearly')).toBeNull();
    expect(store.planOfSubscription('juple_monthly', 'unknown')).toBeNull();
    expect(store.planOfSubscription('juple_monthly')).toBeNull();
  });
});
