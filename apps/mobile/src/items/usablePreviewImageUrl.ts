import { isExpiredMetaPreviewUrl } from './metaPreviewExpiry';

/**
 * A link's automatic preview image as it may be shown: null when there is none, or when it is an already-expired Meta CDN
 * (Instagram) URL the CDN is certain to refuse (see metaPreviewExpiry.ts) - so the caller takes its usual "no image"
 * branch at once instead of requesting it and leaving an empty box. Anything else is returned unchanged and loads as
 * before (fail-open). For the automatic preview only: the user's own photos are Juple read URLs and never pass through here.
 */
export function usablePreviewImageUrl(previewImageUrl: string | null | undefined, nowMs: number = Date.now()): string | null {
  if (previewImageUrl == null) {
    return null;
  }
  return isExpiredMetaPreviewUrl(previewImageUrl, nowMs) ? null : previewImageUrl;
}
