/**
 * Store listing / Smart App Banner config for the "install Juple" CTA on the Public Collection
 * Sharing Web Viewer (see app/c/[publicId]/InstallCta.tsx). No real Google Play/App Store listing
 * exists yet (see docs/architecture.md) - every field here is optional and defaults to `undefined`
 * rather than a guessed/placeholder URL. Callers must hide the corresponding UI entirely when a
 * field is undefined; never render a dead-end button. NEXT_PUBLIC_ is required for all of these
 * since InstallCta renders from the same Server Component as the rest of the page - no secret
 * value, just not-yet-known real URLs, so client-bundle exposure is not a concern here the way it
 * is for lib/publicApi.ts's API base URL note.
 */
export const storeConfig = {
  googlePlayUrl: process.env.NEXT_PUBLIC_GOOGLE_PLAY_URL || undefined,
  appStoreUrl: process.env.NEXT_PUBLIC_APP_STORE_URL || undefined,
  /**
   * Apple Smart App Banner's numeric App Store id (e.g. "123456789", no "id" prefix) - a
   * different, more specific value than appStoreUrl above, normally only known once a real App
   * Store listing exists. See app/c/[publicId]/page.tsx's generateMetadata.
   */
  appStoreAppId: process.env.NEXT_PUBLIC_APP_STORE_APP_ID || undefined,
};
