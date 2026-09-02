import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';

/**
 * Mirrors PurchasesController.PurchaseResponse (Backend, /api/v1/purchases). Amount/Quantity are
 * plain decimal strings on the wire, never numbers - a value like "999999999999999.9999" is valid
 * in the Backend's decimal(19,4) column but is not exactly representable as a JS Number, so this
 * type (and every screen reading it) must never call Number()/parseFloat() on them. Treat them the
 * same way `purchaseDate` and `cursor` are already treated: opaque strings passed through verbatim.
 */
export interface Purchase {
  readonly id: number;
  readonly itemId: number | null;
  readonly productName: string;
  /** "YYYY-MM-DD" (DateOnly) - never a timestamp, never parsed as UTC. */
  readonly purchaseDate: string;
  readonly amount: string | null;
  readonly currencyCode: string | null;
  readonly store: string | null;
  readonly variant: string | null;
  readonly quantity: string | null;
  readonly memo: string | null;
  readonly createdAtUtc: string;
}

export interface PurchasePage {
  readonly purchases: readonly Purchase[];
  readonly nextCursor: string | null;
}

export interface GetPurchasesOptions {
  readonly limit?: number;
  /** Opaque value from a previous PurchasePage.nextCursor; never parsed or modified. */
  readonly cursor?: string;
}

export async function getPurchases(
  request: AuthenticatedApiRequest,
  options: GetPurchasesOptions = {},
): Promise<PurchasePage> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) {
    query.set('limit', String(options.limit));
  }
  if (options.cursor) {
    query.set('cursor', options.cursor);
  }

  const queryString = query.toString();
  const response = await request<PurchasePage>({
    method: 'GET',
    path: queryString ? `/api/v1/purchases?${queryString}` : '/api/v1/purchases',
  });

  if (!response.body) {
    throw new Error('Juple API returned no Purchase page body.');
  }

  return response.body;
}

/**
 * Mirrors PurchasesController.CreatePurchaseRequest. Callers pass already-normalized values.
 * Amount/Quantity are the raw decimal strings the user typed (trimmed) - never parsed to a number
 * on the client. The Backend is the sole source of truth for decimal format/range/scale
 * validation; see PurchaseEditorScreen's client-side format pre-check.
 */
export interface CreatePurchaseInput {
  readonly itemId: number | null;
  readonly productName: string;
  readonly purchaseDate: string;
  readonly amount: string | null;
  readonly currencyCode: string | null;
  readonly store: string | null;
  readonly variant: string | null;
  readonly quantity: string | null;
  readonly memo: string | null;
}

/** POSTs a new Purchase; resolves with the created Purchase on 201. */
export async function createPurchase(
  request: AuthenticatedApiRequest,
  input: CreatePurchaseInput,
): Promise<Purchase> {
  const response = await request<Purchase>({
    method: 'POST',
    path: '/api/v1/purchases',
    body: input,
  });

  if (!response.body) {
    throw new Error('Juple API returned no Purchase body.');
  }

  return response.body;
}
