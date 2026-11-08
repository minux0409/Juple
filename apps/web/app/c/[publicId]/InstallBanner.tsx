'use client';

import { useState } from 'react';

interface InstallBannerProps {
  readonly title: string;
  readonly text: string;
  readonly dismissLabel: string;
  /** Android only: Chrome's "open in Juple" intent link. */
  readonly open?: { readonly href: string; readonly label: string };
  /** Real, publicly reachable store links for this visitor's platform only. */
  readonly stores: readonly { readonly href: string; readonly label: string }[];
  /** Shown instead of a store button when this visitor's store has no public listing yet - never a dead link. */
  readonly soonNote?: string;
}

/**
 * The quiet install note at the bottom of a shared Collection: a compact, dismissible card that leaves the links readable (the page
 * reserves room for it). No timer, no automatic redirect; closing it hides it for this visit.
 */
export function InstallBanner({ title, text, dismissLabel, open, stores, soonNote }: InstallBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const close = () => setDismissed(true);

  return (
    <aside aria-label={title} className="installBanner">
      <button aria-label={dismissLabel} className="installBannerClose" onClick={close} type="button">
        <svg aria-hidden fill="none" height="16" viewBox="0 0 24 24" width="16">
          <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      </button>
      <p className="installBannerTitle">{title}</p>
      <p className="installBannerText">{text}</p>
      {soonNote ? <p className="installBannerSoon">{soonNote}</p> : null}
      {open || stores.length > 0 ? (
        <div className="installBannerButtons">
          {open ? <a className="installCtaButton" href={open.href} rel="noopener">{open.label}</a> : null}
          {stores.map(store => (
            <a className="installCtaButton" href={store.href} key={store.href} rel="noopener noreferrer">{store.label}</a>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
