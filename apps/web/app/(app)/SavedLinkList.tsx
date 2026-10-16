'use client';

import Link from 'next/link';
import type { AppDictionary } from '../../lib/appI18n';
import type { LinkDisplayTitle, LinkView, LinkViewMode } from '../../lib/savedLinks';
import { Glyph } from './Glyph';
import { LinkImage } from './LinkImage';
import { SiteIcon } from './SiteIcon';
import styles from './app.module.css';

export function linkTitleText(title: LinkDisplayTitle, dictionary: AppDictionary): string {
  switch (title.kind) {
    case 'text':
      return title.text;
    case 'instagramPost':
      return dictionary.instagramPost;
    case 'instagramReel':
      return dictionary.instagramReel;
    case 'locked':
      return dictionary.lockedLink;
  }
}

/**
 * Saved links in the mobile List / Grid / Image presentations (SavedLinkRow, SavedLinkGridCard, SavedLinkImageTile): the name, the
 * memo (List), the time and the site. A link opens its page in this app (Item Details, or another member's shared view) - a real
 * route, so back / forward work; a locked one is shown but not opened.
 */
export function SavedLinkList({
  links,
  mode,
  dictionary,
  timestampOf,
}: {
  readonly links: readonly LinkView[];
  readonly mode: LinkViewMode;
  readonly dictionary: AppDictionary;
  /** The row's time text (a time in a one-day section, else date and time). */
  readonly timestampOf: (link: LinkView) => string;
}) {
  return (
    <ul className={mode === 'list' ? styles.linkList : mode === 'grid' ? styles.linkGrid : styles.imageGrid}>
      {links.map(link => (
        <li className={mode === 'image' ? styles.imageCell : styles.linkCard} key={link.id}>
          <LinkEntry dictionary={dictionary} link={link} mode={mode} timestamp={timestampOf(link)} />
        </li>
      ))}
    </ul>
  );
}

/** The link's picture, or - like the mobile tiles - its site's badge (else the link glyph), or a lock for a locked link. */
function Thumbnail({ link, className, fallbackSize }: { readonly link: LinkView; readonly className: string; readonly fallbackSize: number }) {
  return (
    <div aria-hidden className={className}>
      <LinkImage
        fallback={<span className={styles.thumbnailFallback}>{link.locked ? <Glyph name="Lock" size={22} /> : <SiteIcon siteId={link.siteId} size={fallbackSize} />}</span>}
        cacheKey={link.thumbnailCacheKey}
        src={link.thumbnailUrl}
      />
    </div>
  );
}

/** Where a link is from: the site's own badge (YouTube / Instagram / ...) when known, with its host name (always left-to-right). */
function SiteMeta({ link }: { readonly link: LinkView }) {
  return (
    <span className={styles.siteMeta} data-site-meta>
      {link.siteId ? <SiteIcon siteId={link.siteId} size={14} /> : null}
      <span dir="ltr">{link.site}</span>
    </span>
  );
}

function LinkEntry({ link, mode, timestamp, dictionary }: { readonly link: LinkView; readonly mode: LinkViewMode; readonly timestamp: string; readonly dictionary: AppDictionary }) {
  const title = linkTitleText(link.title, dictionary);
  const technical = link.title.kind === 'text' && link.title.technical;
  const body =
    mode === 'image' ? (
      // Image view: only the picture (mobile SavedLinkImageTile) - the name stays available to screen readers and as a tooltip.
      <>
        <Thumbnail className={styles.imageTile} fallbackSize={40} link={link} />
        <span className={styles.visuallyHidden}>{title}</span>
      </>
    ) : (
      <>
        <Thumbnail className={mode === 'grid' ? styles.cardImage : styles.thumbnail} fallbackSize={mode === 'grid' ? 40 : 30} link={link} />
        <div className={styles.linkText}>
          <span className={styles.linkTitle} dir={technical ? 'ltr' : 'auto'}>
            {title}
          </span>
          {link.memo ? (
            <span className={styles.linkMemo} data-link-memo dir="auto">
              {link.memo}
            </span>
          ) : null}
          {mode === 'list' ? null : (
            <span className={styles.linkMeta}>
              <time dateTime={link.timestampUtc}>{timestamp}</time>
              {link.site ? <SiteMeta link={link} /> : null}
            </span>
          )}
        </div>
        {mode === 'list' ? (
          <span className={styles.linkMetaCol}>
            <time dateTime={link.timestampUtc}>{timestamp}</time>
            {link.site ? <SiteMeta link={link} /> : null}
          </span>
        ) : null}
      </>
    );
  const className = mode === 'list' ? styles.linkRowBody : mode === 'grid' ? styles.cardBody : styles.imageBody;

  return link.href ? (
    <Link className={className} href={link.href} title={mode === 'image' ? title : undefined}>
      {body}
    </Link>
  ) : (
    <div aria-disabled className={className} title={mode === 'image' ? title : undefined}>
      {body}
    </div>
  );
}
