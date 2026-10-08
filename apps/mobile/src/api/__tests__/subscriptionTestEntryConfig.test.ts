import { resolveSubscriptionTestEntryEnabled } from '../apiConfig';

describe('resolveSubscriptionTestEntryEnabled', () => {
  it('is on for local development and for the dogfood / Play Internal API environment', () => {
    expect(resolveSubscriptionTestEntryEnabled(true, undefined)).toBe(true);
    expect(resolveSubscriptionTestEntryEnabled(false, 'dogfood')).toBe(true);
  });

  it('is off for the production release environment and for an unknown one', () => {
    expect(resolveSubscriptionTestEntryEnabled(false, 'production')).toBe(false);
    expect(resolveSubscriptionTestEntryEnabled(false, undefined)).toBe(false);
  });
});
