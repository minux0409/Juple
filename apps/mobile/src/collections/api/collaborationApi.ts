import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';
import { storedUnlockHeaders } from '../collectionUnlockGrants';
import type { CollectionParticipant } from './collectionsApi';

/**
 * Sharing a Collection with specific people - people are identified to each other only by their
 * public Juple ID, the display name they chose themselves and their optional profile photo; the
 * server never returns an internal id or an email. Typing a Juple ID never grants anything by itself: the Owner invites, and only the
 * invited person can accept.
 */

export interface CollectionPendingInvitation {
  readonly invitationId: number;
  readonly jupleId: string;
  readonly role: string;
  readonly createdAtUtc: string;
  readonly expiresAtUtc: string;
  readonly displayName?: string | null;
  readonly profileImageUrl?: string | null;
  readonly profileImageVersion?: string | null;
}

/**
 * Everyone in a Collection, visible to every member: the Owner and accepted Contributors.
 * pendingInvitations/canManage are the Owner's alone (empty/false for a Contributor).
 */
export interface CollectionParticipants {
  readonly participants: readonly CollectionParticipant[];
  readonly pendingInvitations: readonly CollectionPendingInvitation[];
  readonly canManage: boolean;
}

export interface ReceivedCollectionInvitation {
  readonly invitationId: number;
  readonly collectionId: number;
  readonly collectionName: string;
  readonly icon: string;
  readonly color: string | null;
  readonly ownerJupleId: string;
  readonly ownerDisplayName?: string | null;
  readonly ownerProfileImageUrl?: string | null;
  readonly ownerProfileImageVersion?: string | null;
  readonly role: string;
  readonly createdAtUtc: string;
  readonly expiresAtUtc: string;
}

export interface JupleIdLookupResult {
  readonly jupleId: string;
  readonly isSelf: boolean;
  /** The person's own chosen display name, if they set one. */
  readonly displayName?: string | null;
  readonly profileImageUrl?: string | null;
  readonly profileImageVersion?: string | null;
}

/**
 * What an Owner gives a specific person: 읽기 전용 ('viewer' - only looks), 승인 후 추가 ('submitter' -
 * proposes links the Owner approves) or 링크 추가 ('contributor' - adds their own links). The wire
 * values are the server's role names; they are never shown to users.
 */
export type InvitationRole = 'contributor' | 'viewer' | 'submitter';

/** The three levels in order - the public link's permission is the minimum anyone may have. */
export const INVITATION_ROLE_RANK: Readonly<Record<InvitationRole, number>> = { viewer: 0, submitter: 1, contributor: 2 };

/** A pending/received invitation's wire role ("Contributor"/"Viewer"/"Submitter") as an InvitationRole. */
export function invitationRoleOf(role: string): InvitationRole {
  const normalized = role.toLowerCase();
  return normalized === 'viewer' ? 'viewer' : normalized === 'submitter' ? 'submitter' : 'contributor';
}

/** The label key for a member's role ("owner" → 소유자, "viewer" → 읽기, "contributor" → 쓰기). */
export function participantRoleLabelKey(role: string): string {
  switch (role.toLowerCase()) {
    case 'owner':
      return 'collections.roleOwner';
    case 'viewer':
      return 'collections.roleViewer';
    case 'submitter':
      return 'collections.roleSubmitter';
    default:
      return 'collections.roleContributor';
  }
}

/** What to show for a person: their chosen display name, or their (display-formatted) Juple ID. */
export function personLabel(person: { readonly jupleId: string; readonly displayName?: string | null }): string {
  return person.displayName ?? formatJupleId(person.jupleId);
}

/** Display form "K7MP-4Q8N" of a canonical Juple ID - the stored/sent value never has the separator. */
export function formatJupleId(jupleId: string): string {
  return jupleId.length === 8 ? `${jupleId.slice(0, 4)}-${jupleId.slice(4)}` : jupleId;
}

/** Exact match only; rejects with ApiError notFound for an unknown ID, tooManyRequests when rate limited. */
export async function lookupJupleId(request: AuthenticatedApiRequest, jupleId: string): Promise<JupleIdLookupResult> {
  const response = await request<JupleIdLookupResult>({
    method: 'POST',
    path: '/api/v1/users/lookup-by-juple-id',
    body: { jupleId },
  });
  if (!response.body) {
    throw new Error('Juple API returned no lookup result.');
  }
  return response.body;
}

