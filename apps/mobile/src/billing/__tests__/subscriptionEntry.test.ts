import { shouldOfferSubscriptionEntry } from '../useSubscriptionEntry';

const enabled = { enabled: true, productId: 'juple_monthly', basePlanId: 'monthly', obfuscatedAccountId: 'opaque' } as const;
const disabled = { enabled: false, productId: null, basePlanId: null, obfuscatedAccountId: null } as const;

describe('shouldOfferSubscriptionEntry', () => {
  it('offers the entry only on Android with an enabled catalog', () => {
    expect(shouldOfferSubscriptionEntry('android', enabled)).toBe(true);
    expect(shouldOfferSubscriptionEntry('android', disabled)).toBe(false);
    expect(shouldOfferSubscriptionEntry('android', null)).toBe(false);
  });

  it('never offers it on iOS (or any other platform), whatever the catalog says', () => {
    expect(shouldOfferSubscriptionEntry('ios', enabled)).toBe(false);
    expect(shouldOfferSubscriptionEntry('web', enabled)).toBe(false);
  });
});
