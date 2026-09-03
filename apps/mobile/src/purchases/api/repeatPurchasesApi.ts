import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';

export type IntervalUnit = 'day' | 'week' | 'month';

/**
 * Mirrors RepeatPurchasesController.RepeatPurchaseResponse (Backend, /api/v1/repeat-purchases).
 * This first slice only reads the list - create/update/enable/disable/delete/log-purchase are not
 * wired up yet, so only the fields a list row needs are consumed today, but the shape mirrors the
 * full Backend response for when those are added.
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
