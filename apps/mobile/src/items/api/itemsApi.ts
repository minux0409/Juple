import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';
import type { RepresentativeImage } from '../../images/api/imagesApi';

export interface ItemDetails {
  readonly id: number;
  readonly url: string;
  readonly title: string | null;
  readonly memo: string | null;
  readonly savedAtUtc: string;
  /**
   * Best-effort link-preview image auto-extracted from URL metadata (see resolveUrlMetadata) -
   * completely separate from user-uploaded ItemImages (getItemImages/uploadItemImage): at most
   * one, never counted against the user's image limit, never itself uploaded.
   */
  readonly previewImageUrl: string | null;
  /**
   * The user's explicit choice of which of their own uploaded ItemImages represents this Item -
   * completely separate from previewImageUrl above (auto metadata) and representativeImage
   * (always the first-uploaded image, regardless of this choice). See
   * resolveEffectiveThumbnailUrl for the priority order client code should use to pick a single
   * thumbnail: coverImage, then previewImageUrl, then representativeImage.
   */
  readonly coverImage: RepresentativeImage | null;
}

/** A History row - the Item as it was originally saved. */
export interface ItemHistoryEntry {
  readonly id: number;
  readonly url: string;
  readonly title: string | null;
  readonly memo: string | null;
  readonly savedAtUtc: string;
  readonly representativeImage: RepresentativeImage | null;
  readonly previewImageUrl: string | null;
  readonly coverImage: RepresentativeImage | null;
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

/**
 * PUTs the Item's auto-extracted preview image URL; resolves on 204. Always best-effort
 * enrichment - see enrichItemTitleFromUrlMetadata - never called with null/empty (there is no
 * "clear preview image" UI this round); never affects user-uploaded ItemImages.
 */
export async function setItemPreviewImage(
  request: AuthenticatedApiRequest,
  itemId: number,
  previewImageUrl: string,
): Promise<void> {
  await request<void>({
    method: 'PUT',
    path: `/api/v1/items/${itemId}/preview-image`,
    body: { previewImageUrl },
  });
}

/**
 * PUTs the Item's explicit cover image choice; resolves on 204. Pass imageId to set it (must be
 * one of this same Item's own uploaded ItemImages), or null to clear it back to the automatic
 * fallback (previewImageUrl, then the first-uploaded image). Immediate persistence, independent
 * of ItemDetailsScreen's title/memo Save - see that screen's own image semantics.
 */
export async function setItemCoverImage(
  request: AuthenticatedApiRequest,
  itemId: number,
  imageId: number | null,
): Promise<void> {
  await request<void>({
    method: 'PUT',
    path: `/api/v1/items/${itemId}/cover-image`,
    body: { imageId },
  });
}
