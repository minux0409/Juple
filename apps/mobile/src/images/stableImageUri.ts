import { useCallback, useEffect, useState } from 'react';

/**
 * Keeps an uploaded Item photo coming from the image cache instead of the network. The server signs a fresh short-lived read URL
 * on every response, and the platform image caches (Fresco on Android, the URL cache on iOS) key on that exact string - so the
 * same, never-changing Blob used to be downloaded again on every list refresh and every detail open.
 *
 * The same rule as the Collection icon / profile photo caches (collectionIconImageCache.ts, profileImageCache.ts): the first URI
 * seen for a photo variant is kept and handed out again for every later response. The identity is the image id plus the variant
 * (`${imageId}:thumb`, `${imageId}:main`) - an Item photo is immutable (a replacement is a new id and a new Blob), so one key
 * always means the same bytes. The fetch itself is always the server's signed URL; nothing is made public and no SAS lifetime
 * changes. When the kept URI cannot load (its cached copy was evicted after the signature expired), the response's fresh URL
 * takes its place once; if that also fails the caller shows its fallback - never a retry loop.
 *
 * Memory only, per app session, bounded, and cleared on every way out of a session (AuthContext): a signed URL is never written
 * to disk, logs or storage, and never reaches another account.
 */
const MAX_ENTRIES = 500;
const entries = new Map<string, string>();

export type ImageVariant = 'thumb' | 'main';

export function imageCacheKey(imageId: number, variant: ImageVariant): string {
  return `${imageId}:${variant}`;
}

/** The URI to show for this photo variant in this response. No key (an external preview) or no URL: the response's own URL. */
export function resolveStableImageUri(cacheKey: string | null | undefined, freshUri: string | null | undefined): string | null {
  if (!freshUri) {
    return null;
  }
  if (!cacheKey) {
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

/** The kept URI could not be loaded: from now on the response's fresh URL stands for this photo variant. */
export function replaceFailedStableImageUri(cacheKey: string, failedUri: string, freshUri: string): void {
  if (entries.get(cacheKey) === failedUri) {
    entries.set(cacheKey, freshUri);
  }
}

/** Every way out of a session: no private photo URL may outlive it. */
export function clearStableImageUris(): void {
  entries.clear();
}

/** Test-only. */
export function stableImageUriCountForTests(): number {
  return entries.size;
}

/**
 * The URI to render for one photo variant, and what to do when it fails: the kept URI first, then (once) this response's fresh
 * URL, then null - the caller's own fallback (site icon, empty tile). A failure of the fresh URL is treated as "this photo is not
 * available" (deleted or refused), a failure of an older kept URL as an expired signature.
 */
export function useStableImageUri(cacheKey: string | null | undefined, freshUri: string | null | undefined): { readonly uri: string | null; readonly onError: () => void } {
  const [failedUris, setFailedUris] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    setFailedUris(new Set());
  }, [freshUri]);

  const keptUri = resolveStableImageUri(cacheKey, freshUri);
  const uri = [keptUri, freshUri].find(candidate => !!candidate && !failedUris.has(candidate)) ?? null;
  const onError = useCallback(() => {
    if (!uri) {
      return;
    }
    if (cacheKey && freshUri && uri !== freshUri) {
      replaceFailedStableImageUri(cacheKey, uri, freshUri);
    }
    setFailedUris(previous => new Set(previous).add(uri));
  }, [cacheKey, freshUri, uri]);
  return { uri, onError };
}
