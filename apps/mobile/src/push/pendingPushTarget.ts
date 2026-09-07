import type { PushTapPayload } from './pushNavigation';

/**
 * Holds at most one tapped Push payload that arrived before it was actually safe to navigate to it
 * - cold start (NavigationContainer/auth bootstrap not ready yet) or a tap while signed out (see
 * usePushMessageHandling.ts, the only reader/writer of this module). Deliberately just one
 * in-memory slot, not a queue and not persisted: a real second tap before the first is consumed
 * simply replaces it, matching how a user would only ever act on the most recent notification they
 * tapped anyway. Module-level (not React state) because the writers are plain FCM event listeners
 * with no component of their own.
 */
let pendingTarget: PushTapPayload | null = null;

export function setPendingPushTarget(payload: PushTapPayload | null): void {
  pendingTarget = payload;
}

/** Returns the pending payload (if any) and clears it - a payload is consumed at most once. */
export function consumePendingPushTarget(): PushTapPayload | null {
  const payload = pendingTarget;
  pendingTarget = null;
  return payload;
}
