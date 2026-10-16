import type { ClientPlatform } from './platform';

/**
 * What the public landing page (app/welcome) offers to install. The Android app is the only one published: Google Play for Android and
 * desktop visitors when its listing URL is configured, never an App Store button (no iOS release yet - an iPhone visitor is told that
 * Juple is Android-first instead). Before the public listing exists the page offers no install link and no "coming soon" line - nothing
 * that is not real yet (a Closed Testing invitation is never a public link).
 */
export interface LandingStorePlan {
  readonly googlePlayUrl: string | null;
  readonly androidOnlyNote: boolean;
}

export function planLandingStore({ platform, googlePlayUrl }: { platform: ClientPlatform; googlePlayUrl: string | undefined }): LandingStorePlan {
  if (platform === 'ios') {
    return { googlePlayUrl: null, androidOnlyNote: true };
  }
  return { googlePlayUrl: googlePlayUrl || null, androidOnlyNote: false };
}
