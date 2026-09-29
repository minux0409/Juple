/**
 * Keeps a person's profile photo on screen without a reload flash - the same approach as
 * collectionIconImageCache. The server signs a fresh short-lived read URL on every response, and
 * the platform image caches (Fresco on Android, the URL cache on iOS) key on that exact string, so
 * the first URI seen for a given photo (the person's public Juple ID + the server's
 * profileImageVersion, which changes only when the photo itself is replaced or removed) is handed
 * out again for every later response carrying that same version.
 *
 * Nothing is fetched ahead of time: a photo loads when its avatar actually mounts - never a
 * prefetch over a whole people list.
 *
 * Memory only, per app session: a signed URL is never written to disk, logs or any storage.
 */
interface Entry {
  readonly version: string;
  readonly uri: string;
}

const entries = new Map<string, Entry>();

/** The URI to show for this person's photo in this response (null: no photo). */
export function resolveProfileImageUri(jupleId: string, version: string | null | undefined, imageUrl: string | null | undefined): string | null {
  if (!imageUrl) {
    entries.delete(jupleId);
    return null;
  }
  if (!version) {
    return imageUrl;
  }
  const existing = entries.get(jupleId);
  if (existing && existing.version === version) {
    return existing.uri;
  }
  entries.set(jupleId, { version, uri: imageUrl });
  return imageUrl;
}

/** Right after the user's own new photo is saved: show the file just picked instead of downloading it back. */
export function rememberLocalProfileImage(jupleId: string, version: string | null | undefined, localUri: string): void {
  if (version) {
    entries.set(jupleId, { version, uri: localUri });
  }
}

/** The photo was removed - nothing of it may be shown again. */
export function forgetProfileImage(jupleId: string): void {
  entries.delete(jupleId);
}

/** The kept URI could not be loaded: from now on the response's fresh URL stands for this version. */
export function replaceFailedProfileImageUri(jupleId: string, failedUri: string, imageUrl: string): void {
  const existing = entries.get(jupleId);
  if (existing && existing.uri === failedUri) {
    entries.set(jupleId, { version: existing.version, uri: imageUrl });
  }
}

/** Test-only: starts every test from an empty session. */
export function resetProfileImageCacheForTests(): void {
  entries.clear();
}
