/**
 * Best-effort hostname for display only - this is never used for saving, validation, or anything
 * that touches the server; a parse failure just falls through to the raw URL rather than blocking
 * anything. Strips a leading "www." (www.youtube.com -> youtube.com) since that's how users
 * usually refer to a site.
 */
export function getHostnameFromUrl(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    return hostname ? hostname.replace(/^www\./i, '') : null;
  } catch {
    return null;
  }
}

/**
 * What a saved link's row shows as its primary (largest) text: the user's own title when there is
 * one, otherwise a short domain instead of the full raw URL (which used to dominate the row
 * visually). This is purely a display fallback - it is never written back to Item.Title, and a
 * URL that fails to parse simply falls back to itself rather than showing nothing.
 */
export function resolveSavedLinkPrimaryText(title: string | null, url: string): string {
  if (title) {
    return title;
  }
  return getHostnameFromUrl(url) ?? url;
}
