import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';

/**
 * Matches Juple.Api.Controllers.ItemImagesController.ItemImageResponse exactly - BlobName is
 * never part of this contract, and there is no itemId field on the per-image response (the
 * caller already knows which Item it asked about).
 */
export interface ItemImage {
  readonly id: number;
  readonly contentType: string;
  readonly byteLength: number;
  readonly sortOrder: number;
  readonly createdAtUtc: string;
  readonly readUrl: string | null;
}

interface ItemImagesResponse {
  readonly images: readonly ItemImage[];
}

/**
 * Longer than DEFAULT_API_TIMEOUT_MS (15s) - a multipart image upload legitimately takes longer
 * on a slow connection than a small JSON request does, but is still bounded (never infinite).
 */
const UPLOAD_TIMEOUT_MS = 120_000;

/** Returns images ordered SortOrder ASC, Id ASC - the same order the server returns them in. */
export async function getItemImages(
  request: AuthenticatedApiRequest,
  itemId: number,
): Promise<readonly ItemImage[]> {
  const response = await request<ItemImagesResponse>({
    method: 'GET',
    path: `/api/v1/items/${itemId}/images`,
  });

  if (!response.body) {
    throw new Error('Juple API returned no Item images body.');
  }

  return response.body.images;
}

export interface ItemImageAsset {
  readonly uri: string;
  /** The picker's own reported MIME type - never overridden or guessed here. */
  readonly type?: string;
  readonly fileName?: string;
}

/**
 * Uploads via multipart/form-data with field name "file" - the raw asset bytes only, never
 * base64. The server independently verifies the real image format via magic bytes and ignores
 * whatever type/fileName is declared here; they're passed through only because FormData parts
 * require them.
 */
export async function uploadItemImage(
  request: AuthenticatedApiRequest,
  itemId: number,
  asset: ItemImageAsset,
): Promise<ItemImage> {
  const formData = new FormData();
  formData.append('file', {
    uri: asset.uri,
    type: asset.type,
    name: asset.fileName ?? 'upload',
  });

  const response = await request<ItemImage>({
    method: 'POST',
    path: `/api/v1/items/${itemId}/images`,
    formData,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });

  if (!response.body) {
    throw new Error('Juple API returned no Item image body.');
  }

  return response.body;
}

/** DELETEs the image; resolves on 204 (idempotent - a missing/already-deleted image also succeeds). */
export async function deleteItemImage(
  request: AuthenticatedApiRequest,
  itemId: number,
  imageId: number,
): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: `/api/v1/items/${itemId}/images/${imageId}`,
  });
}
