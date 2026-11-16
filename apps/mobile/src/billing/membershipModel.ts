import type { Entitlement, StoreSubscription } from '../auth/types';
import type { SubscriptionView } from './subscriptionStatus';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The running free period as the Membership screen shows it. */
export interface TrialProgress {
  /** Whole days still to go, rounded up (any part of a day counts as a day); at least 1 while the period runs. */
  readonly daysLeft: number;
  /** 0..1 - how much of the period has passed. */
  readonly elapsed: number;
  readonly endsAtUtc: string;
}

/**
 * Days left and progress of Juple's own free period, from the SERVER's values only: its start and end, measured at the server instant the
 * entitlement was computed (`verifiedAtUtc`). The device clock is never read, so changing the phone's date cannot lengthen or shorten
 * it; the numbers move on with the next server read (every launch, and whenever the Membership screen is opened).
 * Null whenever the server does not report a running trial with readable dates (program off, subscribed, expired).
 */
export function describeTrialProgress(
  entitlement: Pick<Entitlement, 'programEnabled' | 'status' | 'trialStartedAtUtc' | 'trialEndsAtUtc' | 'verifiedAtUtc'> | null | undefined,
): TrialProgress | null {
  if (!entitlement?.programEnabled || entitlement.status !== 'trial' || !entitlement.trialEndsAtUtc || !entitlement.verifiedAtUtc) {
    return null;
  }
  const endsAt = Date.parse(entitlement.trialEndsAtUtc);
  const now = Date.parse(entitlement.verifiedAtUtc);
  if (!Number.isFinite(endsAt) || !Number.isFinite(now) || endsAt <= now) {
    return null;
  }
  const startedAt = entitlement.trialStartedAtUtc ? Date.parse(entitlement.trialStartedAtUtc) : Number.NaN;
  const length = endsAt - startedAt;
  const elapsed = Number.isFinite(startedAt) && length > 0 ? Math.min(1, Math.max(0, (now - startedAt) / length)) : 0;
  return { daysLeft: Math.max(1, Math.ceil((endsAt - now) / DAY_MS)), elapsed, endsAtUtc: entitlement.trialEndsAtUtc };
}

export type MembershipBadge = 'trial' | 'member' | 'trialEnded' | 'expired' | 'pending';

/**
 * The one status badge on the Membership screen. `paymentPending`: a purchase this screen started is still being completed in the store
 * (nothing is granted yet) - it wins until the server reports the subscription. No badge while nothing is known or required.
 */
export function membershipBadge(view: SubscriptionView, entitlement: Pick<Entitlement, 'status'> | null | undefined, paymentPending: boolean): MembershipBadge | null {
  switch (view.kind) {
    case 'active':
    case 'gracePeriod':
    case 'canceled':
      return 'member';
    case 'trial':
      return paymentPending ? 'pending' : 'trial';
    case 'expired':
    case 'revoked':
      return paymentPending ? 'pending' : 'expired';
    case 'none':
      if (paymentPending) {
        return 'pending';
      }
      return entitlement?.status === 'expired' ? 'trialEnded' : null;
    default:
      return paymentPending ? 'pending' : null;
  }
}

/**
 * Whether "your free month ended" applies: the server says the program is live, access has ended, it ended BECAUSE the free period ended
 * (the frozen instant is the trial end), and no store subscription is live or has ever ended - a person whose PAID subscription lapsed is
 * not thanked for "a month with Juple". Server facts only.
 */
export function isFreePeriodEnded(
  entitlement: Pick<Entitlement, 'programEnabled' | 'status' | 'trialEndsAtUtc' | 'accessFrozenAtUtc'> | null | undefined,
  storeSubscription: Pick<StoreSubscription, 'state' | 'endedState'> | null | undefined,
): boolean {
  if (!entitlement?.programEnabled || entitlement.status !== 'expired' || !entitlement.trialEndsAtUtc || !entitlement.accessFrozenAtUtc) {
    return false;
  }
  if (storeSubscription && (storeSubscription.state !== 'none' || storeSubscription.endedState !== null)) {
    return false;
  }
  return Date.parse(entitlement.trialEndsAtUtc) === Date.parse(entitlement.accessFrozenAtUtc);
}

/** The store that holds a live subscription, when it is not the one this device can manage (a subscriber switching phones). */
export function otherStoreHolding(storeSubscription: Pick<StoreSubscription, 'state' | 'platform'> | null | undefined, os: string): 'google' | 'apple' | null {
  if (!storeSubscription || storeSubscription.state === 'none' || !storeSubscription.platform) {
    return null;
  }
  const own = os === 'ios' ? 'apple' : os === 'android' ? 'google' : null;
  return storeSubscription.platform === own ? null : storeSubscription.platform;
}
