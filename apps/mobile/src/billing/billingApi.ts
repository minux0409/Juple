import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import type { AppleCatalog, GoogleCatalog, RestoreOutcome, VerifyOutcome, VerifyResponse } from './types';

const VERIFY_OUTCOMES: readonly VerifyOutcome[] = ['verified', 'pending', 'notEntitled'];
const RESTORE_OUTCOMES: readonly RestoreOutcome[] = ['restored', 'nothingFound', 'belongsToAnotherJupleAccount', 'temporaryFailure'];

/** The stable machine-readable codes the Backend answers with (see GoogleBillingController). */
export const BILLING_ERROR_CODES = {
  belongsToAnotherAccount: 'purchaseBelongsToAnotherAccount',
  notAllowed: 'purchaseNotAllowed',
  invalidToken: 'invalidPurchaseToken',
} as const;

/** The non-secret purchase configuration. A disabled or malformed answer is "not enabled" - never a guessed product. */
export async function getGoogleCatalog(request: AuthenticatedApiRequest): Promise<GoogleCatalog> {
  const response = await request<Partial<GoogleCatalog>>({ method: 'GET', path: '/api/v1/billing/google/catalog' });
  const body = response.body;
  if (
    !body ||
    body.enabled !== true ||
    typeof body.productId !== 'string' ||
    typeof body.basePlanId !== 'string' ||
    typeof body.obfuscatedAccountId !== 'string'
  ) {
    return { enabled: false, productId: null, basePlanId: null, basePlanIds: [], obfuscatedAccountId: null };
  }
  // An older server answers only `basePlanId`: then that one plan is the whole catalog.
  const listed = Array.isArray(body.basePlanIds) ? body.basePlanIds.filter((plan): plan is string => typeof plan === 'string' && plan.length > 0) : [];
  const basePlanIds = listed.length > 0 ? listed : [body.basePlanId];
  return { enabled: true, productId: body.productId, basePlanId: body.basePlanId, basePlanIds, obfuscatedAccountId: body.obfuscatedAccountId };
}

/**
 * Hands the purchase token to the server, which verifies it with Google itself. Only the token is sent - never a price, an expiry, a
 * state, a package or an entitlement the client could claim. Throws ApiError (409 purchaseBelongsToAnotherAccount, 400, 503 ...).
 */
export async function verifyGooglePurchase(request: AuthenticatedApiRequest, purchaseToken: string): Promise<VerifyResponse> {
  const response = await request<Partial<VerifyResponse>>({ method: 'POST', path: '/api/v1/billing/google/verify', body: { purchaseToken } });
  const body = response.body;
  const outcome = VERIFY_OUTCOMES.find(candidate => candidate === body?.outcome);
  if (!body || !outcome) {
    throw new Error('Unexpected verification response.');
  }
  return { outcome, state: typeof body.state === 'string' ? body.state : 'unknown', acknowledged: body.acknowledged === true };
}

/** Restore: the tokens Google Play says the device holds (each is verified server-side), or none to refresh the account's own purchases. */
export async function restoreGooglePurchases(request: AuthenticatedApiRequest, purchaseTokens: readonly string[]): Promise<RestoreOutcome> {
  const response = await request<{ outcome?: string }>({ method: 'POST', path: '/api/v1/billing/google/restore', body: { purchaseTokens } });
  return RESTORE_OUTCOMES.find(candidate => candidate === response.body?.outcome) ?? 'temporaryFailure';
}

/** The non-secret App Store purchase configuration. A disabled or malformed answer is "not enabled" - never a guessed product. */
export async function getAppleCatalog(request: AuthenticatedApiRequest): Promise<AppleCatalog> {
  const response = await request<{ enabled?: unknown; productIds?: unknown; appAccountToken?: unknown }>({ method: 'GET', path: '/api/v1/billing/apple/catalog' });
  const body = response.body;
  const productIds = Array.isArray(body?.productIds) ? body.productIds.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
  if (!body || body.enabled !== true || productIds.length === 0 || typeof body.appAccountToken !== 'string' || body.appAccountToken.length === 0) {
    return { enabled: false, productIds: [], appAccountToken: null };
  }
  return { enabled: true, productIds, appAccountToken: body.appAccountToken };
}

/**
 * Hands the signed transaction (the JWS StoreKit 2 produced) to the server. The server checks Apple's signature and then reads the
 * subscription's state again from the App Store Server API: nothing in it - price, expiry, state - is ever believed by the server or
 * decided here. Throws ApiError (409 purchaseBelongsToAnotherAccount, 400 purchaseNotAllowed / invalidTransaction, 503 storeUnavailable).
 */
export async function verifyAppleTransaction(request: AuthenticatedApiRequest, signedTransaction: string): Promise<VerifyResponse> {
  const response = await request<{ outcome?: string; state?: string }>({ method: 'POST', path: '/api/v1/billing/apple/verify', body: { signedTransaction } });
  const body = response.body;
  const outcome = VERIFY_OUTCOMES.find(candidate => candidate === body?.outcome);
  if (!body || !outcome) {
    throw new Error('Unexpected verification response.');
  }
  // There is nothing to acknowledge on the App Store: `acknowledged` is always true there.
  return { outcome, state: typeof body.state === 'string' ? body.state : 'unknown', acknowledged: true };
}

/** Restore: the signed transactions StoreKit says the device holds (each verified server-side), or none to refresh the account's own purchases. */
export async function restoreAppleTransactions(request: AuthenticatedApiRequest, signedTransactions: readonly string[]): Promise<RestoreOutcome> {
  const response = await request<{ outcome?: string }>({ method: 'POST', path: '/api/v1/billing/apple/restore', body: { signedTransactions } });
  return RESTORE_OUTCOMES.find(candidate => candidate === response.body?.outcome) ?? 'temporaryFailure';
}
