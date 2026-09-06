/**
 * A Push notification's data payload as it arrives on the wire (FCM/APNs data payloads are always
 * string-keyed, untyped, and can be malformed or stale by the time the user taps them - see
 * PushNotificationPayload on the Backend, which is the intended source of these fields, but this
 * resolver never assumes the payload actually came from there).
 */
export interface PushTapPayload {
  readonly type?: unknown;
  readonly notificationId?: unknown;
  readonly repeatPurchaseId?: unknown;
  readonly itemId?: unknown;
}

export type PushTapNavigationTarget =
  | { readonly screen: 'RepeatPurchaseDetails'; readonly params: { readonly repeatPurchaseId: number } }
  | { readonly screen: 'Notifications' };

/**
 * Resolves a tapped Push notification to where RootStack should navigate - cold start, warm
 * background-to-foreground, and already-foregrounded taps all funnel through this one pure
 * function, so the tap-handling call site (added once a real FCM/APNs tap listener exists - see
 * this feature's own Mobile design notes on why that listener is not wired yet) never needs its own
 * payload-parsing logic. Never throws: a missing/malformed field just falls through to the next
 * rule, and a payload with nothing usable in it resolves null (the caller then does nothing rather
 * than navigating anywhere) - signed-out handling belongs to the caller (RootStack's existing
 * AuthGate already gates every screen this could target), not this pure resolver.
 */
export function resolvePushTapNavigation(payload: PushTapPayload | null | undefined): PushTapNavigationTarget | null {
  if (!payload) {
    return null;
  }

  const repeatPurchaseId = parsePositiveInt(payload.repeatPurchaseId);
  if (repeatPurchaseId !== null) {
    return { screen: 'RepeatPurchaseDetails', params: { repeatPurchaseId } };
  }

  if (typeof payload.type === 'string' && payload.type.length > 0) {
    return { screen: 'Notifications' };
  }

  return null;
}

function parsePositiveInt(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
