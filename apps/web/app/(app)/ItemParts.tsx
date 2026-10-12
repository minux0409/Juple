'use client';

import type { AppDictionary } from '../../lib/appI18n';
import { isSafeHttpUrl, siteIdOf, siteOf } from '../../lib/savedLinks';
import { Glyph } from './Glyph';
import { LinkImage } from './LinkImage';
import { SiteIcon } from './SiteIcon';
import styles from './app.module.css';

/** The 대표 사진 of a link's page (own photo, else the automatic preview); without one, the site's badge (else the link glyph). */
export function ItemPhoto({ photoUrl, url, dictionary }: { readonly photoUrl: string | null; readonly url: string; readonly dictionary: AppDictionary }) {
  return (
    <div className={styles.itemMedia}>
      <LinkImage
        alt={dictionary.representativePhoto}
        fallback={
          <span aria-hidden className={styles.itemMediaFallback}>
            <SiteIcon siteId={siteIdOf(url)} size={64} />
          </span>
        }
        src={photoUrl}
      />
    </div>
  );
}

/** The site (with its badge where the mobile app has one) and the whole link - left-to-right, wrapping anywhere. */
export function SourceRow({ url }: { readonly url: string }) {
  const site = siteOf(url);
  const siteId = siteIdOf(url);
  return (
    <div className={styles.sourceRow}>
      {site ? (
        <p className={styles.sourceSite} dir="ltr">
          {siteId ? <SiteIcon siteId={siteId} size={18} /> : null}
          {site}
        </p>
      ) : null}
      <p className={styles.sourceUrl} dir="ltr">
        {url}
      </p>
    </div>
  );
}

/** 링크 열기: the original link in a new tab (no opener, no referrer) - only for an http(s) link. This page stays open. */
export function OpenLinkButton({ url, dictionary }: { readonly url: string; readonly dictionary: AppDictionary }) {
  return isSafeHttpUrl(url) ? (
    <div>
      <a className={styles.openLinkButton} href={url} rel="noopener noreferrer" target="_blank">
        <Glyph name="ExternalLink" size={18} />
        {dictionary.openLink}
      </a>
    </div>
  ) : null;
}
