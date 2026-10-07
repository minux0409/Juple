/**
 * The non-secret purchase configuration the Backend serves (GET /api/v1/billing/google/catalog). It never carries a price - the
 * localized one always comes from Google Play itself - nor the internal user id, a credential or a token.
 */
export interface GoogleCatalog {
  readonly enabled: boolean;
  readonly productId: string | null;
  readonly basePlanId: string | null;
  /** The opaque id this account must give Google Play, so the purchase can be tied back to it server-side. */
  readonly obfuscatedAccountId: string | null;
}

export type VerifyOutcome = 'verified' | 'pending' | 'notEntitled';

/** The server's normalized verification result - never a Google state, token or price. */
export interface VerifyResponse {
  readonly outcome: VerifyOutcome;
  readonly state: string;
  readonly acknowledged: boolean;
}

export type RestoreOutcome = 'restored' | 'nothingFound' | 'belongsToAnotherJupleAccount' | 'temporaryFailure';

/** What the (later) subscription screen shows: all of it straight from Google Play, none of it hardcoded here. */
export interface GoogleOffer {
  readonly productId: string;
  readonly basePlanId: string;
  readonly offerToken: string;
  /** The store's own localized price string (e.g. what "{price} / month" is built from) - never a number this app formats. */
  readonly localizedPrice: string;
  readonly currencyCode: string | null;
  /** ISO-8601 billing period of the recurring phase (e.g. "P1M"), for the "per month" wording. */
  readonly billingPeriod: string | null;
  readonly obfuscatedAccountId: string;
}

export type OfferUnavailableReason = 'unsupportedPlatform' | 'disabled' | 'storeUnavailable' | 'productNotFound' | 'offerNotFound';

export type OfferResult =
  | { readonly kind: 'ready'; readonly offer: GoogleOffer }
  | { readonly kind: 'unavailable'; readonly reason: OfferUnavailableReason };

export type VerificationFailureReason = 'belongsToAnotherAccount' | 'rejected' | 'temporary';

export type PurchaseResult =
  /** The server verified (and acknowledged) the purchase; the account's entitlement has been refreshed. */
  | { readonly kind: 'verified'; readonly state: string }
  /** Payment is still being completed in Google Play: nothing is granted yet. */
  | { readonly kind: 'pending' }
  /** Verified, but the purchase grants no access (e.g. already ended). */
  | { readonly kind: 'notEntitled' }
  | { readonly kind: 'cancelled' }
  /** The user already owns it: a restore will link it. */
  | { readonly kind: 'alreadyOwned' }
  /** The store purchase succeeded but the server could not confirm it: NOTHING was granted or finished. Retry later or restore. */
  | { readonly kind: 'verificationFailed'; readonly reason: VerificationFailureReason }
  | { readonly kind: 'unavailable'; readonly reason: OfferUnavailableReason }
  | { readonly kind: 'error'; readonly code: string };

export type RestoreResult =
  | { readonly kind: RestoreOutcome }
  | { readonly kind: 'unavailable'; readonly reason: OfferUnavailableReason };
