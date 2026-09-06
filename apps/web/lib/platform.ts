export type ClientPlatform = 'android' | 'ios' | 'other';

/**
 * Minimal User-Agent sniff for the Install CTA only (see app/c/[publicId]/InstallCta.tsx) - not a
 * general device-detection library, and never used for anything security- or content-sensitive.
 * Showing an Android visitor a Google Play badge and an iOS visitor an App Store badge (and both
 * to anyone else, e.g. desktop) is a UX nicety; getting it wrong here has no consequence beyond a
 * mis-targeted CTA, so a couple of literal marker checks is enough - no UA-parsing library.
 */
export function resolveClientPlatform(userAgentHeader: string | null): ClientPlatform {
  const userAgent = userAgentHeader ?? '';

  if (/android/i.test(userAgent)) {
    return 'android';
  }
  if (/iphone|ipad|ipod/i.test(userAgent)) {
    return 'ios';
  }
  return 'other';
}
