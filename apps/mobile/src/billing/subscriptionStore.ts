import type { OfferUnavailableReason, PurchaseResult, RestoreResult } from './types';

/**
 * What the shared Subscription screen needs from a store, and nothing store-specific: the localized price the STORE returned, and
 * purchase / restore that only resolve after the Backend has verified. No product ids, offer tokens, account ids or purchase
 * tokens cross this boundary. Google Play implements it today (useSubscriptionStore.ts); the App Store (R39-C, StoreKit) provides
 * the same contract, so the screen does not change.
 */
export interface SubscriptionOffer {
  /** The store's own localized price string - never built or hardcoded by the app. */
  readonly localizedPrice: string;
  readonly currencyCode: string | null;
  /** ISO-8601 recurring period (e.g. "P1M") when the store reports one. */
  readonly billingPeriod: string | null;
}

export type SubscriptionOfferResult =
  | { readonly kind: 'ready'; readonly offer: SubscriptionOffer }
  | { readonly kind: 'unavailable'; readonly reason: OfferUnavailableReason };

export interface SubscriptionStore {
  loadOffer: () => Promise<SubscriptionOfferResult>;
  purchase: () => Promise<PurchaseResult>;
  restore: () => Promise<RestoreResult>;
  /** True when this platform's store has a subscription-management page the app can open (Google Play today; the App Store is a Mac follow-up). */
  canManageSubscription: boolean;
  /** Opens that store page. Never changes any access: only the Backend's entitlement does. */
  openSubscriptionManagement: () => Promise<void>;
}
