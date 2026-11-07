import { Platform } from 'react-native';
import {
  endConnection,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  restorePurchases,
  type EventSubscription,
  type Purchase,
  type PurchaseError,
} from 'react-native-iap';
import { ApiError } from '../api/ApiError';
import { BILLING_ERROR_CODES } from './billingApi';
import type { PlanKey } from './subscriptionPricing';
import type {
  AppleCatalog,
  OfferUnavailableReason,
  PurchaseResult,
  RestoreOutcome,
  RestoreResult,
  VerificationFailureReason,
  VerifyResponse,
} from './types';

/** The Backend calls this module needs (see billingApi.ts) - injected so the purchase logic is testable without a network. */
export interface AppleBillingApi {
  getCatalog: () => Promise<AppleCatalog>;
  verify: (signedTransaction: string) => Promise<VerifyResponse>;
  restore: (signedTransactions: readonly string[]) => Promise<RestoreOutcome>;
}

export interface AppleBillingDeps {
  readonly api: AppleBillingApi;
  /** Called ONLY after the server has verified a purchase or restore: re-reads the account's entitlement. */
  readonly refreshEntitlement: () => Promise<void> | void;
  /** Overridable for tests; defaults to the real platform. */
  readonly platform?: string;
}

/** One App Store plan as the App Store itself reports it for this storefront. The product id stays inside this module's callers. */
export interface ApplePlan {
  readonly plan: PlanKey;
  readonly productId: string;
  /** The App Store's own localized price string (never built or hardcoded by the app). */
  readonly localizedPrice: string;
  /** The price in currency units as StoreKit reports it, for the per-storefront discount arithmetic; null if unreadable. */
  readonly priceAmount: number | null;
  readonly currencyCode: string | null;
  /** ISO-8601 recurring period derived from StoreKit's period unit ("P1M" / "P1Y"). */
  readonly billingPeriod: string | null;
}

export type ApplePlansResult =
  | { readonly kind: 'ready'; readonly plans: readonly ApplePlan[] }
  | { readonly kind: 'unavailable'; readonly reason: OfferUnavailableReason };

export interface AppleBilling {
  /** The App Store's localized prices of the allowlisted monthly and yearly products. */
  loadPlans: () => Promise<ApplePlansResult>;
  /** Starts the StoreKit purchase for a plan. Resolves only after the SERVER has answered - never from the store callback alone. */
  purchase: (plan: PlanKey) => Promise<PurchaseResult>;
  /** Restore purchases (Apple requires it): StoreKit syncs, then each transaction it reports is verified by the SERVER before anything is granted. */
  restore: () => Promise<RestoreResult>;
  /** Releases the store connection and listeners. */
  dispose: () => Promise<void>;
}

// react-native-iap error codes compared as strings, so this module does not need the library's runtime enum.
const USER_CANCELLED = 'user-cancelled';
const PENDING_CODES = new Set(['pending', 'deferred-payment']);
const ALREADY_OWNED = 'already-owned';

/**
 * The iOS (App Store / StoreKit 2) purchase flow. Strict order, enforced here and nowhere else - the same as Google Play's:
 *
 *   catalog -> StoreKit products and their localized prices -> purchase sheet (with the server-issued App Account Token) -> StoreKit
 *   update -> SERVER verify (Apple's signature, then the status re-read from the App Store Server API, linked to this account) ->
 *   only then finish the StoreKit transaction -> refresh the entitlement.
 *
 * Nothing is granted, finished or "unlocked" from the StoreKit callback alone. A server failure leaves the transaction UNFINISHED, so
 * StoreKit delivers it again (next launch / restore) and nothing the person paid for is lost. The signed transaction (the JWS StoreKit 2
 * gives as the purchase token) is the only thing sent: never a price, an expiry or a state.
 */
