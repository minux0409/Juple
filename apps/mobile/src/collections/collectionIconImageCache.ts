/**
 * Keeps a Collection's icon photo on screen without a reload flash. The server signs a fresh
 * short-lived read URL on every response, so the URL string differs every time the Collections list
 * refreshes - and the platform image caches (Fresco on Android, the URL cache on iOS) key on that
 * exact string, so every refresh used to re-download the same photo and flash an empty tile first.
 *
 * Instead, the first URI seen for a given photo (collectionId + the server's iconImageVersion,
 * which changes only when the photo itself is replaced or removed) is kept and handed out again
 * for every later response carrying that same version - so the image cache hits, even after that
 * URL has expired, because the bytes are already cached under it. When the cached copy is gone and
 * the old URL has expired, CategoryIconTile reports the failure and the current fresh URL takes its
 * place (see replaceFailedCollectionIconUri). A new version, or no photo at all, drops the old entry
 * at once, so a replaced or removed photo never lingers.
 *
 * Nothing is fetched ahead of time: a photo loads when its card actually mounts (near the
 * viewport, see CollectionsScreen's virtualized list) - the platform image cache does the rest.
 *
 * Memory only, per app session: a signed URL is never written to disk, logs or any storage.
 */
interface Entry {
  readonly version: string;
  readonly uri: string;
}

const entries = new Map<number, Entry>();

/**
 * The URI to show for a Collection's photo in this response. imageUrl is the response's fresh
 * signed URL (null: no photo); version is its iconImageVersion (absent from an older server - then
 * the fresh URL is used as-is, exactly as before).
 */
export function resolveCollectionIconUri(collectionId: number, version: string | null | undefined, imageUrl: string | null | undefined): string | null {
  if (!imageUrl) {
    entries.delete(collectionId);
    return null;
  }
  if (!version) {
    return imageUrl;
  }
  const existing = entries.get(collectionId);
  if (existing && existing.version === version) {
    return existing.uri;
  }
  entries.set(collectionId, { version, uri: imageUrl });
  return imageUrl;
}

/**
 * Right after the user's own new photo is saved: show the file they just picked (already on the
 * device) for that new version, instead of downloading the uploaded copy back.
 */
export function rememberLocalCollectionIcon(collectionId: number, version: string | null | undefined, localUri: string): void {
  if (version) {
    entries.set(collectionId, { version, uri: localUri });
  }
}

/** The photo was removed - nothing of it may be shown again. */
export function forgetCollectionIcon(collectionId: number): void {
  entries.delete(collectionId);
}

/**
 * The kept URI could not be loaded (the cached copy was evicted and the URL has expired, or a picked
 * local file was cleaned up): from now on the response's fresh URL stands for this version.
 */
export function replaceFailedCollectionIconUri(collectionId: number, failedUri: string, imageUrl: string): void {
  const existing = entries.get(collectionId);
  if (existing && existing.uri === failedUri) {
    entries.set(collectionId, { version: existing.version, uri: imageUrl });
  }
}

/** Test-only: starts every test from an empty session. */
export function resetCollectionIconCacheForTests(): void {
  entries.clear();
}
