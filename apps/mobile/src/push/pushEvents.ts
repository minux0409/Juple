/**
 * Social Push messages received while the app is in the foreground, fanned out to whichever screens
 * are listening (see useLiveRefresh). The wire "type" values come from the Backend's
 * SocialNotificationPolicy.WireType; payloads carry ids only - never names, notes or links.
 * Module-level on purpose: the FCM listener that emits here has no component of its own.
 */
export type SocialPushEventType =
  | 'friendRequest'
  | 'collectionInvitation'
  | 'collectionInvitationAnswered'
  | 'collectionContentChanged'
  | 'friendRequestAnswered'
  | 'collectionItemsAdded'
  | 'collectionLinkShared'
  | 'collectionItemReaction'
  | 'collectionItemComment'
  | 'collectionLinkSubmission'
  | 'collectionLinkSubmissionApproved'
  | 'collectionLinkSubmissionRejected';

export interface SocialPushEvent {
  readonly type: SocialPushEventType;
  readonly collectionId: number | null;
  /**
   * collectionLinkShared, and a proposal result for someone who is no member: the public link's id
   * (the recipient is not a member - no collectionId).
   */
  readonly publicId?: string | null;
}

const KNOWN_TYPES: ReadonlySet<string> = new Set<SocialPushEventType>([
  'friendRequest',
  'collectionInvitation',
  'collectionInvitationAnswered',
  'collectionContentChanged',
  'friendRequestAnswered',
  'collectionItemsAdded',
  'collectionLinkShared',
  'collectionItemReaction',
  'collectionItemComment',
  'collectionLinkSubmission',
  'collectionLinkSubmissionApproved',
  'collectionLinkSubmissionRejected',
]);

/** A public link id as the server mints it - anything else is ignored rather than navigated to. */
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

type Listener = (event: SocialPushEvent) => void;

const listeners = new Set<Listener>();

/** Parses an FCM data payload (untyped strings, possibly stale or malformed); null when not ours. */
export function parseSocialPushEvent(data: Readonly<Record<string, unknown>> | null | undefined): SocialPushEvent | null {
  const type = data?.type;
  if (typeof type !== 'string' || !KNOWN_TYPES.has(type)) {
    return null;
  }
  const collectionId = Number(data?.collectionId);
  const publicId = data?.publicId;
  return {
    type: type as SocialPushEventType,
    collectionId: Number.isInteger(collectionId) && collectionId > 0 ? collectionId : null,
    publicId: typeof publicId === 'string' && PUBLIC_ID_PATTERN.test(publicId) ? publicId : null,
  };
}

export function emitSocialPushEvent(event: SocialPushEvent): void {
  for (const listener of [...listeners]) {
    listener(event);
  }
}

export function subscribeSocialPushEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
