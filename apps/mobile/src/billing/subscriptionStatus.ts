import type { Entitlement, StoreSubscription } from '../auth/types';

/**
 * The ONE thing the Subscription screen says about the account: its subscription. Derived only from what the Backend reported -
 * the store subscription (`storeSubscription`) and, for Juple's own free period, the entitlement - never from a local purchase flag,
 * a store callback or the device clock, and no date is ever computed here: a date appears only when the Backend sent it.
 *
 * Deliberately NOT part of this view: whether Juple currently REQUIRES a subscription (`entitlement.programEnabled`). That is an
 * operations switch (trial, enforcement, write restriction), not something a person is told about.
 */
export type SubscriptionView =
  /** Nothing has been reported yet (bootstrap not read). */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'none' }
  /** Juple's own free period (not a store offer): only while the entitlement really is a running trial. */
  | { readonly kind: 'trial'; readonly endsAtUtc: string | null }
  /** `nextPaymentAtUtc` is set only when the store says it renews (autoRenewing === true). */
  | { readonly kind: 'active'; readonly startedAtUtc: string | null; readonly nextPaymentAtUtc: string | null }
  | { readonly kind: 'gracePeriod'; readonly startedAtUtc: string | null }
  /** Cancelled but still current: access runs to `accessEndsAtUtc` (the end of the period - NOT a next payment). */
  | { readonly kind: 'canceled'; readonly startedAtUtc: string | null; readonly accessEndsAtUtc: string | null }
  | { readonly kind: 'expired'; readonly endedAtUtc: string | null }
  | { readonly kind: 'revoked'; readonly endedAtUtc: string | null };

export function describeSubscription(
  storeSubscription: StoreSubscription | null | undefined,
  entitlement: Entitlement | null | undefined,
): SubscriptionView {
  if (storeSubscription?.state === 'active') {
    return storeSubscription.autoRenewing === false
      ? { kind: 'canceled', startedAtUtc: storeSubscription.startedAtUtc, accessEndsAtUtc: storeSubscription.currentPeriodEndsAtUtc }
      : {
          kind: 'active',
          startedAtUtc: storeSubscription.startedAtUtc,
          nextPaymentAtUtc: storeSubscription.autoRenewing === true ? storeSubscription.currentPeriodEndsAtUtc : null,
        };
  }
  if (storeSubscription?.state === 'gracePeriod') {
    return { kind: 'gracePeriod', startedAtUtc: storeSubscription.startedAtUtc };
  }

  if (!storeSubscription && !entitlement) {
    return { kind: 'unknown' };
  }

  // A running Juple trial is access that exists right now, so it is what the person has - ahead of an older, ended subscription.
  if (entitlement?.programEnabled && entitlement.status === 'trial') {
    return { kind: 'trial', endsAtUtc: entitlement.trialEndsAtUtc };
  }

  if (storeSubscription?.endedState === 'revoked') {
    return { kind: 'revoked', endedAtUtc: storeSubscription.endedAtUtc };
  }
  if (storeSubscription?.endedState === 'expired') {
    return { kind: 'expired', endedAtUtc: storeSubscription.endedAtUtc };
  }

  // An older Backend (no storeSubscription): fall back to the entitlement alone, exactly as before.
  if (!storeSubscription && entitlement?.programEnabled) {
    if (entitlement.status === 'active') {
      return { kind: 'active', startedAtUtc: null, nextPaymentAtUtc: null };
    }
    if (entitlement.status === 'gracePeriod') {
      return { kind: 'gracePeriod', startedAtUtc: null };
    }
    if (entitlement.status === 'expired' && entitlement.reason === 'refunded') {
      return { kind: 'revoked', endedAtUtc: entitlement.accessFrozenAtUtc };
    }
  }

  return { kind: 'none' };
}

/** A subscription the account holds right now (the screen offers Manage, not Subscribe). */
export function isSubscribedView(view: SubscriptionView): boolean {
  return view.kind === 'active' || view.kind === 'gracePeriod' || view.kind === 'canceled';
}
