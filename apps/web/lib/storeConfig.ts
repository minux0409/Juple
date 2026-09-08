/**
 * Store listing / Smart App Banner config for the "install Juple" CTA on the Public Collection
 * Sharing Web Viewer (see app/c/[publicId]/InstallCta.tsx). No real Google Play/App Store listing
 * exists yet (see docs/architecture.md) - every field here is optional and defaults to `undefined`
 * rather than a guessed/placeholder URL. Callers must hide the corresponding UI entirely when a
 * field is undefined; never render a dead-end button.
 *
 * Plain (non-NEXT_PUBLIC_) runtime env vars, read fresh on every request - InstallCta and
 * page.tsx's generateMetadata are both Server Components/functions that never ship their own body
 * code to the client (only their rendered output does), so there is no client-bundle exposure
 * concern here the way there is for lib/publicApi.ts's API base URL, and no need to freeze these
 * at `next build` time. This is what keeps one Docker image usable across Dev/Staging/Prod with no
 * rebuild - only the store listings differ per environment, not the app.
 */
export const storeConfig = {
  googlePlayUrl: process.env.GOOGLE_PLAY_URL || undefined,
  appStoreUrl: process.env.APP_STORE_URL || undefined,
  /**
   * Apple Smart App Banner's numeric App Store id (e.g. "123456789", no "id" prefix) - a
   * different, more specific value than appStoreUrl above, normally only known once a real App
   * Store listing exists. See app/c/[publicId]/page.tsx's generateMetadata.
   */
  appStoreAppId: process.env.APP_STORE_APP_ID || undefined,
};
