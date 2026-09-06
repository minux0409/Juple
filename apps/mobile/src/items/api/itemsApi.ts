import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';
import type { RepresentativeImage } from '../../images/api/imagesApi';

export interface ItemDetails {
  readonly id: number;
  readonly url: string;
  readonly title: string | null;
  readonly memo: string | null;
  readonly savedAtUtc: string;
}

/** A History row - the Item as it was originally saved. */
export interface ItemHistoryEntry {
  readonly id: number;
  readonly url: string;
  readonly title: string | null;
  readonly memo: string | null;
  readonly savedAtUtc: string;
  readonly representativeImage: RepresentativeImage | null;
}

export interface ItemHistoryPage {
  readonly items: readonly ItemHistoryEntry[];
  readonly nextCursor: string | null;
}

export interface GetItemHistoryOptions {
  readonly limit?: number;
  /** Opaque value from a previous ItemHistoryPage.nextCursor; never parsed or modified. */
  readonly cursor?: string;
}

/** All Items the user has ever saved, newest-saved-first. */
export async function getItemHistory(
  request: AuthenticatedApiRequest,
  options: GetItemHistoryOptions = {},
): Promise<ItemHistoryPage> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) {
    query.set('limit', String(options.limit));
  }
  if (options.cursor) {
    query.set('cursor', options.cursor);
  }
  const queryString = query.toString();

  const response = await request<ItemHistoryPage>({
    method: 'GET',
    path: queryString ? `/api/v1/items/history?${queryString}` : '/api/v1/items/history',
  });

  if (!response.body) {
    throw new Error('Juple API returned no Item history page body.');
  }

  return response.body;
}

export interface ItemHistoryByDate {
  readonly date: string;
  readonly items: readonly ItemHistoryEntry[];
  readonly nextCursor: string | null;
}

export interface GetItemHistoryByDateOptions {
  readonly limit?: number;
  /** Opaque value from a previous ItemHistoryByDate.nextCursor; never parsed or modified. */
  readonly cursor?: string;
}

/**
 * Items saved on a single local calendar date - powers Home ("오늘 저장한 링크"), which is the same
 * underlying concept as History's "오늘" section, just windowed to one day instead of open-ended.
 * date must be a `YYYY-MM-DD` local calendar date (e.g. from formatDateOnly(new Date())); the
 * Backend converts it to a UTC range using the current user's own timezone. Cursor-paginated
 * exactly like getItemHistory - a day's worth of Items is unbounded, so callers must page via
 * nextCursor rather than assuming one response has everything.
 */
export async function getItemHistoryByDate(
  request: AuthenticatedApiRequest,
  date: string,
  options: GetItemHistoryByDateOptions = {},
): Promise<ItemHistoryByDate> {
  const query = new URLSearchParams({ date });
  if (options.limit !== undefined) {
    query.set('limit', String(options.limit));
  }
  if (options.cursor) {
    query.set('cursor', options.cursor);
  }

  const response = await request<ItemHistoryByDate>({
    method: 'GET',
    path: `/api/v1/items/history/date?${query.toString()}`,
  });

  if (!response.body) {
    throw new Error('Juple API returned no Item history-by-date body.');
  }

  return response.body;
}

/**
 * POSTs the "opened original URL" event (My Page → "최근 본 링크" / Recently opened links); resolves
 * on 204. Best-effort by convention - see ItemDetailsScreen's usage: a failure here must never
 * surface as a failure to open the URL itself, which has already succeeded by the time this is
 * called.
 */
export async function recordItemOpen(
  request: AuthenticatedApiRequest,
  itemId: number,
): Promise<void> {
  await request<void>({
    method: 'POST',
    path: `/api/v1/items/${itemId}/open`,
  });
}

/** DELETEs the Item; resolves on 204 (idempotent - missing/already-deleted/other-user's Item all succeed too). */
export async function deleteItem(
  request: AuthenticatedApiRequest,
  itemId: number,
): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: `/api/v1/items/${itemId}`,
  });
}

export async function getItemDetails(
  request: AuthenticatedApiRequest,
  itemId: number,
): Promise<ItemDetails> {
  const response = await request<ItemDetails>({
    method: 'GET',
    path: `/api/v1/items/${itemId}`,
  });

  if (!response.body) {
    throw new Error('Juple API returned no Item detail body.');
  }

  return response.body;
}

export interface UpdateItemDetailsInput {
  readonly title: string;
  readonly memo: string;
}

/** PUTs the Item's Title/Memo as a full replacement; resolves on 204. */
export async function updateItemDetails(
  request: AuthenticatedApiRequest,
  itemId: number,
  details: UpdateItemDetailsInput,
): Promise<void> {
  await request<void>({
    method: 'PUT',
    path: `/api/v1/items/${itemId}/details`,
    body: details,
  });
}
