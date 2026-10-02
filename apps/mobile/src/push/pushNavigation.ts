import { parseSocialPushEvent } from './pushEvents';

/** A tapped Push notification's data payload as it arrives (untyped, possibly stale or malformed). */
export type PushTapPayload = Readonly<Record<string, unknown>>;

export type PushTapNavigationTarget =
  | { readonly screen: 'Friends' }
  | { readonly screen: 'CollectionShareRequests' }
  | { readonly screen: 'CollectionDetails'; readonly collectionId: number }
  | { readonly screen: 'CollectionSubmissions'; readonly collectionId: number }
  | { readonly screen: 'SharedCollection'; readonly publicId: string };

/**
 * Where a tapped notification leads - cold start, background and foreground taps all resolve here.
 * 친구 신청 → Friends (received requests are listed first); 컬렉션 공유 → Collections › 공유 컬렉션 ›
 * 공유 요청; 새 링크, a reaction or a comment on my link → that Collection (the server re-checks access
 * when it opens); 승인 요청 → that Collection's 승인 대기 list; my proposal's result → that Collection
 * when I belong to it, else its public link page, else nowhere. Refresh-only messages have no tray
 * notification, so they never resolve to a target.
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
  if (
    (event?.type === 'collectionItemsAdded' || event?.type === 'collectionItemReaction' || event?.type === 'collectionItemComment')
    && event.collectionId !== null
  ) {
    return { screen: 'CollectionDetails', collectionId: event.collectionId };
  }
  if (event?.type === 'collectionLinkSubmission' && event.collectionId !== null) {
    return { screen: 'CollectionSubmissions', collectionId: event.collectionId };
  }
  // The result of my proposal: the server sends the Collection's id only to someone who belongs to
  // it, and the public link's id (while it is on) to someone who proposed through it - else neither,
  // and the tap just opens the app.
  if (event?.type === 'collectionLinkSubmissionApproved' || event?.type === 'collectionLinkSubmissionRejected') {
    if (event.collectionId !== null) {
      return { screen: 'CollectionDetails', collectionId: event.collectionId };
    }
    return event.publicId ? { screen: 'SharedCollection', publicId: event.publicId } : null;
  }
  // A Collection's public link someone passed on: the public link page (its own password gate) -
  // never membership, never the Collection's own screen.
  if (event?.type === 'collectionLinkShared' && event.publicId) {
    return { screen: 'SharedCollection', publicId: event.publicId };
  }
  return null;
}
