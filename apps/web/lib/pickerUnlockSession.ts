/**
 * The Collection PICKER's own unlock session (mobile useCategoryPickerModal: sessionUnlockedIds + stagedUnlockTokens). Choosing - or
 * un-choosing - a locked Collection changes its content, so the picker asks for that Collection's password first; the short-lived
 * grant it gets is kept HERE, in the memory of the one editor / review page that owns this session, and sent only with that
 * Collection's own save request. It is never read from, or written to, the Collection Details visit store (collectionUnlock.ts) or
 * a link's opening (itemOpenGrant.ts), never put in storage, a cookie or a URL, and it disappears with the page (reload, leaving,
 * sign-out). The password itself is never kept: only the grant the server returned.
 */

/** A grant is treated as expired slightly early so a save never races its server-side expiry (mobile EXPIRY_MARGIN_MS). */
const EXPIRY_MARGIN_MS = 30_000;

export interface PickerUnlockSession {
  /** Remember the grant a correct password returned for this Collection (ignored without a usable expiry). */
  readonly remember: (collectionId: number, grant: { readonly unlockToken: string; readonly expiresAtUtc: string }) => void;
  /** The grant for this Collection while it is still valid; an expired one is forgotten. */
  readonly tokenFor: (collectionId: number, nowMs?: number) => string | null;
  /** Whether this Collection was unlocked in this session and its grant is still valid - it is then not asked for again. */
  readonly isUnlocked: (collectionId: number, nowMs?: number) => boolean;
  readonly forget: (collectionId: number) => void;
  readonly clear: () => void;
}

export function createPickerUnlockSession(): PickerUnlockSession {
  const grants = new Map<number, { readonly token: string; readonly expiresAtMs: number }>();
  const tokenFor = (collectionId: number, nowMs: number = Date.now()): string | null => {
    const grant = grants.get(collectionId);
    if (!grant) {
      return null;
    }
    if (grant.expiresAtMs - EXPIRY_MARGIN_MS <= nowMs) {
      grants.delete(collectionId);
      return null;
    }
    return grant.token;
  };
  return {
    remember: (collectionId, grant) => {
      const expiresAtMs = Date.parse(grant.expiresAtUtc);
      if (grant.unlockToken && Number.isFinite(expiresAtMs)) {
        grants.set(collectionId, { token: grant.unlockToken, expiresAtMs });
      }
    },
    tokenFor,
    isUnlocked: (collectionId, nowMs) => tokenFor(collectionId, nowMs) !== null,
    forget: collectionId => {
      grants.delete(collectionId);
    },
    clear: () => grants.clear(),
  };
}

/** The unlock tokens of the chosen Collections, by id - the `unlockTokens` of POST /api/v1/inbox (only those that hold a grant). */
export function unlockTokensFor(session: Pick<PickerUnlockSession, 'tokenFor'>, collectionIds: readonly number[], nowMs?: number): Record<number, string> {
  const tokens: Record<number, string> = {};
  for (const collectionId of collectionIds) {
    const token = session.tokenFor(collectionId, nowMs);
    if (token) {
      tokens[collectionId] = token;
    }
  }
  return tokens;
}
