/**
 * Instagram's automatic link previews are Meta CDN URLs signed with an expiry: the `oe` query value is the expiry as a
 * Unix time in seconds, written as 8 hex digits (e.g. oe=68F38B47). Once it has passed the CDN answers
 * "403 URL signature expired" - the stored preview is gone for good, and requesting it again only costs a failed request.
 *
 * True only when the URL is certainly such an expired Meta CDN preview: https on the default port, no userinfo, a
 * *.cdninstagram.com / *.fbcdn.net host (static.cdninstagram.com excluded - the Backend never stores it, see
 * InstagramImageUrlPolicy), exactly one `oe` of exactly 8 hex digits within a plausible range, and that moment at or
 * before `nowMs`. Anything else - another host, a changed or missing `oe`, a URL that does not parse - is false, so the
 * image is requested as before and the caller's own failure fallback still applies (fail-open: this format is Meta's,
 * not documented, and may change). No safety margin: the CDN decides at the second, and the failure fallback covers a
 * request that lands right on the boundary.
 *
 * Kept identical to apps/web/lib/metaPreviewExpiry.ts (same fixtures in both test suites).
 */
const META_CDN_SUFFIXES = ['.cdninstagram.com', '.fbcdn.net'];
const EXCLUDED_HOSTS = ['static.cdninstagram.com'];
const OE_PATTERN = /^[0-9a-fA-F]{8}$/;
// 2020-01-01T00:00:00Z: an `oe` before it is not a real expiry of a stored preview, so it is not trusted.
const MIN_EXPIRY_SECONDS = 1577836800;

export function isExpiredMetaPreviewUrl(url: string | null | undefined, nowMs: number): boolean {
  if (!url || !Number.isFinite(nowMs)) {
    return false;
  }
  // Cheap pre-check before any parsing: cards call this on every render, and almost every preview is not a Meta one.
  const lower = url.toLowerCase();
  if (!lower.includes('oe=') || !META_CDN_SUFFIXES.some(suffix => lower.includes(suffix))) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.port !== '' || parsed.username !== '' || parsed.password !== '') {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (EXCLUDED_HOSTS.includes(host) || !META_CDN_SUFFIXES.some(suffix => host.endsWith(suffix) && host.length > suffix.length)) {
    return false;
  }
  const values = parsed.searchParams.getAll('oe');
  if (values.length !== 1 || !OE_PATTERN.test(values[0])) {
    return false;
  }
  const expirySeconds = parseInt(values[0], 16);
  if (!Number.isSafeInteger(expirySeconds) || expirySeconds < MIN_EXPIRY_SECONDS) {
    return false;
  }
  return expirySeconds * 1000 <= nowMs;
}
