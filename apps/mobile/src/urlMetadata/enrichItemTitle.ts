import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { setItemPreviewImage, updateItemDetails } from '../items/api/itemsApi';
import { resolveUrlMetadata } from './api/urlMetadataApi';

/**
 * Best-effort: resolves URL metadata and, if a title and/or preview image was found, applies each
 * independently via updateItemDetails/setItemPreviewImage. Never throws - a metadata/network
 * failure here must never affect the caller's own save flow (the Item is already saved by the
 * time this runs). Callers must only invoke this when there is no title yet (resolveIncomingShare
 * returned null, or a direct URL save that never collected one) - the title PUT always replaces
 * with a fresh value, so it must never be called once a title might already exist; the preview-
 * image PUT is independent of that and only ever fires when a preview image was actually found; a
 * failure there never blocks/undoes the title apply, and vice versa. Shared by
 * incomingShareHeadlessTask (Quick Save ON) and DailyInboxScreen (Home direct save) so both use
 * the same resolution policy instead of duplicating this call sequence.
 */
export async function enrichItemTitleFromUrlMetadata(
  request: AuthenticatedApiRequest,
  itemId: number,
  url: string,
): Promise<void> {
  let metadata;
  try {
    metadata = await resolveUrlMetadata(request, url);
  } catch (error) {
    // Privacy-safe (kind/status only - never the URL or resolved title text), matching
    // incomingShareHeadlessTask.ts's own existing best-effort title-apply logging.
    console.warn('[enrichItemTitleFromUrlMetadata] resolve failed', {
      errorKind: error instanceof ApiError ? error.kind : undefined,
      errorStatus: error instanceof ApiError ? error.status : undefined,
      errorConstructor: error instanceof Error ? error.constructor.name : typeof error,
    });
    return;
  }

  if (metadata.title) {
    try {
      await updateItemDetails(request, itemId, { title: metadata.title, memo: '' });
    } catch (error) {
      console.warn('[enrichItemTitleFromUrlMetadata] title apply failed', {
        errorKind: error instanceof ApiError ? error.kind : undefined,
        errorStatus: error instanceof ApiError ? error.status : undefined,
        errorConstructor: error instanceof Error ? error.constructor.name : typeof error,
      });
    }
  }

  if (metadata.previewImageUrl) {
    try {
      await setItemPreviewImage(request, itemId, metadata.previewImageUrl);
    } catch (error) {
      console.warn('[enrichItemTitleFromUrlMetadata] preview image apply failed', {
        errorKind: error instanceof ApiError ? error.kind : undefined,
        errorStatus: error instanceof ApiError ? error.status : undefined,
        errorConstructor: error instanceof Error ? error.constructor.name : typeof error,
      });
    }
  }
}
