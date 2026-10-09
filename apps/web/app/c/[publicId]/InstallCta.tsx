import type { ClientPlatform } from '../../../lib/platform';
import { planInstallCta } from '../../../lib/installCta';
import { storeConfig } from '../../../lib/storeConfig';

interface InstallCtaProps {
  readonly text: string;
  readonly googlePlayLabel: string;
  readonly appStoreLabel: string;
  readonly platform: ClientPlatform;
  /** Android only: Chrome's intent:// link to the canonical share URL (see lib/shareLinks.ts). */
  readonly openInAppUrl?: string;
  readonly openInAppLabel: string;
  readonly comingSoonText: string;
}

/**
 * "Install Juple" CTA - Server Component (no client JS needed, both links are static). Renders
 * only a plain note when no store is both configured and relevant to this visitor, rather than a
 * dead-end button: no real Google Play/App Store listing exists yet (see docs/architecture.md and
 * lib/storeConfig.ts). Never fabricates a play.google.com/apps.apple.com URL.
 *
 * On a platform that can only ever use one store (Android/iOS), showing the other store's badge
 * is not just unhelpful but actively wrong (an iPhone visitor cannot install anything from Google
 * Play) - so only the matching store's CTA renders there, even if both happen to be configured.
 * "other" (desktop, or any UA that doesn't match either) shows every configured store, since
 * neither guess is confidently wrong.
 */
export function InstallCta({ text, googlePlayLabel, appStoreLabel, platform, openInAppUrl, openInAppLabel, comingSoonText }: InstallCtaProps) {
  const plan = planInstallCta({
    platform,
    googlePlayUrl: storeConfig.googlePlayUrl,
    appStoreUrl: storeConfig.appStoreUrl,
    hasOpenInAppUrl: Boolean(openInAppUrl),
  });
  const showGooglePlay = plan.googlePlay;
  const showAppStore = plan.appStore;
  const showOpen = plan.open;

  // No store configured for this visitor (no listing yet): say so plainly instead of a dead-end button.
  if (plan.comingSoon) {
    return (
      <div className="installCta">
        <p className="installCtaText">{comingSoonText}</p>
      </div>
    );
  }

  return (
    <div className="installCta">
      <p className="installCtaText">{text}</p>
      <div className="installCtaButtons">
        {showOpen ? (
          <a className="installCtaButton" href={openInAppUrl} rel="noopener">
            {openInAppLabel}
          </a>
        ) : null}
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
