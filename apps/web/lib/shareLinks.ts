/** The Android applicationId (the same one apps/mobile and assetlinks.json use). */
export const ANDROID_PACKAGE = 'com.juple.app';

const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:\d{1,5})?$/i;

/** A Host header worth building an absolute URL from - anything unexpected (a path, a scheme, spaces) is refused. */
export function normalizeHost(host: string | null | undefined): string | null {
  const trimmed = host?.split(',')[0]?.trim() ?? '';
  return HOST_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** Added ONLY to the intent's fallback URL: the page it lands on never tries the app handoff again (see planSharePage). */
export const WEB_ONLY_PARAM = 'webonly';

/** The ONE canonical share URL (the same https://<host>/c/{publicId} the app shares and App Links / Universal Links open). */
export function canonicalShareUrl(host: string, publicId: string): string {
  return `https://${host}/c/${encodeURIComponent(publicId)}`;
}

/**
 * Chrome's documented "intent://" link for an explicit "open in Juple" button: it opens the installed app on exactly this
 * canonical URL, and when the app is not installed it simply stays on (or returns to) this same web page through
 * S.browser_fallback_url. No timers, no store redirect, no custom scheme - the HTTPS URL stays the one link.
 */
export function androidOpenInAppUrl(host: string, publicId: string): string {
  const canonical = canonicalShareUrl(host, publicId);
  const path = `/c/${encodeURIComponent(publicId)}`;
  // The fallback is the same page with webonly=1, so a failed or blocked handoff can never trigger another one (no loop).
  const fallback = `${canonical}?${WEB_ONLY_PARAM}=1`;
  return `intent://${host}${path}#Intent;scheme=https;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
}