export function createAppleBilling(deps: AppleBillingDeps): AppleBilling {
  const platform = deps.platform ?? Platform.OS;
  let connected: Promise<void> | null = null;
  let updateSubscription: EventSubscription | null = null;
  let errorSubscription: EventSubscription | null = null;
  let waiter: ((result: PurchaseResult) => void) | null = null;
  let activeProductIds: ReadonlySet<string> = new Set();
  let appAccountToken: string | null = null;
  const inFlight = new Map<string, Promise<PurchaseResult>>();

  const settle = (result: PurchaseResult): void => {
    const current = waiter;
    waiter = null;
    current?.(result);
  };

  const connect = (): Promise<void> => {
    connected ??= (async () => {
      await initConnection();
      updateSubscription = purchaseUpdatedListener(purchase => {
        handlePurchase(purchase).then(settle).catch(() => settle({ kind: 'error', code: 'unexpected' }));
      });
      errorSubscription = purchaseErrorListener(error => settle(mapStoreError(error)));
    })().catch(error => {
      connected = null;
      throw error;
    });
    return connected;
  };

  const handlePurchase = (purchase: Purchase): Promise<PurchaseResult> => {
    // Only the configured membership products are ours; any other store item is none of this module's business.
    if (!activeProductIds.has(purchase.productId)) {
      return Promise.resolve({ kind: 'error', code: 'unexpected-product' });
    }
    if (purchase.purchaseState === 'pending') {
      return Promise.resolve({ kind: 'pending' });
    }
    const signedTransaction = purchase.purchaseToken;
    if (!signedTransaction) {
      return Promise.resolve({ kind: 'error', code: 'missing-transaction' });
    }

    // A duplicate callback for the same transaction converges on the one verification already running.
    const key = purchase.transactionId || signedTransaction;
    const running = inFlight.get(key);
    if (running) {
      return running;
    }
    const work = verifyThenFinish(purchase, signedTransaction).finally(() => inFlight.delete(key));
    inFlight.set(key, work);
    return work;
  };

  const verifyThenFinish = async (purchase: Purchase, signedTransaction: string): Promise<PurchaseResult> => {
    let verified: VerifyResponse;
    try {
      verified = await deps.api.verify(signedTransaction);
    } catch (error) {
      // The server did not confirm: do NOT finish, do NOT grant. The unfinished transaction stays recoverable.
      return { kind: 'verificationFailed', reason: failureReason(error) };
    }

    if (verified.outcome === 'pending') {
      return { kind: 'pending' };
    }

    // Finish once the server has the transaction (granting or not): StoreKit keeps redelivering an unfinished one forever.
    try {
      await finishTransaction({ purchase, isConsumable: false });
    } catch {
      // Best effort: the server already holds the transaction, so a failed local finish changes nothing.
    }

    await deps.refreshEntitlement();
    return verified.outcome === 'verified' ? { kind: 'verified', state: verified.state } : { kind: 'notEntitled' };
  };

  const loadPlans = async (): Promise<ApplePlansResult> => {
    if (platform !== 'ios') {
      return { kind: 'unavailable', reason: 'unsupportedPlatform' };
    }

    let catalog: AppleCatalog;
    try {
      catalog = await deps.api.getCatalog();
    } catch {
      return { kind: 'unavailable', reason: 'storeUnavailable' };
    }
    if (!catalog.enabled || catalog.productIds.length === 0 || !catalog.appAccountToken) {
      return { kind: 'unavailable', reason: 'disabled' };
    }

    try {
      await connect();
      const products = await fetchProducts({ skus: [...catalog.productIds], type: 'subs' });
      const plans: ApplePlan[] = [];
      for (const product of products ?? []) {
        if (product.platform !== 'ios' || product.type !== 'subs' || !catalog.productIds.includes(product.id)) {
          continue;
        }
        const plan = planOf(product.subscriptionPeriodUnitIOS, product.subscriptionPeriodNumberIOS);
        if (!plan || plans.some(existing => existing.plan === plan)) {
          continue;
        }
        const amount = typeof product.price === 'number' && Number.isFinite(product.price) && product.price > 0 ? product.price : null;
        plans.push({
          plan,
          productId: product.id,
          localizedPrice: product.displayPrice,
          priceAmount: amount,
          currencyCode: product.currency || null,
          billingPeriod: plan === 'monthly' ? 'P1M' : 'P1Y',
        });
      }
      if (plans.length === 0) {
        return { kind: 'unavailable', reason: 'productNotFound' };
      }
      activeProductIds = new Set(plans.map(candidate => candidate.productId));
      appAccountToken = catalog.appAccountToken;
      return { kind: 'ready', plans };
    } catch {
      return { kind: 'unavailable', reason: 'storeUnavailable' };
    }
  };

  const purchase = async (plan: PlanKey): Promise<PurchaseResult> => {
    const loaded = await loadPlans();
    if (loaded.kind !== 'ready') {
      return { kind: 'unavailable', reason: loaded.reason };
    }
    const chosen = loaded.plans.find(candidate => candidate.plan === plan);
    if (!chosen || !appAccountToken) {
      return { kind: 'unavailable', reason: 'productNotFound' };
    }

    const outcome = new Promise<PurchaseResult>(resolve => {
      waiter = resolve;
    });
    try {
      await requestPurchase({
        type: 'subs',
        request: {
          apple: {
            sku: chosen.productId,
            // The server-issued opaque UUID (never the user id): how Apple's transactions and notifications are tied back to this account.
            appAccountToken,
          },
        },
      });
    } catch (error) {
      settle(mapStoreError(error as PurchaseError));
    }
    return outcome;
  };

  const restore = async (): Promise<RestoreResult> => {
    if (platform !== 'ios') {
      return { kind: 'unavailable', reason: 'unsupportedPlatform' };
    }

    let catalog: AppleCatalog;
    try {
      catalog = await deps.api.getCatalog();
    } catch {
      return { kind: 'temporaryFailure' };
    }
    if (!catalog.enabled) {
      return { kind: 'unavailable', reason: 'disabled' };
    }

    try {
      await connect();
      // Ask StoreKit to sync with the App Store first (a fresh install holds nothing until it does).
      await restorePurchases();
      // What the device reports is only a list of candidates for the SERVER to check - it is not an entitlement.
      const held = await getAvailablePurchases({ onlyIncludeActiveItemsIOS: false });
      const signed = [...new Set((held ?? []).filter(item => catalog.productIds.includes(item.productId) && item.purchaseToken).map(item => item.purchaseToken as string))];
      const outcome = await deps.api.restore(signed);
      if (outcome === 'restored') {
        await deps.refreshEntitlement();
      }
      return { kind: outcome };
    } catch {
      return { kind: 'temporaryFailure' };
    }
  };

  const dispose = async (): Promise<void> => {
    settle({ kind: 'cancelled' });
    updateSubscription?.remove();
    errorSubscription?.remove();
    updateSubscription = null;
    errorSubscription = null;
    const wasConnected = connected !== null;
    connected = null;
    activeProductIds = new Set();
    appAccountToken = null;
    if (wasConnected) {
      try {
        await endConnection();
      } catch {
        // Already closed.
      }
    }
  };

  return { loadPlans, purchase, restore, dispose };
}

