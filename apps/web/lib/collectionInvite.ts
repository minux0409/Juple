import { ApiHttpError } from './appApi.ts';
import type { AppDictionary } from './appI18n.ts';
import { INVITATION_ROLE_RANK, ROLES, raiseToMinimum, roleOptionLabel, type InvitationRole } from './collectionShareManage.ts';
import type { CollectionParticipants } from './collectionSharing.ts';

/**
 * Inviting friends to a Collection from the Web - the mobile flow on the same API (collaborationApi.inviteCollaborator +
 * FriendPickerModal): the Owner picks accepted friends, chooses what they may do (읽기 전용 / 승인 후 추가 / 링크 추가) and the invitations go
 * through the normal invite / accept flow - being friends grants nothing by itself.
 *
 *  - POST /api/v1/collections/{id}/invitations { jupleId, role } with the Collection's unlock grant when it is locked.
 *  - GET  /api/v1/friends?query&cursor&limit - the same list as 친구 (the private note is shown to find people, never sent).
 */

export type InviteRole = InvitationRole;
/** All three real roles, in rank order (mobile: 읽기 전용 / 승인 후 추가 / 링크 추가). */
export const INVITE_ROLES: readonly InviteRole[] = ROLES;

export const FRIEND_PICKER_PAGE_LIMIT = 50;
export const FRIEND_PICKER_DEBOUNCE_MS = 300;

export function invitationsPath(collectionId: number): string {
  return `/api/v1/collections/${collectionId}/invitations`;
}

export function friendPickerPath(query: string, cursor: string | null): string {
  const params = new URLSearchParams({ limit: String(FRIEND_PICKER_PAGE_LIMIT) });
  if (query.trim()) {
    params.set('query', query.trim());
  }
  if (cursor) {
    params.set('cursor', cursor);
  }
  return `/api/v1/friends?${params.toString()}`;
}

export type FriendUnavailableReason = 'member' | 'pending';

/** Friends that cannot be picked, and why: already in the Collection, or already invited (mobile FriendUnavailableReason). */
export function unavailableFriends(participants: CollectionParticipants | null): ReadonlyMap<string, FriendUnavailableReason> {
  const map = new Map<string, FriendUnavailableReason>();
  for (const person of participants?.participants ?? []) {
    map.set(person.jupleId, 'member');
  }
  for (const invitation of participants?.pendingInvitations ?? []) {
    map.set(invitation.jupleId, 'pending');
  }
  return map;
}

/** Mobile invite error words: a person who is already in, an invitation already waiting, yourself, else the generic sentence. */
export function inviteErrorMessage(error: unknown, dictionary: AppDictionary): string {
  if (error instanceof ApiHttpError) {
    if (error.status === 409 && error.code === 'alreadyCollaborator') {
      return dictionary.inviteAlreadyCollaborator;
    }
    if (error.status === 409 && error.code === 'invitationPending') {
      return dictionary.inviteAlreadyPending;
    }
    if (error.status === 400) {
      return dictionary.inviteSelf;
    }
  }
  return dictionary.inviteFallback;
}

export function inviteRoleLabel(role: InviteRole, dictionary: AppDictionary): string {
  return roleOptionLabel(role, dictionary);
}

// ---- invite by Juple ID (mobile CollectionShareScreen's ID tab) ----------------------------------------------------------------

/** POST /api/v1/users/lookup-by-juple-id - the same exact-ID lookup as 친구 추가 (mobile lookupJupleId); found only on 찾기. */
export const JUPLE_ID_LOOKUP_PATH = '/api/v1/users/lookup-by-juple-id';

export type IdInviteUnavailable = 'self' | 'member' | 'pending';

/**
 * Why a found person cannot be invited here (mobile unavailableReason): it is me, they are already in the Collection, or an invitation
 * to them is already waiting. Null = they can be invited. The server decides again on send (409 alreadyCollaborator / invitationPending).
 */
export function idInviteUnavailable(
  person: { readonly jupleId: string; readonly isSelf?: boolean },
  participants: CollectionParticipants | null,
): IdInviteUnavailable | null {
  if (person.isSelf || participants?.participants.some(member => member.isMe && member.jupleId === person.jupleId)) {
    return 'self';
  }
  if (participants?.participants.some(member => member.jupleId === person.jupleId)) {
    return 'member';
  }
  if (participants?.pendingInvitations.some(invitation => invitation.jupleId === person.jupleId)) {
    return 'pending';
  }
  return null;
}

/** The mobile words for each reason (collaboration.cannotInviteSelf / alreadyCollaborator / invitationAlreadyPending). */
export function idInviteUnavailableMessage(reason: IdInviteUnavailable, dictionary: AppDictionary): string {
  return reason === 'self' ? dictionary.inviteSelf : reason === 'member' ? dictionary.inviteAlreadyCollaborator : dictionary.inviteAlreadyPending;
}

/** The invitation body: never below the public link's level (mobile raiseToMinimum) - a lower choice is raised, never sent as is. */
export function idInviteBody(jupleId: string, role: InviteRole, minimumRole: InviteRole | null): { readonly jupleId: string; readonly role: InviteRole } {
  return { jupleId, role: raiseToMinimum(role, minimumRole) };
}

/** The role choices a row may offer: the three real levels, lowest first, none below the public link's level. */
export function selectableRoles(minimumRole: InviteRole | null): readonly InviteRole[] {
  return [...ROLES].sort((a, b) => INVITATION_ROLE_RANK[a] - INVITATION_ROLE_RANK[b]).filter(role => raiseToMinimum(role, minimumRole) === role);
}
