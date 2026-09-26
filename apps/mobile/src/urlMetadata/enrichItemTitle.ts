import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { setItemPreviewImage, updateItemDetails } from '../items/api/itemsApi';
import { resolveUrlMetadata, type ResolvedUrlMetadata } from './api/urlMetadataApi';

function logWarn(scope: string, error: unknown): void {
  // Privacy-safe (kind/status only - never the URL or resolved title/image text).
  console.warn(`[${scope}] failed`, {
    errorKind: error instanceof ApiError ? error.kind : undefined,
    errorStatus: error instanceof ApiError ? error.status : undefined,
    errorConstructor: error instanceof Error ? error.constructor.name : typeof error,
  });
}

async function resolveMetadataBestEffort(
  request: AuthenticatedApiRequest,
  url: string,
  scope: string,
): Promise<ResolvedUrlMetadata | null> {
  try {
    return await resolveUrlMetadata(request, url);
  } catch (error) {
    logWarn(scope, error);
    return null;
  }
}

/**
 * Best-effort: resolves URL metadata and, if a title and/or preview image was found, applies each
 * independently via updateItemDetails/setItemPreviewImage. Never throws - a metadata/network
 * failure here must never affect the caller's own save flow (the Item is already saved by the
 * time this runs). Callers must only invoke this when there is no title yet (resolveIncomingShare
 * returned null, or a direct URL save that never collected one) - the title PUT always replaces
 * with a fresh value, so it must never be called once a title might already exist. If a title
 * *does* already exist (e.g. the sharing app's own EXTRA_SUBJECT), use
 * enrichItemPreviewImageFromUrlMetadata below instead - never skip image resolution just because
 * the title was already known, which used to be exactly this function's own gate and was the
 * dominant real-world reason a real Quick-Save-ON YouTube/Instagram share ended up with no
 * thumbnail even though the same URL saved with no incoming title got one. Shared by
 * incomingShareHeadlessTask (Quick Save ON) and DailyInboxScreen (Home direct save) so both use
 * the same resolution policy instead of duplicating this call sequence. Returns the resolved
 * metadata (null when the resolve itself failed) so a caller can decide whether the Instagram
 * device fallback is needed - see instagramDeviceFallback.ts.
 */
export async function enrichItemTitleFromUrlMetadata(
  request: AuthenticatedApiRequest,
  itemId: number,
  url: string,
): Promise<ResolvedUrlMetadata | null> {
  const metadata = await resolveMetadataBestEffort(request, url, 'enrichItemTitleFromUrlMetadata');
  if (!metadata) {
    return null;
  }

  if (metadata.title) {
    try {
      await updateItemDetails(request, itemId, { title: metadata.title, memo: '' });
    } catch (error) {
      logWarn('enrichItemTitleFromUrlMetadata title apply', error);
    }
  }

  if (metadata.previewImageUrl) {
    try {
      await setItemPreviewImage(request, itemId, metadata.previewImageUrl);
    } catch (error) {
      logWarn('enrichItemTitleFromUrlMetadata preview image apply', error);
    }
  }
  return metadata;
}

/**
 * The preview-image half of enrichItemTitleFromUrlMetadata, deliberately split out so a caller
 * that already has a title from elsewhere (and must never overwrite it here) can still resolve
 * and apply the preview image - see that function's own remarks for why skipping this whenever a
 * title was already known was a real bug, not a deliberate simplification. Never throws, same
 * best-effort policy.
 */
export async function enrichItemPreviewImageFromUrlMetadata(
  request: AuthenticatedApiRequest,
  itemId: number,
  url: string,
): Promise<ResolvedUrlMetadata | null> {
  const metadata = await resolveMetadataBestEffort(request, url, 'enrichItemPreviewImageFromUrlMetadata');
  if (!metadata?.previewImageUrl) {
    return metadata;
  }

  try {
    await setItemPreviewImage(request, itemId, metadata.previewImageUrl);
  } catch (error) {
    logWarn('enrichItemPreviewImageFromUrlMetadata preview image apply', error);
  }
  return metadata;
}
