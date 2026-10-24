'use client';

import Link from 'next/link';
import type { AppDictionary } from '../../lib/appI18n';
import type { LinkAdderView, LinkDisplayTitle, LinkView, LinkViewMode } from '../../lib/savedLinks';
import { Avatar } from './Avatar';
import { Glyph } from './Glyph';
import { LinkImage } from './LinkImage';
import { SiteIcon } from './SiteIcon';
import { CardReactions } from './CardReactions';
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
 * memo (List) and the site - never the saved time (that is Item Details'; the date sections above already group by day). A link
 * opens its page in this app (Item Details, or another member's shared view) - a real route, so back / forward work; a locked one
 * is shown but not opened. List and Grid also carry a 바로가기 button to the saved original page; it is a sibling of the link (an
 * anchor never nests in an anchor) with its own hit area. The Image presentation stays picture-only, without it.
 */
export function SavedLinkList({
  links,
  mode,
  dictionary,
  onOpenOriginal,
}: {
  readonly links: readonly LinkView[];
  readonly mode: LinkViewMode;
  readonly dictionary: AppDictionary;
  /** The person's own list (Home, 보관함): called when the saved original page is opened from a card (a note for 최근 조회한 링크). */
  readonly onOpenOriginal?: (link: LinkView) => void;
}) {
  return (
    <ul className={mode === 'list' ? styles.linkList : mode === 'grid' ? styles.linkGrid : styles.imageGrid}>
      {links.map(link => (
        <li className={mode === 'image' ? styles.imageCell : link.reactions ? `${styles.linkCard} ${styles.linkCardColumn}` : styles.linkCard} key={link.id}>
          <LinkEntry dictionary={dictionary} link={link} mode={mode} onOpenOriginal={onOpenOriginal} />
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
function SiteMeta({ link, iconOnly = false }: { readonly link: LinkView; readonly iconOnly?: boolean }) {
  // With the adder beside it (a shared Collection) the host name would push the avatar away from the icon: icon only, as on mobile.
  const showHost = !(iconOnly && link.siteId);
  return (
    <span aria-label={iconOnly && link.siteId ? (link.site ?? undefined) : undefined} className={styles.siteMeta} data-site-meta role={iconOnly && link.siteId ? 'img' : undefined}>
      {link.siteId ? <SiteIcon siteId={link.siteId} size={14} /> : null}
      {showHost ? <span dir="ltr">{link.site}</span> : null}
    </span>
  );
}

/** Who added the link (a shared Collection only): their avatar - the Owner's with a crown on its corner - or the anonymous public link. */
function AdderMeta({ adder, dictionary }: { readonly adder: LinkAdderView; readonly dictionary: AppDictionary }) {
  if (adder.kind === 'publicLink') {
    return (
      <span aria-label={dictionary.addedViaPublicLink} className={styles.adderMeta} data-link-adder="publicLink" role="img" title={dictionary.addedViaPublicLink}>
        <Glyph name="User" size={14} />
      </span>
    );
  }
  const label = adder.isMe ? dictionary.addedByMe : adder.name;
  const full = adder.isCollectionOwner ? `${label} (${dictionary.roleOwner})` : label;
  return (
    <span aria-label={full} className={styles.adderMeta} data-link-adder={adder.isCollectionOwner ? 'owner' : 'person'} role="img" title={full}>
      <Avatar person={{ displayName: adder.name, profileImageUrl: adder.profileImageUrl, role: adder.isCollectionOwner ? 'owner' : null }} size={22} />
    </span>
  );
}

/** The meta line under a card / beside a row: the adder (shared Collections) and the site. Nothing at all when there is neither. */
function hasMeta(link: LinkView): boolean {
  return Boolean(link.adder) || Boolean(link.site);
}

function MetaContent({ link, dictionary }: { readonly link: LinkView; readonly dictionary: AppDictionary }) {
  return (
    <>
      {/* One line: the service icon, then - right beside it - who added the link; the card's 바로가기 button ends the same line. */}
      {link.site ? <SiteMeta iconOnly={Boolean(link.adder)} link={link} /> : null}
      {link.adder ? <AdderMeta adder={link.adder} dictionary={dictionary} /> : null}
    </>
  );
}

function LinkEntry({ link, mode, dictionary, onOpenOriginal }: { readonly link: LinkView; readonly mode: LinkViewMode; readonly dictionary: AppDictionary; readonly onOpenOriginal?: (link: LinkView) => void }) {
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
          {mode === 'list' || !(hasMeta(link) || link.externalUrl) ? null : (
            <span className={styles.linkMeta}>
              <MetaContent dictionary={dictionary} link={link} />
            </span>
          )}
        </div>
        {mode === 'list' && hasMeta(link) ? (
          <span className={styles.linkMetaCol}>
            <MetaContent dictionary={dictionary} link={link} />
          </span>
        ) : null}
      </>
    );
  const className = mode === 'list' ? styles.linkRowBody : mode === 'grid' ? styles.cardBody : styles.imageBody;

  const open =
    mode !== 'image' && link.externalUrl ? (
      <a
        aria-label={dictionary.openLink}
        className={mode === 'grid' ? `${styles.linkOpen} ${styles.linkOpenGrid}` : styles.linkOpen}
        data-link-open
        href={link.externalUrl}
        rel="noopener noreferrer"
        target="_blank"
        onAuxClick={onOpenOriginal ? () => onOpenOriginal(link) : undefined}
        onClick={onOpenOriginal ? () => onOpenOriginal(link) : undefined}
        title={dictionary.openLink}
      >
        <Glyph name="ExternalLink" size={mode === 'grid' ? 16 : 18} />
      </a>
    ) : null;

  const main = (
    <>
      {link.href ? (
        <Link className={className} href={link.href} title={mode === 'image' ? title : undefined}>
          {body}
        </Link>
      ) : (
        <div aria-disabled className={className} title={mode === 'image' ? title : undefined}>
          {body}
        </div>
      )}
      {open}
    </>
  );
  if (!link.reactions || mode === 'image') {
    return main;
  }
  // A shared Collection's card: line 1 (icon, author, 바로가기) lives in the card's main block; line 2 - the reactions, only while there are
  // any - is its own row under it, so nothing on line 1 can clip the chips and the open button keeps its place on line 1.
  return (
    <>
      <div className={styles.linkMain}>{main}</div>
      <CardReactions collectionId={link.reactions.collectionId} initial={link.reactions.row} itemId={link.id} />
    </>
  );
}
