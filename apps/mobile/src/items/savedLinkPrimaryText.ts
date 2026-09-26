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

/** i18n keys (see locales' "item" namespace) for a title-less link whose content type is structurally known from its URL path. */
export type KnownContentFallbackKey = 'item.fallbackInstagramPost' | 'item.fallbackInstagramReel';

/**
 * Instagram's own public URL shapes: "/p/{code}", "/reel/{code}", "/reels/{code}", optionally
 * prefixed by "/{handle}". Only the content *type* is read from the path - never a title, author or
 * caption - so a title-less Instagram save (Instagram shares carry no subject, and its public page
 * can answer our metadata fetch with a logged-out shell) reads "Instagram reel" instead of a bare
 * "instagram.com". Anything else (profile, stories, explore, ...) returns null and keeps the hostname.
 */
export function resolveKnownContentFallbackKey(url: string): KnownContentFallbackKey | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'instagram.com' && !host.endsWith('.instagram.com')) {
    return null;
  }
  const match = /^\/(?:[A-Za-z0-9._]{1,30}\/)?(p|reels?)\/[A-Za-z0-9_-]+\/?$/.exec(parsed.pathname);
  if (!match) {
    return null;
  }
  return match[1] === 'p' ? 'item.fallbackInstagramPost' : 'item.fallbackInstagramReel';
}

export interface SavedLinkDisplayTitle {
  readonly text: string;
  /** True only for the hostname/raw-URL fallback - a technical identifier that needs LTR isolation. A user title or a localized content label follows the locale's own direction. */
  readonly isTechnicalIdentifier: boolean;
}

/**
 * Display-only title for saved-link rows/cards: user/metadata title > localized known-content label
 * (see resolveKnownContentFallbackKey) > hostname > raw URL. Never written back to Item.Title, so a
 * later real title (user edit or the backend metadata retry) always replaces the label.
 */
export function resolveSavedLinkDisplayTitle(
  title: string | null,
  url: string,
  translate: (key: KnownContentFallbackKey) => string,
): SavedLinkDisplayTitle {
  if (title) {
    return { text: title, isTechnicalIdentifier: false };
  }
  const fallbackKey = resolveKnownContentFallbackKey(url);
  if (fallbackKey) {
    return { text: translate(fallbackKey), isTechnicalIdentifier: false };
  }
  return { text: resolveSavedLinkPrimaryText(null, url), isTechnicalIdentifier: true };
}
