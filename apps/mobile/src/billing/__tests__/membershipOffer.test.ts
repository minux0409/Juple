import { isMembershipOffered } from '../membershipOffer';

describe('isMembershipOffered - the purchase is offered separately from the free month and the read-only rule', () => {
  const programOff = { programEnabled: false } as never;
  const programOn = { programEnabled: true } as never;

  it('the launched program offers it to everyone', () => {
    expect(isMembershipOffered({ entitlement: programOn, membershipOffered: false })).toBe(true);
  });

  it('before the launch, only an account the server offers it to (a preview account) sees it', () => {
    expect(isMembershipOffered({ entitlement: programOff, membershipOffered: true })).toBe(true);
    expect(isMembershipOffered({ entitlement: programOff, membershipOffered: false })).toBe(false);
  });

  it('an older server (no field), no entitlement or no auth: not offered', () => {
    expect(isMembershipOffered({ entitlement: programOff })).toBe(false);
    expect(isMembershipOffered({ entitlement: null, membershipOffered: undefined })).toBe(false);
    expect(isMembershipOffered(undefined)).toBe(false);
  });

  it('makes the menu available to a complimentary member before launch', () => {
    const entitlement = { programEnabled: false, complimentaryAccessEndsAtUtc: '2026-12-01T00:00:00Z' } as never;
    expect(isMembershipOffered({ entitlement, membershipOffered: false })).toBe(true);
  });
});