/** StoreKit reports the recurring period as a unit and a count: 1 month = monthly, 1 year (or 12 months) = yearly; anything else is not a Juple plan. */
function planOf(unit: string | null | undefined, count: string | null | undefined): PlanKey | null {
  const n = Number(count ?? '1');
  if (unit === 'month' && n === 1) {
    return 'monthly';
  }
  if ((unit === 'year' && n === 1) || (unit === 'month' && n === 12)) {
    return 'yearly';
  }
  return null;
}

function mapStoreError(error: PurchaseError): PurchaseResult {
  const code = String(error?.code ?? 'unknown');
  if (code === USER_CANCELLED) {
    return { kind: 'cancelled' };
  }
  if (PENDING_CODES.has(code)) {
    return { kind: 'pending' };
  }
  if (code === ALREADY_OWNED) {
    return { kind: 'alreadyOwned' };
  }
  return { kind: 'error', code };
}

function failureReason(error: unknown): VerificationFailureReason {
  if (error instanceof ApiError) {
    if (error.code === BILLING_ERROR_CODES.belongsToAnotherAccount) {
      return 'belongsToAnotherAccount';
    }
    if (error.kind === 'badRequest' || error.kind === 'forbidden' || error.kind === 'notFound') {
      return 'rejected';
    }
  }
  return 'temporary';
}
