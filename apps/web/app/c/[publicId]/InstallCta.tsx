import type { ClientPlatform } from '../../../lib/platform';
import { storeConfig } from '../../../lib/storeConfig';

interface InstallCtaProps {
  readonly text: string;
  readonly googlePlayLabel: string;
  readonly appStoreLabel: string;
  readonly platform: ClientPlatform;
}

/**
 * "Install Juple" CTA - Server Component (no client JS needed, both links are static). Renders
 * nothing at all when no store is both configured and relevant to this visitor, rather than a
 * dead-end button: no real Google Play/App Store listing exists yet (see docs/architecture.md and
 * lib/storeConfig.ts). Never fabricates a play.google.com/apps.apple.com URL.
 *
 * On a platform that can only ever use one store (Android/iOS), showing the other store's badge
 * is not just unhelpful but actively wrong (an iPhone visitor cannot install anything from Google
 * Play) - so only the matching store's CTA renders there, even if both happen to be configured.
 * "other" (desktop, or any UA that doesn't match either) shows every configured store, since
 * neither guess is confidently wrong.
 */
export function InstallCta({ text, googlePlayLabel, appStoreLabel, platform }: InstallCtaProps) {
  const showGooglePlay = Boolean(storeConfig.googlePlayUrl) && platform !== 'ios';
  const showAppStore = Boolean(storeConfig.appStoreUrl) && platform !== 'android';

  if (!showGooglePlay && !showAppStore) {
    return null;
  }

  return (
    <div className="installCta">
      <p className="installCtaText">{text}</p>
      <div className="installCtaButtons">
        {showGooglePlay ? (
          <a className="installCtaButton" href={storeConfig.googlePlayUrl} rel="noopener noreferrer">
            {googlePlayLabel}
          </a>
        ) : null}
        {showAppStore ? (
          <a className="installCtaButton" href={storeConfig.appStoreUrl} rel="noopener noreferrer">
            {appStoreLabel}
          </a>
        ) : null}
      </div>
    </div>
  );
}
