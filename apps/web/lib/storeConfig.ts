/**
 * Store listing / Smart App Banner config for the "install Juple" CTA on the Public Collection
 * Sharing Web Viewer (see app/c/[publicId]/InstallCta.tsx). Store listings come from lib/appDownload.ts (official
 * defaults, https-only environment overrides); the share-page Google Play address and the Smart App Banner id stay `undefined`
 * until configured, never a guessed/placeholder URL. Callers must hide the corresponding UI entirely when a
 * field is undefined; never render a dead-end button.
 *
 * Plain (non-NEXT_PUBLIC_) runtime env vars, read fresh on every request - InstallCta and
 * page.tsx's generateMetadata are both Server Components/functions that never ship their own body
 * code to the client (only their rendered output does), so there is no client-bundle exposure
 * concern here the way there is for lib/publicApi.ts's API base URL, and no need to freeze these
 * at `next build` time. This is what keeps one Docker image usable across Dev/Staging/Prod with no
 * rebuild - only the store listings differ per environment, not the app.
 */
import { resolveAppDownload } from './appDownload.ts';

export const storeConfig = {
  // The Android package's real Play listing unless the environment says otherwise (lib/appDownload.ts is the one source).
  googlePlayUrl: resolveAppDownload({ googlePlayUrl: process.env.GOOGLE_PLAY_URL }).googlePlayUrl as string | undefined,
  /**
   * The Google Play address the PUBLIC share page may offer. Unlike googlePlayUrl above it has NO default listing: it is shown only
   * when GOOGLE_PLAY_URL is explicitly set (https), i.e. once the app is installable by the general public. While Android is in a
   * closed test the listing is not reachable for visitors, so the share page must not present it as an install link.
   */
  shareGooglePlayUrl: (/^https:\/\//i.test(process.env.GOOGLE_PLAY_URL?.trim() ?? '') ? process.env.GOOGLE_PLAY_URL?.trim() : undefined) as string | undefined,
  // The official App Store listing unless APP_STORE_URL (https only) overrides it - the same single source as the signed-in app.
  appStoreUrl: resolveAppDownload({ appStoreUrl: process.env.APP_STORE_URL }).appStoreUrl as string | undefined,
  /**
   * Apple Smart App Banner's numeric App Store id (e.g. "123456789", no "id" prefix) - a
   * different, more specific value than appStoreUrl above, normally only known once a real App
   * Store listing exists. See app/c/[publicId]/page.tsx's generateMetadata.
   */
  appStoreAppId: process.env.APP_STORE_APP_ID || undefined,
};
