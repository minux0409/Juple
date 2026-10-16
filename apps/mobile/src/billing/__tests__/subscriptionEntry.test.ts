import { shouldOfferSubscriptionEntry } from '../useSubscriptionEntry';

const enabled = { enabled: true, productId: 'juple_monthly', basePlanId: 'monthly', obfuscatedAccountId: 'opaque' } as const;
const disabled = { enabled: false, productId: null, basePlanId: null, obfuscatedAccountId: null } as const;

describe('shouldOfferSubscriptionEntry', () => {
  it('offers the entry only while the program is live, on Android, with an enabled catalog', () => {
    expect(shouldOfferSubscriptionEntry('android', enabled, true)).toBe(true);
    expect(shouldOfferSubscriptionEntry('android', disabled, true)).toBe(false);
    expect(shouldOfferSubscriptionEntry('android', null, true)).toBe(false);
  });

  it('never offers it while the subscription program is off - even with Google billing configured (Production before launch)', () => {
    expect(shouldOfferSubscriptionEntry('android', enabled, false)).toBe(false);
  });

  it('never offers it on iOS (or any other platform), whatever the catalog says', () => {
    expect(shouldOfferSubscriptionEntry('ios', enabled, true)).toBe(false);
    expect(shouldOfferSubscriptionEntry('web', enabled, true)).toBe(false);
  });
});
