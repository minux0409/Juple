import { parseSocialPushEvent } from '../push/pushEvents';
import type { NotificationTargetWire } from './notificationsApi';

/**
 * Where a notification leads - the ONE mapping every entry point uses: an OS Push tap (cold start,
 * background or foreground), the in-app banner and a Notifications screen row all end in
 * navigateToNotificationTarget below, never in a switch of their own.
 *
 *  친구 신청 → Friends (received requests first)
 *  컬렉션 공유 (초대) → Collections › 공유 컬렉션 › 공유 요청 while it waits; the Collection once joined
 *  새 링크 / 승인 결과 → that Collection (a non-member proposer: its public link page while it is on)
 *  반응 / 댓글 → my link inside that Collection (댓글: scrolled to the comments) - opened THROUGH the
 *               Collection, so its lock/share-password gate and visit-scoped unlock apply as usual
 *  승인 요청 → that Collection's 승인 대기 list
 *  컬렉션 링크 전달 → the public link page (its own password gate) - never membership
 *  anything no longer reachable → 'unavailable': the caller stays put and says so
 */
export type NotificationTarget =
  | { readonly kind: 'friendRequests' }
  | { readonly kind: 'collectionInvitations' }
  | { readonly kind: 'collection'; readonly collectionId: number }
  | { readonly kind: 'collectionItem'; readonly collectionId: number; readonly itemId: number; readonly focus: 'comments' | null }
  | { readonly kind: 'collectionSubmissions'; readonly collectionId: number }
  | { readonly kind: 'publicCollection'; readonly publicId: string }
  | { readonly kind: 'unavailable' };

export const UNAVAILABLE_TARGET: NotificationTarget = { kind: 'unavailable' };

/** A public link id as the server mints it - anything else is ignored rather than navigated to. */
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function positiveId(value: unknown): number | null {
  const id = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * The server's target for a notification (GET /notifications or /notifications/{id}). Untrusted
 * input: an unknown kind or a malformed id is 'unavailable', never a half-built navigation.
 */
export function parseNotificationTarget(wire: NotificationTargetWire | null | undefined): NotificationTarget {
  const collectionId = positiveId(wire?.collectionId);
  switch (wire?.kind) {
    case 'friendRequests':
      return { kind: 'friendRequests' };
    case 'collectionInvitations':
      return { kind: 'collectionInvitations' };
    case 'collection':
      return collectionId !== null ? { kind: 'collection', collectionId } : UNAVAILABLE_TARGET;
    case 'collectionItem': {
      const itemId = positiveId(wire.itemId);
      if (collectionId === null) {
        return UNAVAILABLE_TARGET;
      }
      return itemId !== null
        ? { kind: 'collectionItem', collectionId, itemId, focus: wire.focus === 'comments' ? 'comments' : null }
        : { kind: 'collection', collectionId };
    }
    case 'collectionSubmissions':
      return collectionId !== null ? { kind: 'collectionSubmissions', collectionId } : UNAVAILABLE_TARGET;
    case 'publicCollection':
      return typeof wire.publicId === 'string' && PUBLIC_ID_PATTERN.test(wire.publicId)
        ? { kind: 'publicCollection', publicId: wire.publicId }
        : UNAVAILABLE_TARGET;
    default:
      return UNAVAILABLE_TARGET;
  }
}

/** The canonical reference a Round 34+ Push carries; null for an older Push (or a malformed id). */
export function notificationIdOf(data: Readonly<Record<string, unknown>> | null | undefined): number | null {
  return positiveId(data?.notificationId);
}

/**
 * A Push delivered before notificationId lookups existed (or one whose lookup failed): the Type and
 * the routing ids it carries - collectionId for a member, the public link's id for a non-member.
 * Coarser than the server's target (a reaction/comment opens its Collection, not the link), but
 * never wrong; null when nothing in it can be opened.
 */
export function legacyPushTarget(data: Readonly<Record<string, unknown>> | null | undefined): NotificationTarget | null {
  const event = parseSocialPushEvent(data);
  if (!event) {
    return null;
  }
  switch (event.type) {
    case 'friendRequest':
      return { kind: 'friendRequests' };
    case 'collectionInvitation':
      return { kind: 'collectionInvitations' };
    case 'collectionItemsAdded':
    case 'collectionItemReaction':
    case 'collectionItemComment':
      return event.collectionId !== null ? { kind: 'collection', collectionId: event.collectionId } : null;
    case 'collectionLinkSubmission':
      return event.collectionId !== null ? { kind: 'collectionSubmissions', collectionId: event.collectionId } : null;
    case 'collectionLinkSubmissionApproved':
    case 'collectionLinkSubmissionRejected':
      if (event.collectionId !== null) {
        return { kind: 'collection', collectionId: event.collectionId };
      }
      return event.publicId ? { kind: 'publicCollection', publicId: event.publicId } : null;
    case 'collectionLinkShared':
      return event.publicId ? { kind: 'publicCollection', publicId: event.publicId } : null;
    default:
      // Refresh-only messages have no tray notification - nothing to open.
      return null;
  }
}

/** The navigator calls one target turns into - what navigateToNotificationTarget performs. */
export type NotificationNavigationAction =
  | { readonly name: 'Friends' }
  | { readonly name: 'MainTabs'; readonly params: { readonly screen: 'Collections'; readonly params: { readonly filter: 'shared'; readonly openShareRequests: true; readonly refreshToken: number } } }
  | { readonly name: 'CollectionDetails'; readonly params: { readonly collectionId: number; readonly refreshToken: number; readonly openItem?: { readonly itemId: number; readonly focus: 'comments' | null }; readonly openApprovals?: true } }
  | { readonly name: 'SharedCollection'; readonly params: { readonly publicId: string } };

/** Null for 'unavailable' - the caller then stays where it is. */
export function navigationActionFor(target: NotificationTarget, nowMs: number = Date.now()): NotificationNavigationAction | null {
  switch (target.kind) {
    case 'friendRequests':
      return { name: 'Friends' };
    case 'collectionInvitations':
      return { name: 'MainTabs', params: { screen: 'Collections', params: { filter: 'shared', openShareRequests: true, refreshToken: nowMs } } };
    case 'collection':
      return { name: 'CollectionDetails', params: { collectionId: target.collectionId, refreshToken: nowMs } };
    case 'collectionItem':
      // Through the Collection: it opens the link once its content is open (lock gate included).
      return {
        name: 'CollectionDetails',
        params: { collectionId: target.collectionId, refreshToken: nowMs, openItem: { itemId: target.itemId, focus: target.focus } },
      };
    case 'collectionSubmissions':
      // Through the Collection: its 링크 승인 대기 popup opens once the content is open (lock gate included).
      return { name: 'CollectionDetails', params: { collectionId: target.collectionId, refreshToken: nowMs, openApprovals: true } };
    case 'publicCollection':
      return { name: 'SharedCollection', params: { publicId: target.publicId } };
    case 'unavailable':
      return null;
  }
}
