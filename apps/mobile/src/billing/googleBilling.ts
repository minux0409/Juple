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
  type EventSubscription,
  type Purchase,
  type PurchaseError,
} from 'react-native-iap';
import { ApiError } from '../api/ApiError';
import { BILLING_ERROR_CODES } from './billingApi';
import type {
  GoogleCatalog,
  GoogleOffer,
  OfferResult,
  PurchaseResult,
  RestoreOutcome,
  RestoreResult,
  VerificationFailureReason,
  VerifyResponse,
} from './types';

/** The Backend calls this module needs (see billingApi.ts) - injected so the purchase logic is testable without a network. */
export interface GoogleBillingApi {
  getCatalog: () => Promise<GoogleCatalog>;
  verify: (purchaseToken: string) => Promise<VerifyResponse>;
  restore: (purchaseTokens: readonly string[]) => Promise<RestoreOutcome>;
}

export interface GoogleBillingDeps {
  readonly api: GoogleBillingApi;
  /** Called ONLY after the server has verified a purchase or restore: re-reads the account's entitlement. */
  readonly refreshEntitlement: () => Promise<void> | void;
  /** Overridable for tests; defaults to the real platform. */
  readonly platform?: string;
}

export interface GoogleBilling {
  /** The store's localized offer for the configured monthly base plan (price comes from Google Play, never from here). */
  loadOffer: () => Promise<OfferResult>;
  /** Starts the Google Play purchase flow. Resolves only after the SERVER has answered - never from the store callback alone. */
  purchase: () => Promise<PurchaseResult>;
  /** Server-verified restore: nothing the device reports is trusted until the Backend has checked it. */
  restore: () => Promise<RestoreResult>;
  /** Releases the store connection and listeners. */
  dispose: () => Promise<void>;
}

// react-native-iap error codes compared as strings, so this module does not need the library's runtime enum.
const USER_CANCELLED = 'user-cancelled';
const PENDING_CODES = new Set(['pending', 'deferred-payment']);
const ALREADY_OWNED = 'already-owned';

type OfferState = { readonly offer: GoogleOffer } | null;

/**
 * The Android (Google Play) purchase flow. Strict order, enforced here and nowhere else:
 *
 *   catalog -> store product + localized offer -> purchase UI (with the server-issued obfuscated account id) -> purchase callback ->
 *   SERVER verify (the server verifies with Google, links the account and acknowledges) -> only then finish the local transaction ->
 *   refresh the entitlement.
 *
 * Nothing is ever granted, finished or "unlocked" from the store callback alone. A server failure leaves the transaction UNFINISHED so
 * the store (and a restore) can offer it again. Finishing is best effort after server success: on Android it only acknowledges, which
 * the server already did (a repeat is harmless), so a failure of it never undoes a verified purchase.
 */
