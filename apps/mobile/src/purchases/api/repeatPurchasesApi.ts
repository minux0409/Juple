import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';

export type IntervalUnit = 'day' | 'week' | 'month';

/**
 * Mirrors RepeatPurchasesController.RepeatPurchaseResponse (Backend, /api/v1/repeat-purchases).
 * List/detail/create/update are wired up - enable/disable/delete/log-purchase are not yet, so
 * IsEnabled is read-only informational text for now (see RepeatPurchaseDetailsScreen) and
 * Reminder fields are never shown/edited in any UI (see RepeatPurchaseEditorScreen).
 */
export interface RepeatPurchase {
  readonly id: number;
  readonly itemId: number | null;
  readonly productName: string;
  readonly intervalValue: number;
  readonly intervalUnit: IntervalUnit;
  /** "YYYY-MM-DD" (DateOnly) - never a timestamp, never parsed as UTC. */
  readonly nextPurchaseDate: string;
  readonly isReminderEnabled: boolean;
  readonly reminderLeadDays: number;
  readonly isEnabled: boolean;
  readonly createdAtUtc: string;
  readonly updatedAtUtc: string;
  /** Opaque optimistic-concurrency token (RowVersion); never parsed or modified. */
  readonly version: string;
}

export interface RepeatPurchasePage {
  readonly repeatPurchases: readonly RepeatPurchase[];
  readonly nextCursor: string | null;
}

export interface GetRepeatPurchasesOptions {
  readonly limit?: number;
  /** Opaque value from a previous RepeatPurchasePage.nextCursor; never parsed or modified. */
  readonly cursor?: string;
  /** When set, restricts the page to this Item's RepeatPurchases (404 on a missing/other-user Item). */
  readonly itemId?: number;
  /** Omitted/false (default) returns only enabled RepeatPurchases; true also includes disabled ones. */
  readonly includeDisabled?: boolean;
}

/** GET /api/v1/repeat-purchases - sorted NextPurchaseDate ASC, Id ASC by the Backend; never re-sorted here. */
export async function getRepeatPurchases(
  request: AuthenticatedApiRequest,
  options: GetRepeatPurchasesOptions = {},
): Promise<RepeatPurchasePage> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) {
    query.set('limit', String(options.limit));
  }
  if (options.cursor) {
    query.set('cursor', options.cursor);
  }
  if (options.itemId !== undefined) {
    query.set('itemId', String(options.itemId));
  }
  if (options.includeDisabled) {
    query.set('includeDisabled', 'true');
  }

  const queryString = query.toString();
  const response = await request<RepeatPurchasePage>({
    method: 'GET',
    path: queryString ? `/api/v1/repeat-purchases?${queryString}` : '/api/v1/repeat-purchases',
  });

  if (!response.body) {
    throw new Error('Juple API returned no RepeatPurchase page body.');
  }

  return response.body;
}

/** GETs a single RepeatPurchase by id; the caller decides how a 404 (`ApiError.kind === 'notFound'`) is shown. */
export async function getRepeatPurchase(
  request: AuthenticatedApiRequest,
  id: number,
): Promise<RepeatPurchase> {
  const response = await request<RepeatPurchase>({
    method: 'GET',
    path: `/api/v1/repeat-purchases/${id}`,
  });

  if (!response.body) {
    throw new Error('Juple API returned no RepeatPurchase body.');
  }

  return response.body;
}

/**
 * Mirrors RepeatPurchasesController.CreateRepeatPurchaseRequest. IsReminderEnabled/ReminderLeadDays
 * are always false/0 from Create - there is no Reminder UI yet (see RepeatPurchaseEditorScreen).
 */
export interface CreateRepeatPurchaseInput {
  readonly itemId: number | null;
  readonly productName: string;
  readonly intervalValue: number;
  readonly intervalUnit: IntervalUnit;
  readonly nextPurchaseDate: string;
  readonly isReminderEnabled: boolean;
  readonly reminderLeadDays: number;
}

/** POSTs a new RepeatPurchase; resolves with the created RepeatPurchase on 201. */
export async function createRepeatPurchase(
  request: AuthenticatedApiRequest,
  input: CreateRepeatPurchaseInput,
): Promise<RepeatPurchase> {
  const response = await request<RepeatPurchase>({
    method: 'POST',
    path: '/api/v1/repeat-purchases',
    body: input,
  });

  if (!response.body) {
    throw new Error('Juple API returned no RepeatPurchase body.');
  }

  return response.body;
}

/**
 * Same fields as CreateRepeatPurchaseInput (PUT is a full replacement) plus the opaque `version`
 * the client last read from GET/POST/PUT - never parsed or constructed, only round-tripped. A
 * mismatched version means someone else changed this RepeatPurchase first; the Backend rejects the
 * write with 409 rather than silently overwriting (see RepeatPurchaseEditorScreen).
 */
export interface UpdateRepeatPurchaseInput extends CreateRepeatPurchaseInput {
  readonly version: string;
}

/** PUTs a full replacement of a RepeatPurchase; resolves with the updated RepeatPurchase (and its new version) on 200. */
export async function updateRepeatPurchase(
  request: AuthenticatedApiRequest,
  id: number,
  input: UpdateRepeatPurchaseInput,
): Promise<RepeatPurchase> {
  const response = await request<RepeatPurchase>({
    method: 'PUT',
    path: `/api/v1/repeat-purchases/${id}`,
    body: input,
  });

  if (!response.body) {
    throw new Error('Juple API returned no RepeatPurchase body.');
  }

  return response.body;
}
