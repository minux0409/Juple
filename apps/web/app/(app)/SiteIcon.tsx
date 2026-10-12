import { useId } from 'react';
import type { KnownSiteId } from '../../lib/savedLinks';
import { Glyph } from './Glyph';

/**
 * The picture fallback for a link without one - the mobile SiteIcon badges (apps/mobile/src/icons/YouTubeIcon, InstagramIcon,
 * NaverIcon: the same drawings and brand colors) for those sites, the mobile link glyph for every other site. Decorative.
 */
export function SiteIcon({ siteId, size }: { readonly siteId: KnownSiteId | null; readonly size: number }) {
  const gradientId = useId();
  switch (siteId) {
    case 'youtube':
      return (
        <svg aria-hidden fill="none" height={size} viewBox="0 0 24 24" width={size}>
          <circle cx="12" cy="12" fill="#FF0000" r="11" />
          <path d="M9.8 8.3 16 12l-6.2 3.7v-7.4Z" fill="#FFFFFF" />
        </svg>
      );
    case 'instagram':
      return (
        <svg aria-hidden fill="none" height={size} viewBox="0 0 24 24" width={size}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="24" y1="24" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#FFDD55" />
              <stop offset="0.5" stopColor="#E1306C" />
              <stop offset="1" stopColor="#5851DB" />
            </linearGradient>
          </defs>
          <circle cx="12" cy="12" fill={`url(#${gradientId})`} r="11" />
          <circle cx="12" cy="12" r="4.2" stroke="#FFFFFF" strokeWidth="1.6" />
          <circle cx="16.3" cy="7.7" fill="#FFFFFF" r="1" />
        </svg>
      );
    case 'naver':
      return (
        <svg aria-hidden fill="none" height={size} viewBox="0 0 24 24" width={size}>
          <circle cx="12" cy="12" fill="#03C75A" r="11" />
          <path d="M8.6 7.2h2l3 4.6V7.2h2v9.6h-2l-3-4.6v4.6h-2V7.2Z" fill="#FFFFFF" />
        </svg>
      );
    default:
      return <Glyph name="Link" size={Math.round(size * 0.66)} />;
  }
}
