/**
 * The unlock grant of ONE locked link's opening (mobile items/itemOpenGrant.ts + useItemCardOpen): a Home / 보관함 card whose link
 * belongs to a locked Collection is read IN that Collection (GET /api/v1/items/{id}?collectionId=) with the grant its password
 * returned. The grant is kept in memory only (never storage, a cookie or a URL) for as long as the person stays in THAT link's pages
 * (its details and its editor) and is forgotten as soon as they go anywhere else, sign out or reload - the next open asks for the
 * password again. A Collection Details visit's grant is never borrowed, and this grant never opens anything else: the server checks
 * it per Collection against the lock's current version.
 */

/** A grant is treated as expired slightly early so a request never races its server-side expiry (mobile EXPIRY_MARGIN_MS). */
const EXPIRY_MARGIN_MS = 30_000;

interface HeldGrant {
  readonly collectionId: number;
  readonly token: string;
  readonly expiresAtMs: number;
}

const held = new Map<number, HeldGrant>();

/** Keeps the grant for this link (replacing any earlier one). Ignored when it has no usable expiry. */
export function holdItemOpenGrant(itemId: number, collectionId: number, grant: { readonly unlockToken: string; readonly expiresAtUtc: string }): void {
  const expiresAtMs = Date.parse(grant.expiresAtUtc);
  if (grant.unlockToken && Number.isFinite(expiresAtMs)) {
    held.set(itemId, { collectionId, token: grant.unlockToken, expiresAtMs });
  }
}

/** The grant for this link IN this Collection, or null (none held, another Collection's, or expired - which also forgets it). */
export function itemOpenGrantFor(itemId: number, collectionId: number, nowMs: number = Date.now()): string | null {
  const grant = held.get(itemId);
  if (!grant || grant.collectionId !== collectionId) {
    return null;
  }
  if (grant.expiresAtMs - EXPIRY_MARGIN_MS <= nowMs) {
    held.delete(itemId);
    return null;
  }
  return grant.token;
}

export function forgetItemOpenGrant(itemId: number): void {
  held.delete(itemId);
}

/** Leaving a link's pages ends its opening: every grant for a link the current path is not inside is forgotten. */
export function forgetItemOpenGrantsOutside(pathname: string): void {
  for (const itemId of [...held.keys()]) {
    const base = `/items/${itemId}`;
    if (pathname !== base && !pathname.startsWith(`${base}/`)) {
      held.delete(itemId);
    }
  }
}

/** Sign-out: nothing of this session survives. */
export function clearItemOpenGrants(): void {
  held.clear();
}

/** The query that reads / edits a link IN the Collection that locks its card (the server then applies that Collection's gate first). */
export function lockedContextSearch(collectionId: number): string {
  return `?lockedBy=${collectionId}`;
}

/** The Collection id of a `?lockedBy=` context, or null when absent / malformed. */
export function parseLockedContext(value: string | null | undefined): number | null {
  return value && /^[1-9]\d{0,15}$/.test(value) ? Number(value) : null;
}