export function createGoogleBilling(deps: GoogleBillingDeps): GoogleBilling {
  const platform = deps.platform ?? Platform.OS;
  let connected: Promise<void> | null = null;
  let updateSubscription: EventSubscription | null = null;
  let errorSubscription: EventSubscription | null = null;
  let waiter: ((result: PurchaseResult) => void) | null = null;
  let activeOffer: OfferState = null;
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
    // Only the configured subscription is ours; any other store item is none of this module's business.
    if (!activeOffer || purchase.productId !== activeOffer.offer.productId) {
      return Promise.resolve({ kind: 'error', code: 'unexpected-product' });
    }
    if (purchase.purchaseState === 'pending') {
      return Promise.resolve({ kind: 'pending' });
    }
    const token = purchase.purchaseToken;
    if (!token) {
      return Promise.resolve({ kind: 'error', code: 'missing-token' });
    }

    // A duplicate callback for the same purchase converges on the one verification already running.
    const running = inFlight.get(token);
    if (running) {
      return running;
    }
    const work = verifyThenFinish(purchase, token).finally(() => inFlight.delete(token));
    inFlight.set(token, work);
    return work;
  };

  const verifyThenFinish = async (purchase: Purchase, token: string): Promise<PurchaseResult> => {
    let verified: VerifyResponse;
    try {
      verified = await deps.api.verify(token);
    } catch (error) {
      // The server did not confirm: do NOT finish, do NOT grant. The unfinished purchase stays recoverable.
      return { kind: 'verificationFailed', reason: failureReason(error) };
    }

    if (verified.outcome === 'pending') {
      return { kind: 'pending' };
    }

    if (verified.outcome === 'verified') {
      try {
        await finishTransaction({ purchase, isConsumable: false });
      } catch {
        // Best effort: the server has already acknowledged the purchase, so a failed local finish changes nothing.
      }
    }

    await deps.refreshEntitlement();
    return verified.outcome === 'verified' ? { kind: 'verified', state: verified.state } : { kind: 'notEntitled' };
  };

  const loadOffer = async (): Promise<OfferResult> => {
    if (platform !== 'android') {
      return { kind: 'unavailable', reason: 'unsupportedPlatform' };
    }

    let catalog: GoogleCatalog;
    try {
      catalog = await deps.api.getCatalog();
    } catch {
      return { kind: 'unavailable', reason: 'storeUnavailable' };
    }
    if (!catalog.enabled || !catalog.productId || !catalog.basePlanId || !catalog.obfuscatedAccountId) {
      return { kind: 'unavailable', reason: 'disabled' };
    }

    try {
      await connect();
      const products = await fetchProducts({ skus: [catalog.productId], type: 'subs' });
      const product = (products ?? []).find(candidate => candidate.id === catalog.productId);
      if (!product || product.platform !== 'android') {
        return { kind: 'unavailable', reason: 'productNotFound' };
      }

      // The configured monthly base plan; among its offers the plain one (a single, recurring pricing phase - no store trial/intro).
      const forBasePlan = (product.subscriptionOffers ?? []).filter(candidate => candidate.basePlanIdAndroid === catalog.basePlanId && candidate.offerTokenAndroid);
      const offer = forBasePlan.find(candidate => (candidate.pricingPhasesAndroid?.pricingPhaseList.length ?? 1) === 1) ?? forBasePlan[0];
      if (!offer?.offerTokenAndroid) {
        return { kind: 'unavailable', reason: 'offerNotFound' };
      }

      const phases = offer.pricingPhasesAndroid?.pricingPhaseList ?? [];
      const recurring = phases[phases.length - 1];
      const ready: GoogleOffer = {
        productId: catalog.productId,
        basePlanId: catalog.basePlanId,
        offerToken: offer.offerTokenAndroid,
        localizedPrice: recurring?.formattedPrice ?? offer.displayPrice,
        currencyCode: recurring?.priceCurrencyCode ?? offer.currency ?? null,
        billingPeriod: recurring?.billingPeriod ?? null,
        obfuscatedAccountId: catalog.obfuscatedAccountId,
      };
      activeOffer = { offer: ready };
      return { kind: 'ready', offer: ready };
    } catch {
      return { kind: 'unavailable', reason: 'storeUnavailable' };
    }
  };

  const purchase = async (): Promise<PurchaseResult> => {
    const loaded = await loadOffer();
    if (loaded.kind !== 'ready') {
      return { kind: 'unavailable', reason: loaded.reason };
    }
    const { offer } = loaded;

    const outcome = new Promise<PurchaseResult>(resolve => {
      waiter = resolve;
    });
    try {
      await requestPurchase({
        type: 'subs',
        request: {
          google: {
            skus: [offer.productId],
            subscriptionOffers: [{ sku: offer.productId, offerToken: offer.offerToken }],
            // The server-issued opaque id (never the user id): how Google's notifications are tied back to this account.
            obfuscatedAccountId: offer.obfuscatedAccountId,
          },
        },
      });
    } catch (error) {
      settle(mapStoreError(error as PurchaseError));
    }
    return outcome;
  };

  const restore = async (): Promise<RestoreResult> => {
    if (platform !== 'android') {
      return { kind: 'unavailable', reason: 'unsupportedPlatform' };
    }

    let catalog: GoogleCatalog;
    try {
      catalog = await deps.api.getCatalog();
    } catch {
      return { kind: 'temporaryFailure' };
    }
    if (!catalog.enabled || !catalog.productId) {
      return { kind: 'unavailable', reason: 'disabled' };
    }

    try {
      await connect();
      // What the device reports is only a list of candidates for the SERVER to check - it is not an entitlement.
      const held = await getAvailablePurchases({ includeSuspendedAndroid: true });
      const tokens = [...new Set((held ?? []).filter(item => item.productId === catalog.productId && item.purchaseToken).map(item => item.purchaseToken as string))];
      const outcome = await deps.api.restore(tokens);
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
    activeOffer = null;
    if (wasConnected) {
      try {
        await endConnection();
      } catch {
        // Already closed.
      }
    }
  };

  return { loadOffer, purchase, restore, dispose };
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
