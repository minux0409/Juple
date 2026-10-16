import type { Metadata } from 'next';

/**
 * The site's own link-preview metadata (the landing page, the legal pages, the 404 page): the Juple name, a real description and the
 * Juple app icon as the preview image. The canonical address is the Production domain - the only one meant to be passed around.
 *
 * A shared Collection keeps its own, stricter policy (lib/shareView.ts buildShareMetadata): its page replaces openGraph and twitter
 * entirely, so a share preview never gets this image or any content.
 */
export const SITE_URL = 'https://juple.co.kr';
export const SITE_SHARE_IMAGE = { url: '/brand/juple-share-512.png', width: 512, height: 512, alt: 'Juple' } as const;

export function buildSiteMetadata(description: string, path: string): Metadata {
  const url = new URL(path, SITE_URL).toString();
  return {
    title: 'Juple',
    description,
    alternates: { canonical: url },
    openGraph: {
      title: 'Juple',
      description,
      url,
      siteName: 'Juple',
      type: 'website',
      images: [SITE_SHARE_IMAGE],
    },
    twitter: { card: 'summary', title: 'Juple', description, images: [SITE_SHARE_IMAGE.url] },
  };
}
