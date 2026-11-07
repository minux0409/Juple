import type { PlanKey } from './subscriptionPricing';
import type { OfferUnavailableReason, PurchaseResult, RestoreResult } from './types';

/**
 * What the shared Subscription screen needs from a store, and nothing store-specific: the localized prices the STORE returned for
 * the two membership plans, and purchase / restore that only resolve after the Backend has verified. No product ids, offer tokens,
 * account ids or purchase tokens cross this boundary. Google Play (Android) and the App Store (iOS) both implement it
 * (useSubscriptionStore.ts), so the screen is the same on both platforms.
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

/** One membership plan as this storefront prices it. */
export interface SubscriptionPlan extends SubscriptionOffer {
  readonly key: PlanKey;
  /** The price in currency units (for the per-storefront discount arithmetic only), or null if the store gave no readable amount. */
  readonly priceAmount: number | null;
}

export type SubscriptionPlansResult =
  | { readonly kind: 'ready'; readonly plans: readonly SubscriptionPlan[] }
  | { readonly kind: 'unavailable'; readonly reason: OfferUnavailableReason };

export interface SubscriptionStore {
  /** The monthly plan only (kept for callers that predate the yearly plan). */
  loadOffer: () => Promise<SubscriptionOfferResult>;
  /** Every plan the store prices for this storefront (monthly and/or yearly). */
  loadPlans: () => Promise<SubscriptionPlansResult>;
  /** Buys a plan (monthly by default). Resolves only after the Backend verified it. */
  purchase: (plan?: PlanKey) => Promise<PurchaseResult>;
  restore: () => Promise<RestoreResult>;
  /** True when this platform's store has a subscription-management page the app can open (Google Play and the App Store both do). */
  canManageSubscription: boolean;
  /** Opens that store page. Never changes any access: only the Backend's entitlement does. */
  openSubscriptionManagement: () => Promise<void>;
}
