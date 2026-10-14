'use client';

import { useState } from 'react';
import { isExpiredMetaPreviewUrl } from '../../lib/metaPreviewExpiry';

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
}: {
  readonly src: string | null;
  readonly fallback: React.ReactNode;
  readonly className?: string;
  readonly alt?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  // An already-expired Meta CDN preview (Instagram) is certain to be refused: the fallback right away, no request.
  const [mountedAtMs] = useState(() => Date.now());
  if (!src || src === failedSrc || isExpiredMetaPreviewUrl(src, mountedAtMs)) {
    return <>{fallback}</>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote link previews / short-lived read URLs, not optimizable assets
    <img alt={alt} className={className} decoding="async" loading="lazy" onError={() => setFailedSrc(src)} referrerPolicy="no-referrer" src={src} />
  );
}
