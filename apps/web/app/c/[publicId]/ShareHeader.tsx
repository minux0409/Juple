'use client';

import { useEffect, useRef, useState } from 'react';
import { collectionIconMarkup, collectionTile } from '../../../lib/collectionsView';
import { copyText } from '../../../lib/copyText';
import type { ShareLook } from '../../../lib/shareView';

interface ShareHeaderProps {
  readonly name: string;
  readonly look: ShareLook;
  /** The one canonical https share URL (never carries the webonly flag or any query). */
  readonly shareUrl: string;
  readonly shareLabel: string;
  readonly copiedLabel: string;
  readonly copyFailedLabel: string;
  readonly publicId: string;
}

/** A stable per-link number for the fallback tile colour - the opaque public id only, never an internal Collection id. */
function tileKey(publicId: string): number {
  let hash = 0;
  for (const char of publicId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

/**
 * Collection tile + name + the share button. Share uses the system share sheet where the browser has one (Web Share API) and
 * otherwise copies the canonical link; the outcome is announced politely. Nothing else about the page is needed to share.
 */
export function ShareHeader({ name, look, shareUrl, shareLabel, copiedLabel, copyFailedLabel, publicId }: ShareHeaderProps) {
  const tile = collectionTile(look.color, tileKey(publicId));
  const [imageBroken, setImageBroken] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const announce = (text: string) => {
    setNotice(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 2600);
  };

  const share = async () => {
    const url = new URL(shareUrl, window.location.href).toString();
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: name, url });
        return;
      } catch (error) {
        // The person closed the sheet: nothing to report, and no silent copy behind their back.
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    announce((await copyText(url)) ? copiedLabel : copyFailedLabel);
  };

  return (
    <header className="shareHeader">
      {/* Mobile CollectionDetails toolbar: the brand at the start, the share icon (44x44 target, 20px icon) at the end. */}
      <div className="shareToolbar">
        <p className="brand">Juple</p>
        <button aria-label={shareLabel} className="shareIconButton" onClick={share} title={shareLabel} type="button">
          <svg aria-hidden fill="none" height="20" viewBox="0 0 24 24" width="20">
            <circle cx="18" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.75" />
            <circle cx="6" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.75" />
            <circle cx="18" cy="18.5" r="2.5" stroke="currentColor" strokeWidth="1.75" />
            <line stroke="currentColor" strokeLinecap="round" strokeWidth="1.75" x1="8.2" x2="15.8" y1="10.7" y2="6.8" />
            <line stroke="currentColor" strokeLinecap="round" strokeWidth="1.75" x1="8.2" x2="15.8" y1="13.3" y2="17.2" />
          </svg>
        </button>
      </div>
      <div className="shareTitleRow">
        <span aria-hidden className="shareTile" style={{ background: tile.background, color: tile.icon }}>
          {look.iconImageUrl && !imageBroken ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" className="shareTileImage" decoding="async" onError={() => setImageBroken(true)} referrerPolicy="no-referrer" src={look.iconImageUrl} />
          ) : (
            <svg dangerouslySetInnerHTML={{ __html: collectionIconMarkup(look.icon ?? 'Folder') }} fill="none" height="28" viewBox="0 0 24 24" width="28" />
          )}
        </span>
        <h1 className="collectionName">{name}</h1>
      </div>
      <p aria-live="polite" className="shareNotice" role="status">{notice}</p>
    </header>
  );
}
