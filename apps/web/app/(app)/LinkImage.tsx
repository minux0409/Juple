'use client';

import { useState } from 'react';
import { isExpiredMetaPreviewUrl } from '../../lib/metaPreviewExpiry';
import { replaceFailedStableImageUri, resolveStableImageUri } from '../../lib/stableImageUri';

/**
 * One remote picture (a link preview, a short-lived photo read URL, a Collection or profile photo) with the mobile tiles' failure
 * rule (SavedLinkImageTile: the URL that failed, not a flag): when it cannot be loaded - expired, refused by the site, gone - the
 * fallback takes its place, so the browser's broken-image icon is never shown. A different URL (a refresh brings a new signed URL)
 * gets its own attempt.
 */
export function LinkImage({
  src,
  fallback,
  className,
  alt = '',
  eager = false,
  cacheKey = null,
}: {
  readonly src: string | null;
  readonly fallback: React.ReactNode;
  readonly className?: string;
  readonly alt?: string;
  /** A picture that is on screen right now and local (a picked file's preview): no lazy loading. */
  readonly eager?: boolean;
  /**
   * The photo's stable identity (lib/stableImageUri.ts imageCacheKey) for the user's own uploaded photos: the first signed URL
   * of this variant is reused so the browser cache serves it. None for external previews and local files.
   */
  readonly cacheKey?: string | null;
}) {
  const [failedSrcs, setFailedSrcs] = useState<ReadonlySet<string>>(() => new Set());
  // An already-expired Meta CDN preview (Instagram) is certain to be refused: the fallback right away, no request.
  const [mountedAtMs] = useState(() => Date.now());
  // The kept URL first, then (once) this response's fresh URL, then the fallback.
  const kept = resolveStableImageUri(cacheKey, src);
  const shown = [kept, src].find(candidate => !!candidate && !failedSrcs.has(candidate)) ?? null;
  if (!shown || isExpiredMetaPreviewUrl(shown, mountedAtMs)) {
    return <>{fallback}</>;
  }
  const onError = () => {
    if (cacheKey && src && shown !== src) {
      replaceFailedStableImageUri(cacheKey, shown, src);
    }
    setFailedSrcs(previous => new Set(previous).add(shown));
  };
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote link previews / short-lived read URLs, not optimizable assets
    <img alt={alt} className={className} decoding="async" loading={eager ? 'eager' : 'lazy'} onError={onError} referrerPolicy="no-referrer" src={shown} />
  );
}
