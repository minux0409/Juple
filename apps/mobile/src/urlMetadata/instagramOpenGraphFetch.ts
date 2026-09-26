import type { InstagramMetadataCandidate } from '../items/api/itemsApi';
import { resolveKnownContentFallbackKey } from '../items/savedLinkPrimaryText';

/**
 * Device-side public fetch of an Instagram post/reel page, used only as a fallback when the
 * Backend's own metadata fetch came back without a title/image (observed cause: Instagram answers
 * the Backend's Azure-hosted fetch with a 302 to /accounts/login, while the same public page loads
 * normally from the user's own device - verified on a real device before this was built).
 *
 * Request: one anonymous GET - `credentials: 'omit'` (React Native's Android networking then uses
 * OkHttp's CookieJar.NO_COOKIES: no cookie is sent or kept), no Authorization, no WebView or
 * Instagram-app session, no proxy, only the standard `Accept: text/html`, and React Native's own
 * default User-Agent (no spoofing). Bounded by FETCH_TIMEOUT_MS.
 *
 * Output: only the raw OpenGraph values (og:title/og:image/og:url/og:description) - the HTML is
 * discarded, and nothing is normalized or trusted here: the Backend validates/normalizes them (see
 * submitInstagramMetadataCandidate). Never logs a URL or any of these values.
 */

export type InstagramOpenGraphFetchOutcome = 'candidate' | 'loginRedirect' | 'noMetadata' | 'httpError' | 'timeout' | 'network';

export interface InstagramOpenGraphFetchResult {
  readonly outcome: InstagramOpenGraphFetchOutcome;
  /** Non-null only when outcome is 'candidate' (at least an og:title or og:image was present). */
  readonly candidate: InstagramMetadataCandidate | null;
}

const FETCH_TIMEOUT_MS = 10_000;

/** Instagram post/reel URLs only - the same URL shapes the display fallback label recognizes. */
export function isInstagramContentUrl(url: string): boolean {
  return resolveKnownContentFallbackKey(url) !== null;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === '#') {
      const codePoint = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

/** The raw (entity-decoded) content of the first `<meta property="{property}" content="...">`, or null. */
export function readOpenGraphValue(html: string, property: string): string | null {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
  const tag = new RegExp(`<meta\\b[^>]*\\bproperty\\s*=\\s*["']${escapedProperty}["'][^>]*>`, 'i').exec(html)?.[0];
  if (!tag) {
    return null;
  }
  const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
  const raw = content?.[1] ?? content?.[2];
  const decoded = raw === undefined ? '' : decodeHtmlEntities(raw).trim();
  return decoded ? decoded : null;
}

function isLoginPath(finalUrl: string): boolean {
  try {
    const path = new URL(finalUrl).pathname.toLowerCase();
    return path === '/accounts/login' || path.startsWith('/accounts/login/');
  } catch {
    return false;
  }
}

export async function fetchInstagramOpenGraphCandidate(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InstagramOpenGraphFetchResult> {
  if (!isInstagramContentUrl(url)) {
    return { outcome: 'noMetadata', candidate: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      credentials: 'omit',
      headers: { Accept: 'text/html' },
      signal: controller.signal,
    });
    if (response.url && isLoginPath(response.url)) {
      return { outcome: 'loginRedirect', candidate: null };
    }
    if (response.status < 200 || response.status >= 300) {
      return { outcome: 'httpError', candidate: null };
    }

    const html = await response.text();
    const candidate: InstagramMetadataCandidate = {
      ogTitle: readOpenGraphValue(html, 'og:title'),
      ogImage: readOpenGraphValue(html, 'og:image'),
      ogUrl: readOpenGraphValue(html, 'og:url'),
      ogDescription: readOpenGraphValue(html, 'og:description'),
    };
    return candidate.ogTitle || candidate.ogImage
      ? { outcome: 'candidate', candidate }
      : { outcome: 'noMetadata', candidate: null };
  } catch {
    return { outcome: controller.signal.aborted ? 'timeout' : 'network', candidate: null };
  } finally {
    clearTimeout(timer);
  }
}
