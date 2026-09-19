import { getHostnameFromUrl } from './savedLinkPrimaryText';

export type KnownSiteId = 'youtube' | 'instagram' | 'naver';

export interface SiteInfo {
  /** null for any site without a dedicated icon - render the generic fallback icon and hostname text for those (see resolveSiteInfo's own remarks). */
  readonly id: KnownSiteId | null;
  /** "YouTube"/"Instagram"/"Naver" (proper nouns - never translated) for a known site, otherwise the bare hostname (e.g. "example.com") - always safe to render LTR. Null only when the URL itself fails to parse. */
  readonly label: string | null;
}

/**
 * Hostname-based site detection for the small source icon shown on saved-link rows/details (see
 * SiteIcon.tsx) - deliberately just a handful of major, unambiguous hosts rather than fetching
 * every site's real favicon over the network (too many sites, too failure/latency-prone - see this
 * round's product decision). Anything else falls back to the generic link icon + its own hostname,
 * which is still useful context without pretending to identify the site.
 */
export function resolveSiteInfo(url: string): SiteInfo {
  const hostname = getHostnameFromUrl(url);
  if (!hostname) {
    return { id: null, label: null };
  }

  const lowerHostname = hostname.toLowerCase();

  if (lowerHostname === 'youtube.com' || lowerHostname.endsWith('.youtube.com') || lowerHostname === 'youtu.be') {
    return { id: 'youtube', label: 'YouTube' };
  }

  if (lowerHostname === 'instagram.com' || lowerHostname.endsWith('.instagram.com')) {
    return { id: 'instagram', label: 'Instagram' };
  }

  if (lowerHostname === 'naver.com' || lowerHostname.endsWith('.naver.com') || lowerHostname === 'naver.me') {
    return { id: 'naver', label: 'Naver' };
  }

  return { id: null, label: hostname };
}
