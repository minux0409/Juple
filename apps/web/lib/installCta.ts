import type { ClientPlatform } from './platform.ts';

export interface InstallCtaInput {
  readonly platform: ClientPlatform;
  readonly googlePlayUrl: string | undefined;
  readonly appStoreUrl: string | undefined;
  readonly hasOpenInAppUrl: boolean;
}

export interface InstallCtaPlan {
  readonly open: boolean;
  readonly googlePlay: boolean;
  readonly appStore: boolean;
  /** Nothing usable for this visitor yet (no store listing configured): a plain note, never a dead-end button. */
  readonly comingSoon: boolean;
}

/**
 * What the install / open block offers. An iPhone visitor is never offered Google Play and an Android one never the App Store; any
 * other visitor (desktop, unknown) sees every configured store. The explicit "open in Juple" button is Android-only (Chrome's
 * intent link); iOS relies on the canonical https link itself (Universal Links). Nothing here redirects anybody anywhere.
 */
export function planInstallCta({ platform, googlePlayUrl, appStoreUrl, hasOpenInAppUrl }: InstallCtaInput): InstallCtaPlan {
  const open = platform === 'android' && hasOpenInAppUrl;
  const googlePlay = Boolean(googlePlayUrl) && platform !== 'ios';
  const appStore = Boolean(appStoreUrl) && platform !== 'android';
  return { open, googlePlay, appStore, comingSoon: !open && !googlePlay && !appStore };
}

export type ShareSection = 'brand' | 'title' | 'cta' | 'lockedGate' | 'items' | 'footer';

export interface SharePagePlan {
  /** Top to bottom. The install / open block comes right after the title - never only after the item list. */
  readonly sections: readonly ShareSection[];
  /** Try to hand the page over to the installed Android app once, on load. */
  readonly autoHandoff: boolean;
}

/**
 * The share page's layout order and whether it tries the one-time Android app handoff. The handoff is for a successfully
 * resolved share only (readable, or locked - the app then applies its own lock flow), on Android, and never again once the
 * intent's own fallback brought the visitor back (webOnly). Unknown / revoked / failing shares and every other platform get none.
 */
export function planSharePage(kind: 'ready' | 'locked' | 'private' | 'notFound' | 'unavailable', platform: ClientPlatform, webOnly: boolean): SharePagePlan {
  const autoHandoff = platform === 'android' && !webOnly && (kind === 'ready' || kind === 'locked' || kind === 'private');
  if (kind === 'ready') {
    return { sections: ['brand', 'title', 'cta', 'items', 'footer'], autoHandoff };
  }
  if (kind === 'private') {
    // The app asks "이 컬렉션에 참여하시겠습니까?"; here only the name and how to open the app.
    return { sections: ['brand', 'title', 'cta'], autoHandoff };
  }
  if (kind === 'locked') {
    return { sections: ['brand', 'cta', 'lockedGate'], autoHandoff };
  }
  return { sections: ['brand'], autoHandoff };
}
