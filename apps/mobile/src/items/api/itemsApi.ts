import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';
import type { ItemCategory } from '../../categories/api/categoriesApi';
import type { RepresentativeImage } from '../../images/api/imagesApi';

export interface ItemListEntry {
  readonly id: number;
  readonly url: string;
  readonly title: string | null;
  readonly memo: string | null;
  readonly savedAtUtc: string;
  readonly stateChangedAtUtc: string;
  readonly category: ItemCategory | null;
  readonly representativeImage: RepresentativeImage | null;
}

export type ItemDetailState = 'inbox' | 'wishlist' | 'archived';

export interface ItemDetails {
  readonly id: number;
  readonly url: string;
  readonly title: string | null;
  readonly memo: string | null;
  readonly savedAtUtc: string;
  readonly state: ItemDetailState;
  readonly stateChangedAtUtc: string;
  readonly category: ItemCategory | null;
}

export interface ItemPage {
  readonly items: readonly ItemListEntry[];
  readonly nextCursor: string | null;
}

/**
 * A History row - the Item as it was originally saved. Deliberately has no state/stateChangedAtUtc
 * field: History spans every Inbox/Wishlist/Archived state and is never filtered or ordered by it
 * (see GET /api/v1/items/history).
 */
export interface ItemHistoryEntry {
  readonly id: number;
  readonly url: string;
  readonly title: string | null;
  readonly memo: string | null;
  readonly savedAtUtc: string;
  readonly category: ItemCategory | null;
  readonly representativeImage: RepresentativeImage | null;
}

export interface ItemHistoryPage {
  readonly items: readonly ItemHistoryEntry[];
  readonly nextCursor: string | null;
}

export type ItemListState = 'wishlist' | 'archived';

export interface GetItemsByStateOptions {
  readonly limit?: number;
  /** Opaque value from a previous ItemPage.nextCursor; never parsed or modified. */
  readonly cursor?: string;
  /** When set (non-null), restricts the page to Items in that Category. */
  readonly categoryId?: number | null;
}

export async function getItemsByState(
  request: AuthenticatedApiRequest,
  state: ItemListState,
  options: GetItemsByStateOptions = {},
): Promise<ItemPage> {
  const query = new URLSearchParams({ state });
  if (options.limit !== undefined) {
    query.set('limit', String(options.limit));
  }
  if (options.cursor) {
    query.set('cursor', options.cursor);
  }
  if (options.categoryId !== undefined && options.categoryId !== null) {
    query.set('categoryId', String(options.categoryId));
  }

  const response = await request<ItemPage>({
    method: 'GET',
    path: `/api/v1/items?${query.toString()}`,
  });

  if (!response.body) {
    throw new Error('Juple API returned no Items page body.');
  }

  return response.body;
}

export interface GetItemHistoryOptions {
  readonly limit?: number;
  /** Opaque value from a previous ItemHistoryPage.nextCursor; never parsed or modified. */
  readonly cursor?: string;
}

/**
 * All Items the user has ever saved, newest-saved-first, regardless of current
 * Inbox/Wishlist/Archived state - distinct from getItemsByState (state-filtered) and
 * getTodayInbox (today + Inbox-state only).
 */
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
 * Items saved on a single local calendar date, regardless of current Inbox/Wishlist/Archived
 * state - powers Home ("오늘 저장한 링크"), which is the same underlying concept as History's "오늘"
 * section, just windowed to one day instead of open-ended. date must be a `YYYY-MM-DD` local
 * calendar date (e.g. from formatDateOnly(new Date())); the Backend converts it to a UTC range
 * using the current user's own timezone. Cursor-paginated exactly like getItemHistory - a day's
 * worth of Items is unbounded, so callers must page via nextCursor rather than assuming one
 * response has everything.
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

/** POSTs to the Wishlist transition endpoint; resolves on 204 (idempotent - already-Wishlist succeeds too). */
export async function moveItemToWishlist(
  request: AuthenticatedApiRequest,
  itemId: number,
): Promise<void> {
  await request<void>({
    method: 'POST',
    path: `/api/v1/items/${itemId}/wishlist`,
  });
}

/** POSTs to the Archive transition endpoint; resolves on 204 (idempotent - already-Archived succeeds too). */
export async function moveItemToArchive(
  request: AuthenticatedApiRequest,
  itemId: number,
): Promise<void> {
  await request<void>({
    method: 'POST',
    path: `/api/v1/items/${itemId}/archive`,
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

/** PUTs the Item's Category (or clears it with null); resolves on 204. */
export async function setItemCategory(
  request: AuthenticatedApiRequest,
  itemId: number,
  categoryId: number | null,
): Promise<void> {
  await request<void>({
    method: 'PUT',
    path: `/api/v1/items/${itemId}/category`,
    body: { categoryId },
  });
}
