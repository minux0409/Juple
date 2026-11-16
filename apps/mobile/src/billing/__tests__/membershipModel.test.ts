import { describeTrialProgress, isFreePeriodEnded, membershipBadge, otherStoreHolding } from '../membershipModel';

const trial = (overrides: Record<string, unknown> = {}) => ({
  programEnabled: true,
  status: 'trial' as const,
  trialStartedAtUtc: '2026-11-04T00:00:00Z',
  trialEndsAtUtc: '2026-12-04T00:00:00Z',
  verifiedAtUtc: '2026-11-16T00:00:00Z',
  ...overrides,
});

describe('describeTrialProgress - days left and progress from server values only', () => {
  it('counts whole days left at the server instant, rounding up', () => {
    expect(describeTrialProgress(trial())).toEqual({ daysLeft: 18, elapsed: 0.4, endsAtUtc: '2026-12-04T00:00:00Z' });
    expect(describeTrialProgress(trial({ verifiedAtUtc: '2026-11-16T00:00:01Z' }))?.daysLeft).toBe(18);
    expect(describeTrialProgress(trial({ verifiedAtUtc: '2026-11-15T23:59:59Z' }))?.daysLeft).toBe(19);
  });

  it('a brand-new account sees the whole 30 days; the last hours are "1 day", never 0', () => {
    expect(describeTrialProgress(trial({ verifiedAtUtc: '2026-11-04T00:00:00Z' }))).toMatchObject({ daysLeft: 30, elapsed: 0 });
    expect(describeTrialProgress(trial({ verifiedAtUtc: '2026-12-03T23:00:00Z' }))?.daysLeft).toBe(1);
  });

  it('a month-end sign-up: the end the server sent is used as-is, so 31 Jan -> 2 Mar counts down to that instant', () => {
    const progress = describeTrialProgress(trial({ trialStartedAtUtc: '2027-01-31T15:00:00Z', trialEndsAtUtc: '2027-03-02T15:00:00Z', verifiedAtUtc: '2027-02-27T15:00:00Z' }));
    expect(progress?.daysLeft).toBe(3);
  });

  it('the device clock is never read: moving the phone\'s date changes nothing', () => {
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-01T00:00:00Z'));
    try {
      expect(describeTrialProgress(trial())?.daysLeft).toBe(18);
    } finally {
      spy.mockRestore();
    }
  });

  it('nothing while the program is off, outside a trial, at or after the end, or without readable server dates', () => {
    expect(describeTrialProgress(trial({ programEnabled: false }))).toBeNull();
    expect(describeTrialProgress(trial({ status: 'active' }))).toBeNull();
    expect(describeTrialProgress(trial({ status: 'expired' }))).toBeNull();
    expect(describeTrialProgress(trial({ verifiedAtUtc: '2026-12-04T00:00:00Z' }))).toBeNull();
    expect(describeTrialProgress(trial({ trialEndsAtUtc: null }))).toBeNull();
    expect(describeTrialProgress(trial({ verifiedAtUtc: null }))).toBeNull();
    expect(describeTrialProgress(trial({ trialEndsAtUtc: 'soon' }))).toBeNull();
    expect(describeTrialProgress(null)).toBeNull();
  });

  it('a missing start still gives the days left, with no claimed progress', () => {
    expect(describeTrialProgress(trial({ trialStartedAtUtc: null }))).toMatchObject({ daysLeft: 18, elapsed: 0 });
  });
});

describe('membershipBadge', () => {
  it('names the one status', () => {
    expect(membershipBadge({ kind: 'trial', endsAtUtc: null }, { status: 'trial' }, false)).toBe('trial');
    expect(membershipBadge({ kind: 'active', startedAtUtc: null, nextPaymentAtUtc: null }, { status: 'active' }, false)).toBe('member');
    expect(membershipBadge({ kind: 'canceled', startedAtUtc: null, accessEndsAtUtc: null }, null, false)).toBe('member');
    expect(membershipBadge({ kind: 'gracePeriod', startedAtUtc: null }, null, false)).toBe('member');
    expect(membershipBadge({ kind: 'expired', endedAtUtc: null }, { status: 'expired' }, false)).toBe('expired');
    expect(membershipBadge({ kind: 'revoked', endedAtUtc: null }, { status: 'expired' }, false)).toBe('expired');
    expect(membershipBadge({ kind: 'none' }, { status: 'expired' }, false)).toBe('trialEnded');
  });

  it('a pending payment is "confirming payment" until the server reports a subscription', () => {
    expect(membershipBadge({ kind: 'none' }, { status: 'expired' }, true)).toBe('pending');
    expect(membershipBadge({ kind: 'trial', endsAtUtc: null }, { status: 'trial' }, true)).toBe('pending');
    expect(membershipBadge({ kind: 'active', startedAtUtc: null, nextPaymentAtUtc: null }, { status: 'active' }, true)).toBe('member');
  });

  it('no badge when nothing is known or the program is off', () => {
    expect(membershipBadge({ kind: 'unknown' }, null, false)).toBeNull();
    expect(membershipBadge({ kind: 'none' }, { status: null }, false)).toBeNull();
  });
});

describe('isFreePeriodEnded - "how was your month with Juple?" only when the free month is what ended', () => {
  const ended = { programEnabled: true, status: 'expired' as const, trialEndsAtUtc: '2026-12-04T00:00:00Z', accessFrozenAtUtc: '2026-12-04T00:00:00.000Z' };
  const noStore = { state: 'none' as const, endedState: null };

  it('the free month ended and nothing was ever bought', () => {
    expect(isFreePeriodEnded(ended, noStore)).toBe(true);
    expect(isFreePeriodEnded(ended, null)).toBe(true);
  });

  it('not for a paid subscription that lapsed, a live subscription, a running trial or while the program is off', () => {
    expect(isFreePeriodEnded({ ...ended, accessFrozenAtUtc: '2027-01-04T00:00:00Z' }, noStore)).toBe(false);
    expect(isFreePeriodEnded(ended, { state: 'none', endedState: 'expired' })).toBe(false);
    expect(isFreePeriodEnded(ended, { state: 'active', endedState: null })).toBe(false);
    expect(isFreePeriodEnded({ ...ended, status: 'trial' }, noStore)).toBe(false);
    expect(isFreePeriodEnded({ ...ended, status: 'active' }, noStore)).toBe(false);
    expect(isFreePeriodEnded({ ...ended, programEnabled: false }, noStore)).toBe(false);
    expect(isFreePeriodEnded({ ...ended, trialEndsAtUtc: null }, noStore)).toBe(false);
    expect(isFreePeriodEnded(null, noStore)).toBe(false);
  });
});

describe('otherStoreHolding', () => {
  it('names the store only when it is not the one this device manages', () => {
    expect(otherStoreHolding({ state: 'active', platform: 'google' }, 'ios')).toBe('google');
    expect(otherStoreHolding({ state: 'gracePeriod', platform: 'apple' }, 'android')).toBe('apple');
    expect(otherStoreHolding({ state: 'active', platform: 'apple' }, 'ios')).toBeNull();
    expect(otherStoreHolding({ state: 'active', platform: 'google' }, 'android')).toBeNull();
    expect(otherStoreHolding({ state: 'none', platform: 'google' }, 'ios')).toBeNull();
    expect(otherStoreHolding({ state: 'active', platform: null }, 'ios')).toBeNull();
    expect(otherStoreHolding(null, 'ios')).toBeNull();
  });
});
