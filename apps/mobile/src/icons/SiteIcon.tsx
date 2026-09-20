import { GlobeIcon } from './GlobeIcon';
import { InstagramIcon } from './InstagramIcon';
import { NaverIcon } from './NaverIcon';
import { YouTubeIcon } from './YouTubeIcon';
import type { KnownSiteId } from '../items/resolveSiteInfo';

interface SiteIconProps {
  readonly siteId: KnownSiteId | null;
  readonly size?: number;
}

/** Renders the matching brand icon (a small circular badge) for a known site, or the generic globe badge for everything else (see resolveSiteInfo.ts for the detection rule). */
export function SiteIcon({ siteId, size = 16 }: SiteIconProps) {
  switch (siteId) {
    case 'youtube':
      return <YouTubeIcon size={size} />;
    case 'instagram':
      return <InstagramIcon size={size} />;
    case 'naver':
      return <NaverIcon size={size} />;
    default:
      return <GlobeIcon size={size} />;
  }
}
