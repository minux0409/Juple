import { InstagramIcon } from './InstagramIcon';
import { LinkIcon } from './LinkIcon';
import { NaverIcon } from './NaverIcon';
import { YouTubeIcon } from './YouTubeIcon';
import type { KnownSiteId } from '../items/resolveSiteInfo';
import { colors } from '../theme/tokens';

interface SiteIconProps {
  readonly siteId: KnownSiteId | null;
  readonly size?: number;
}

/** Renders the matching brand icon for a known site, or the generic link icon for everything else (see resolveSiteInfo.ts for the detection rule). */
export function SiteIcon({ siteId, size = 16 }: SiteIconProps) {
  switch (siteId) {
    case 'youtube':
      return <YouTubeIcon size={size} />;
    case 'instagram':
      return <InstagramIcon size={size} />;
    case 'naver':
      return <NaverIcon size={size} />;
    default:
      return <LinkIcon color={colors.textSecondary} size={size} strokeWidth={2} />;
  }
}
