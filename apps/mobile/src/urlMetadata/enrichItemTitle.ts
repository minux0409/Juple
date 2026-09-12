import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { updateItemDetails } from '../items/api/itemsApi';
import { resolveUrlMetadata } from './api/urlMetadataApi';

/**
 * Best-effort: resolves URL metadata and, if a title was found, applies it via updateItemDetails.
 * Never throws - a metadata/network failure here must never affect the caller's own save flow
 * (the Item is already saved by the time this runs). Callers must only invoke this when there is
 * no title yet (resolveIncomingShare returned null, or a direct URL save that never collected
 * one) - it always PUTs a fresh title, so it must never be called once a title might already
 * exist. Shared by incomingShareHeadlessTask (Quick Save ON) and DailyInboxScreen (Home direct
 * save) so both use the same resolution policy instead of duplicating this call sequence.
 */
export async function enrichItemTitleFromUrlMetadata(
  request: AuthenticatedApiRequest,
  itemId: number,
  url: string,
): Promise<void> {
  try {
    const metadata = await resolveUrlMetadata(request, url);
    if (metadata.title) {
      await updateItemDetails(request, itemId, { title: metadata.title, memo: '' });
    }
  } catch (error) {
    // Privacy-safe (kind/status only - never the URL or resolved title text), matching
    // incomingShareHeadlessTask.ts's own existing best-effort title-apply logging.
    console.warn('[enrichItemTitleFromUrlMetadata] failed', {
      errorKind: error instanceof ApiError ? error.kind : undefined,
      errorStatus: error instanceof ApiError ? error.status : undefined,
      errorConstructor: error instanceof Error ? error.constructor.name : typeof error,
    });
  }
}
