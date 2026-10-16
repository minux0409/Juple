/**
 * Keeps an uploaded Item photo coming from the browser cache instead of the network (mobile src/images/stableImageUri.ts). The
 * server signs a fresh short-lived read URL on every response, and the browser HTTP cache keys on the whole URL - so the same,
 * never-changing Blob was downloaded again on every Home visit and every detail open, although the Blob itself answers
 * `Cache-Control: private, max-age=31536000, immutable`.
 *
 * The first signed URL seen for a photo variant (`${imageId}:thumb` / `${imageId}:main` - an Item photo never changes; a
 * replacement is a new id and Blob) is kept for this tab's app session and handed out again for later responses, so the browser
 * serves the cached bytes. Every network fetch is still the server's signed URL - nothing is public, no SAS lifetime changes.
 * When a kept URL cannot load (its cached copy is gone and the signature expired), the response's fresh URL replaces it once
 * (LinkImage); a failing fresh URL means the photo is unavailable and the fallback is shown - never a retry loop.
 *
 * Browser memory only, bounded, cleared on sign-out and on a lost session (AppRoot). Never active on the server: module state
 * there would be shared between requests and people, so server rendering always uses the response's own URL.
 */
const MAX_ENTRIES = 500;
const entries = new Map<string, string>();

export type ImageVariant = 'thumb' | 'main';

export function imageCacheKey(imageId: number | null | undefined, variant: ImageVariant): string | null {
  return typeof imageId === 'number' && Number.isFinite(imageId) ? `${imageId}:${variant}` : null;
}

const inBrowser = () => typeof window !== 'undefined';

/** The URL to show for this photo variant now. No key (an external preview), no URL, or the server: the response's own URL. */
export function resolveStableImageUri(cacheKey: string | null | undefined, freshUri: string | null | undefined): string | null {
  if (!freshUri) {
    return null;
  }
  if (!cacheKey || !inBrowser()) {
    return freshUri;
  }
  const kept = entries.get(cacheKey);
  if (kept) {
    return kept;
  }
  if (entries.size >= MAX_ENTRIES) {
    // The oldest remembered photo goes first (Map keeps insertion order); it simply loads from its fresh URL next time.
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) {
      entries.delete(oldest);
    }
  }
  entries.set(cacheKey, freshUri);
  return freshUri;
}

/** The kept URL could not be loaded: from now on the response's fresh URL stands for this photo variant. */
export function replaceFailedStableImageUri(cacheKey: string, failedUri: string, freshUri: string): void {
  if (entries.get(cacheKey) === failedUri) {
    entries.set(cacheKey, freshUri);
  }
}

/** Sign-out / a lost session: no private photo URL may outlive it or reach the next account in this tab. */
export function clearStableImageUris(): void {
  entries.clear();
}

export function stableImageUriCount(): number {
  return entries.size;
}
