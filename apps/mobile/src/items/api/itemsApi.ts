import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';
import type { RepresentativeImage } from '../../images/api/imagesApi';
import { COLLECTION_UNLOCK_HEADER_NAME } from '../../collections/collectionUnlockGrants';

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
  /** Redacted by the server while the relevant Collection's content gate is active. */
  readonly isCollectionLocked?: boolean;
  readonly collectionId?: number | null;
  readonly collectionGate?: 'lock' | 'sharePassword' | null;
}

export interface ItemHistoryPage {
  readonly items: readonly ItemHistoryEntry[];
  readonly nextCursor: string | null;
}

export interface GetItemHistoryOptions {
  readonly limit?: number;
  /** Opaque value from a previous ItemHistoryPage.nextCursor; never parsed or modified. */
  readonly cursor?: string;
  /**
   * One History section's window, exactly as GET /api/v1/items/history/sections returned it
   * (ItemHistorySection.fromUtc/toUtc) - the page then holds only that section's links, and its
   * cursor only continues inside it. Omitted: the whole History, unchanged.
   */
  readonly fromUtc?: string;
  readonly toUtc?: string | null;
  /**
   * Search the caller's WHOLE archive (title, link / site, own memo) instead - newest first, the same
   * cursor and page shape. 2-100 characters after trimming; not combined with fromUtc/toUtc.
   */
  readonly q?: string;
}

