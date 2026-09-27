import { parseSocialPushEvent } from './pushEvents';

/** A tapped Push notification's data payload as it arrives (untyped, possibly stale or malformed). */
export type PushTapPayload = Readonly<Record<string, unknown>>;

export type PushTapNavigationTarget =
  | { readonly screen: 'Friends' }
  | { readonly screen: 'CollectionShareRequests' };

/**
 * Where a tapped notification leads - cold start, background and foreground taps all resolve here.
 * 친구 신청 → Friends (received requests are listed first); 컬렉션 공유 → Collections › 공유 컬렉션 ›
 * 공유 요청. Refresh-only messages have no tray notification, so they never resolve to a target.
 * Never throws; anything unrecognized resolves null (the caller then stays where it is).
 */
export function resolvePushTapNavigation(payload: PushTapPayload | null | undefined): PushTapNavigationTarget | null {
  const event = parseSocialPushEvent(payload);
  if (event?.type === 'friendRequest') {
    return { screen: 'Friends' };
  }
  if (event?.type === 'collectionInvitation') {
    return { screen: 'CollectionShareRequests' };
  }
  return null;
}
