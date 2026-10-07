import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import type { GoogleCatalog, RestoreOutcome, VerifyOutcome, VerifyResponse } from './types';

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
    return { enabled: false, productId: null, basePlanId: null, obfuscatedAccountId: null };
  }
  return { enabled: true, productId: body.productId, basePlanId: body.basePlanId, obfuscatedAccountId: body.obfuscatedAccountId };
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
