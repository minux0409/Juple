import type { Entitlement } from '../auth/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the Subscription screen says about the account's access - derived ONLY from the entitlement the Backend reported
 * (never from a local purchase flag, a store callback, the device clock or the store price). `unknown` is "no entitlement
 * yet" and is shown conservatively; `notRequired` is the program being off (the Backend sent programEnabled:false).
 */
export type SubscriptionStatusView =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'notRequired' }
  /** `daysLeft` null: the server did not say when it computed the entitlement, so no count is shown (the end date still is). */
  | { readonly kind: 'trial'; readonly daysLeft: number | null; readonly lessThanDay: boolean; readonly endsAtUtc: string | null }
  | { readonly kind: 'active' }
  | { readonly kind: 'gracePeriod' }
  | { readonly kind: 'expired'; readonly endedAtUtc: string | null };

export function describeEntitlement(entitlement: Entitlement | null): SubscriptionStatusView {
  if (!entitlement) {
    return { kind: 'unknown' };
  }
  if (!entitlement.programEnabled) {
    return { kind: 'notRequired' };
  }
  switch (entitlement.status) {
    case 'trial': {
      const end = entitlement.trialEndsAtUtc ? Date.parse(entitlement.trialEndsAtUtc) : Number.NaN;
      const asOf = entitlement.verifiedAtUtc ? Date.parse(entitlement.verifiedAtUtc) : Number.NaN;
      // The remaining time is measured from when the SERVER computed the entitlement, never from this device's clock.
      if (Number.isNaN(end) || Number.isNaN(asOf)) {
        return { kind: 'trial', daysLeft: null, lessThanDay: false, endsAtUtc: entitlement.trialEndsAtUtc };
      }
      const remaining = end - asOf;
      return remaining < DAY_MS
        ? { kind: 'trial', daysLeft: null, lessThanDay: true, endsAtUtc: entitlement.trialEndsAtUtc }
        : { kind: 'trial', daysLeft: Math.ceil(remaining / DAY_MS), lessThanDay: false, endsAtUtc: entitlement.trialEndsAtUtc };
    }
    case 'active':
      return { kind: 'active' };
    case 'gracePeriod':
      return { kind: 'gracePeriod' };
    case 'expired':
      return { kind: 'expired', endedAtUtc: entitlement.accessFrozenAtUtc };
    default:
      return { kind: 'unknown' };
  }
}