/** All Items the user has ever saved, newest-saved-first (or one section's window of them - see fromUtc). */
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
  if (options.q) {
    query.set('q', options.q);
  }
  if (options.fromUtc) {
    query.set('fromUtc', options.fromUtc);
  }
  if (options.toUtc) {
    query.set('toUtc', options.toUtc);
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

/**
 * One non-empty History section from the summary: identity (key matches groupByLocalDate's
 * dateKey - "YYYY-MM-DD" for today/yesterday, "thisWeek", "month:YYYY-MM"), the exact number of
 * links in it, and the window its links are read from. Never a display label - see
 * historySectionLabel.
 */
export interface ItemHistorySection {
  readonly key: string;
  readonly kind: 'today' | 'yesterday' | 'thisWeek' | 'month';
  readonly year: number | null;
  readonly month: number | null;
  readonly fromUtc: string;
  /** Null: open-ended (today). */
  readonly toUtc: string | null;
  readonly count: number;
}

/**
 * How many History links fall in [fromUtc, toUtc) (toUtc omitted: open-ended) - the exact total of
 * the window getItemHistory pages through with the same fromUtc/toUtc. Counts only, no link data.
 */
export async function getItemHistoryCount(
  request: AuthenticatedApiRequest,
  window: { readonly fromUtc: string; readonly toUtc?: string | null },
): Promise<number> {
  const query = new URLSearchParams({ fromUtc: window.fromUtc });
  if (window.toUtc) {
    query.set('toUtc', window.toUtc);
  }
  const response = await request<{ readonly count: number }>({
    method: 'GET',
    path: `/api/v1/items/history/count?${query.toString()}`,
  });

  if (!response.body) {
    throw new Error('Juple API returned no Item history count body.');
  }

  return response.body.count;
}

/** The History summary - every non-empty section with its exact count, newest first; no link data. */
export async function getItemHistorySections(request: AuthenticatedApiRequest): Promise<readonly ItemHistorySection[]> {
  const response = await request<{ readonly sections: readonly ItemHistorySection[] }>({
    method: 'GET',
    path: '/api/v1/items/history/sections',
  });

  if (!response.body) {
    throw new Error('Juple API returned no Item history sections body.');
  }

  return response.body.sections;
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

/**
 * The Collection a link is being read IN (a Home/Archive card gated by that Collection): the server then applies that
 * Collection's CURRENT gate first and needs this opening's grant for it - see GET items/{id}?collectionId=.
 */
export interface ItemReadContext {
  readonly collectionId: number;
  readonly unlockToken: string | null;
}

/** The query string and grant header of a read in a Collection's context (none without one). */
export function itemReadContextRequest(context: ItemReadContext | null | undefined): { readonly query: string; readonly headers?: Readonly<Record<string, string>> } {
  if (!context) {
    return { query: '' };
  }
  return {
    query: `?collectionId=${context.collectionId}`,
    headers: context.unlockToken ? { [COLLECTION_UNLOCK_HEADER_NAME]: context.unlockToken } : undefined,
  };
}

export async function getItemDetails(
  request: AuthenticatedApiRequest,
  itemId: number,
  context?: ItemReadContext | null,
): Promise<ItemDetails> {
  const { query, headers } = itemReadContextRequest(context);
  const response = await request<ItemDetails>({
    method: 'GET',
    path: `/api/v1/items/${itemId}${query}`,
    headers,
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

/** Raw OpenGraph values read from an Instagram post's public page on this device - see instagramOpenGraphFetch.ts. */
export interface InstagramMetadataCandidate {
  readonly ogTitle: string | null;
  readonly ogImage: string | null;
  readonly ogUrl: string | null;
  readonly ogDescription: string | null;
}

export interface InstagramMetadataCandidateResult {
  readonly title: string | null;
  readonly previewImageUrl: string | null;
  /** False when nothing changed (nothing usable, or the fields were already filled). */
  readonly applied: boolean;
}

/**
 * Sends a device-fetched Instagram OpenGraph candidate for the caller's own Item. The Backend alone
 * validates/normalizes it and applies it as automatic metadata (only to still-empty fields - never
 * a user's own title), then returns the Item's resulting title/preview image. Deliberately NOT the
 * user title-edit (updateItemDetails) or preview-image (setItemPreviewImage) API - see backend
 * ApplyInstagramMetadataCandidateService. Rejects with ApiError (400) for a candidate that is not
 * this Item's Instagram post.
 */
export async function submitInstagramMetadataCandidate(
  request: AuthenticatedApiRequest,
  itemId: number,
  candidate: InstagramMetadataCandidate,
): Promise<InstagramMetadataCandidateResult> {
  const response = await request<InstagramMetadataCandidateResult>({
    method: 'POST',
    path: `/api/v1/items/${itemId}/instagram-metadata-candidate`,
    body: candidate,
  });

  if (!response.body) {
    throw new Error('Juple API returned no Instagram metadata candidate result.');
  }

  return response.body;
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

/**
 * One Trash row - the Item as it was when deleted. Deliberately no `memo` (unlike ItemHistoryEntry)
 * - see backend ItemTrashEntryDto, which intentionally excludes it from this endpoint's response.
 */
export interface ItemTrashEntry {
  readonly id: number;
  readonly url: string;
  readonly title: string | null;
  readonly deletedAtUtc: string;
  readonly representativeImage: RepresentativeImage | null;
  readonly previewImageUrl: string | null;
  readonly coverImage: RepresentativeImage | null;
}

interface ItemTrashResponse {
  readonly items: readonly ItemTrashEntry[];
}

/**
 * Mirrors backend ItemTrashLimits.ListLimit - the same for every user. Display-only (e.g. TrashScreen's
 * notice): the server alone enforces the cap, which is why getTrashItems never sends a limit.
 */
export const TRASH_LIST_LIMIT = 50;

/**
 * The caller's most-recently-deleted Items - the server already caps this at TRASH_LIST_LIMIT
 * (see backend ItemTrashLimits), so this never accepts a limit/cursor.
 */
export async function getTrashItems(request: AuthenticatedApiRequest): Promise<readonly ItemTrashEntry[]> {
  const response = await request<ItemTrashResponse>({
    method: 'GET',
    path: '/api/v1/items/trash',
  });

  if (!response.body) {
    throw new Error('Juple API returned no Item trash body.');
  }

  return response.body.items;
}

/** Restores a trashed Item back to active; resolves on 204 (404 if the Item isn't currently in the trash). */
export async function restoreItem(request: AuthenticatedApiRequest, itemId: number): Promise<void> {
  await request<void>({
    method: 'POST',
    path: `/api/v1/items/${itemId}/restore`,
  });
}

/** Permanently deletes a single trashed Item; resolves on 204 (404 if the Item isn't currently in the trash - an active Item can never be permanently deleted this way). */
export async function permanentlyDeleteItem(request: AuthenticatedApiRequest, itemId: number): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: `/api/v1/items/${itemId}/permanent`,
  });
}

/** Permanently deletes every one of the caller's trashed Items in one call - the whole server-side trash, not just what the capped list shows. Resolves on 204. */
export async function emptyTrash(request: AuthenticatedApiRequest): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: '/api/v1/items/trash',
  });
}
