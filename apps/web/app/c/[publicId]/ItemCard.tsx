'use client';

import { useState } from 'react';
import type { PublicCollectionItem } from '../../../lib/publicApi';
import { getDisplayDomain } from '../../../lib/urlDisplay';

/**
 * Only an https automatic preview image is ever shown (an http image would be mixed content on
 * this https page). It is the linked page's own public metadata image - never a user's uploaded
 * photo, which the public API does not expose at all.
 */
function safePreviewImage(url: string | null): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function GlobeFallback() {
  return (
    <svg aria-hidden="true" fill="none" height="26" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" width="26">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
    </svg>
  );
}

/**
 * [thumbnail] title / domain / open. The thumbnail box has a fixed size, so a missing or broken
 * image never shifts the layout - it just shows the generic globe instead.
 */
export function ItemCard({ item, openLabel }: { item: PublicCollectionItem; openLabel: string }) {
  const imageUrl = safePreviewImage(item.previewImageUrl);
  const [isImageBroken, setIsImageBroken] = useState(false);
  const domain = getDisplayDomain(item.url);

  return (
    <li className="itemCard">
      <div className="itemThumb">
        {imageUrl && !isImageBroken ? (
          // A plain <img>: next/image would need every remote host allow-listed up front, and these
          // are arbitrary sites' own preview images.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            className="itemThumbImage"
            decoding="async"
            loading="lazy"
            onError={() => setIsImageBroken(true)}
            referrerPolicy="no-referrer"
            src={imageUrl}
          />
        ) : (
          <GlobeFallback />
        )}
      </div>
      <div className="itemBody">
        <p className="itemTitle">{item.title ?? domain}</p>
        <p className="itemDomain">{domain}</p>
        <a className="itemOpenLink" href={item.url} rel="noopener noreferrer" target="_blank">
          {openLabel}
        </a>
      </div>
    </li>
  );
}
