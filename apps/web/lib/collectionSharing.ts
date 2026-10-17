import { formatJupleId } from './accountDisplay.ts';
import type { AppDictionary } from './appI18n.ts';
import { formatMessage } from './appI18n.ts';
import type { CollectionSummary } from './collectionsView.ts';

/**
 * Sharing and participants in a Collection's page - the mobile CollectionDetailsScreen rules on the same API:
 *
 *  - Share: the Owner always has it (their Collection's link - GET /api/v1/collections/{id}/share); a member has it only while the
 *    Owner's link is still public (GET .../share/link, asked again right before sharing - mobile fetchLiveShareUrl). The URL is the
 *    server's own (built from its public Web host); nothing is composed here.
 *  - Participants: only for a collaborative Collection (shared with me, or mine with collaborators / an active public link), from
 *    GET .../participants; drawn as the mobile avatar stack (at most 4 circles, the last becoming "+N").
 */

export type PublicSharePermission = 'read' | 'submit' | 'write';

/** GET /api/v1/collections/{id}/share's `share` (mobile CollectionShare). */
export interface CollectionShare {
  readonly publicId: string;
  readonly shareUrl: string;
  readonly permission?: PublicSharePermission;
  /** Absent from an older server = true (mobile). */
  readonly isPublic?: boolean;
}

export interface CollectionParticipant {
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly role: string;
  readonly isMe?: boolean;
  readonly profileImageUrl?: string | null;
}

export interface CollectionPendingInvitation {
  readonly invitationId: number;
  readonly jupleId: string;
  readonly role: string;
  readonly displayName?: string | null;
  readonly profileImageUrl?: string | null;
}

export interface CollectionParticipants {
  readonly participants: readonly CollectionParticipant[];
  readonly pendingInvitations: readonly CollectionPendingInvitation[];
  readonly canManage: boolean;
}

/** Mobile isSharedWithMe: any role but Owner. */
export function isSharedWithMe(collection: Pick<CollectionSummary, 'accessRole'>): boolean {
  return collection.accessRole === 'contributor' || collection.accessRole === 'viewer' || collection.accessRole === 'submitter';
}

/** Mobile isCollaborative: shared with me, or mine with collaborators or an active public link. */
export function isCollaborative(collection: Pick<CollectionSummary, 'accessRole' | 'hasCollaborators' | 'isPublicShareActive'>): boolean {
  return isSharedWithMe(collection) || collection.hasCollaborators === true || collection.isPublicShareActive === true;
}

/** The share action in the header: the Owner always; a member only with a live public link (mobile memberShareUrl). */
export function canShareCollection(collection: Pick<CollectionSummary, 'accessRole'>, memberShareUrl: string | null): boolean {
  return !isSharedWithMe(collection) || memberShareUrl !== null;
}

/** The mobile role names (collections.role*). An unknown role shows its participant without a label rather than a guessed one. */
export function roleLabel(role: string, dictionary: AppDictionary): string | null {
  switch (role) {
    case 'owner':
      return dictionary.roleOwner;
    case 'contributor':
      return dictionary.roleContributor;
    case 'viewer':
      return dictionary.roleViewer;
    case 'submitter':
      return dictionary.roleSubmitter;
    default:
      return null;
  }
}

/** A person by nickname, else Juple ID (mobile personLabel); "(나)" for the signed-in person (collections.participantMe). */
export function participantName(person: { readonly jupleId: string; readonly displayName?: string | null; readonly isMe?: boolean }, dictionary: AppDictionary): string {
  const name = person.displayName?.trim() || formatJupleId(person.jupleId);
  return person.isMe ? formatMessage(dictionary.participantMe, { name }) : name;
}

/** Mobile avatarInitial: the first character (code point) of the nickname, upper-cased where the script has case; null without one. */
export function avatarInitial(displayName: string | null | undefined): string | null {
  const first = Array.from(displayName?.trim() ?? '')[0];
  return first ? first.toLocaleUpperCase() : null;
}

/**
 * The people of a Collection's participant circles when only the list row's preview is known: the preview names the OTHER people
 * (Owner first, never the caller), so the signed-in person is added - first when they own it (Owner leads), else last. A preview that
 * already holds them, or an unknown profile, is returned unchanged; no face is invented.
 */
export function participantsWithSelf(
  preview: readonly CollectionParticipant[],
  accessRole: string | undefined,
  self: { readonly jupleId: string; readonly displayName: string | null; readonly profileImageUrl?: string | null } | null,
): readonly CollectionParticipant[] {
  if (!self || preview.some(person => person.isMe || person.jupleId === self.jupleId)) {
    return preview;
  }
  const me: CollectionParticipant = { jupleId: self.jupleId, displayName: self.displayName, profileImageUrl: self.profileImageUrl ?? null, role: accessRole ?? 'contributor', isMe: true };
  return accessRole === 'owner' ? [me, ...preview] : [...preview, me];
}

/** Mobile ParticipantAvatarStack: up to `maxVisible` circles; with more people the last slot becomes "+N" (never an extra slot). */
export function avatarStackLayout<T>(people: readonly T[], maxVisible = 4): { readonly visible: readonly T[]; readonly hiddenCount: number } {
  if (people.length <= maxVisible) {
    return { visible: people, hiddenCount: 0 };
  }
  const visible = people.slice(0, maxVisible - 1);
  return { visible, hiddenCount: people.length - visible.length };
}

/** What the link does for whoever opens it (the mobile 공용 컬렉션 설정 descriptions). */
export function shareDescription(share: CollectionShare, dictionary: AppDictionary): string {
  if (share.isPublic === false) {
    return dictionary.sharePrivateDescription;
  }
  return share.permission === 'write' ? dictionary.sharePublicWriteDescription : share.permission === 'submit' ? dictionary.sharePublicSubmitDescription : dictionary.sharePublicReadDescription;
}

export function permissionLabel(permission: PublicSharePermission | undefined, dictionary: AppDictionary): string {
  return permission === 'write' ? dictionary.sharePermissionWrite : permission === 'submit' ? dictionary.sharePermissionSubmit : dictionary.sharePermissionRead;
}