/** Any member (Owner or Contributor); no unlock grant needed - membership is not Collection content. */
export async function getCollectionParticipants(
  request: AuthenticatedApiRequest,
  collectionId: number,
): Promise<CollectionParticipants> {
  const response = await request<CollectionParticipants>({
    method: 'GET',
    path: `/api/v1/collections/${collectionId}/participants`,
  });
  if (!response.body) {
    throw new Error('Juple API returned no participants body.');
  }
  return response.body;
}

/**
 * Owner only. Invites with 쓰기 ('contributor', the server's default) or 읽기 ('viewer'). Conflicts
 * (ApiError conflict, code): "alreadyCollaborator", "invitationPending", "publicShareActive" (쓰기
 * while the public link is on); badRequest for inviting yourself; notFound for an unknown Juple ID.
 */
export async function inviteCollaborator(
  request: AuthenticatedApiRequest,
  collectionId: number,
  jupleId: string,
  role: InvitationRole = 'contributor',
): Promise<CollectionPendingInvitation> {
  const response = await request<CollectionPendingInvitation>({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/invitations`,
    body: { jupleId, role },
    headers: storedUnlockHeaders(collectionId),
  });
  if (!response.body) {
    throw new Error('Juple API returned no invitation body.');
  }
  return response.body;
}

export async function revokeCollectionInvitation(
  request: AuthenticatedApiRequest,
  collectionId: number,
  invitationId: number,
): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: `/api/v1/collections/${collectionId}/invitations/${invitationId}`,
    headers: storedUnlockHeaders(collectionId),
  });
}

/**
 * Owner only. Switches an accepted member between 읽기 and 쓰기 - effective on their next request.
 * Conflict "publicShareActive" when giving 쓰기 while the public link is on (nothing is switched off
 * automatically); notFound when they are no longer a member.
 */
export async function changeCollaboratorRole(
  request: AuthenticatedApiRequest,
  collectionId: number,
  jupleId: string,
  role: InvitationRole,
): Promise<void> {
  await request<void>({
    method: 'PUT',
    path: `/api/v1/collections/${collectionId}/collaborators/${encodeURIComponent(jupleId)}/role`,
    body: { role },
    headers: storedUnlockHeaders(collectionId),
  });
}

/**
 * Owner only. Changes what a still-pending invitation grants. Conflicts: "invitationNotPending"
 * (already answered/revoked/expired), "publicShareActive" (쓰기 while the public link is on).
 */
export async function changeInvitationRole(
  request: AuthenticatedApiRequest,
  collectionId: number,
  invitationId: number,
  role: InvitationRole,
): Promise<void> {
  await request<void>({
    method: 'PUT',
    path: `/api/v1/collections/${collectionId}/invitations/${invitationId}/role`,
    body: { role },
    headers: storedUnlockHeaders(collectionId),
  });
}

/** Owner only. Also removes exactly the links that person added to this Collection (their Items stay theirs). */
export async function removeCollaborator(
  request: AuthenticatedApiRequest,
  collectionId: number,
  jupleId: string,
): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: `/api/v1/collections/${collectionId}/collaborators/${encodeURIComponent(jupleId)}`,
    headers: storedUnlockHeaders(collectionId),
  });
}

/** A non-owner member leaves a Collection themselves (the server rejects the Owner). */
export async function leaveCollection(request: AuthenticatedApiRequest, collectionId: number): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: `/api/v1/collections/${collectionId}/collaborators/me`,
    headers: storedUnlockHeaders(collectionId),
  });
}

export async function getReceivedCollectionInvitations(
  request: AuthenticatedApiRequest,
): Promise<readonly ReceivedCollectionInvitation[]> {
  const response = await request<{ items: readonly ReceivedCollectionInvitation[] }>({
    method: 'GET',
    path: '/api/v1/users/me/collection-invitations',
  });
  return response.body?.items ?? [];
}

export async function acceptCollectionInvitation(request: AuthenticatedApiRequest, invitationId: number): Promise<void> {
  await request<void>({ method: 'POST', path: `/api/v1/collection-invitations/${invitationId}/accept` });
}

export async function declineCollectionInvitation(request: AuthenticatedApiRequest, invitationId: number): Promise<void> {
  await request<void>({ method: 'POST', path: `/api/v1/collection-invitations/${invitationId}/decline` });
}
