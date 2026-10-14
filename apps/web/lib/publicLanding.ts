import type { ClientPlatform } from './platform';

/**
 * What the public landing page (app/welcome) offers to install. The Android app is the only one published: Google Play for Android and
 * desktop visitors when its listing URL is configured, never an App Store button (no iOS release yet - an iPhone visitor is told that
 * Juple is Android-first instead), and the plain "coming soon" line before the listing exists. Never a dead-end link.
 */
export interface LandingStorePlan {
  readonly googlePlayUrl: string | null;
  readonly androidOnlyNote: boolean;
  readonly comingSoon: boolean;
}

export function planLandingStore({ platform, googlePlayUrl }: { platform: ClientPlatform; googlePlayUrl: string | undefined }): LandingStorePlan {
  if (platform === 'ios') {
    return { googlePlayUrl: null, androidOnlyNote: true, comingSoon: false };
  }
  return googlePlayUrl ? { googlePlayUrl, androidOnlyNote: false, comingSoon: false } : { googlePlayUrl: null, androidOnlyNote: false, comingSoon: true };
}
