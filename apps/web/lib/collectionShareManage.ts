import { ApiHttpError } from './appApi.ts';
import type { AppDictionary } from './appI18n.ts';
import type { CollectionParticipants, PublicSharePermission } from './collectionSharing.ts';

/**
 * Managing a Collection's sharing from the Web - the mobile CollectionShareScreen rules on the same API (nothing renamed):
 *
 *  - 공용 컬렉션: POST /share {permission[, raiseLowerRoles]} turns it ON (creating the link or keeping its URL), POST /share/private
 *    turns it OFF (the link stays, its contents stop being public), PUT /share/permission switches read | submit | write.
 *  - Roles (people AND invitations) are 'viewer' 읽기 전용 < 'submitter' 승인 후 추가 < 'contributor' 링크 추가. While the contents are
 *    public nobody may be below the link's level (write -> contributor, submit -> submitter; read -> any); the server answers a
 *    change that would break this with 409 publicSharePermissionMismatch, and `raiseLowerRoles` is its single-transaction raise.
 *  - PUT /collaborators/{jupleId}/role, PUT /invitations/{id}/role, DELETE /collaborators/{jupleId}, DELETE /invitations/{id}.
 *  - 접근 비밀번호: GET / PUT / DELETE /share-password, POST /share-password/reveal (Owner only; the password is never listed).
 */

export type InvitationRole = 'viewer' | 'submitter' | 'contributor';

/** The three levels in rank order, as the Owner chooses them. */
export const ROLES: readonly InvitationRole[] = ['viewer', 'submitter', 'contributor'];
export const INVITATION_ROLE_RANK: Readonly<Record<InvitationRole, number>> = { viewer: 0, submitter: 1, contributor: 2 };
export const PUBLIC_PERMISSIONS: readonly PublicSharePermission[] = ['read', 'submit', 'write'];

/** A wire role ("Contributor" / "viewer" / ...) as an InvitationRole. */
export function invitationRoleOf(role: string): InvitationRole {
  const normalized = role.toLowerCase();
  return normalized === 'viewer' ? 'viewer' : normalized === 'submitter' ? 'submitter' : 'contributor';
}

export function minimumRoleForPublicPermission(permission: PublicSharePermission): InvitationRole | null {
  return permission === 'write' ? 'contributor' : permission === 'submit' ? 'submitter' : null;
}

export function raiseToMinimum(role: InvitationRole, minimum: InvitationRole | null): InvitationRole {
  return minimum !== null && INVITATION_ROLE_RANK[role] < INVITATION_ROLE_RANK[minimum] ? minimum : role;
}

/** How many people (members and still-pending invitations) are below this permission's minimum. */
export function countBelowMinimum(participants: CollectionParticipants | null, permission: PublicSharePermission): number {
  const minimum = minimumRoleForPublicPermission(permission);
  if (minimum === null || participants === null) {
    return 0;
  }
  const below = (role: string) => INVITATION_ROLE_RANK[invitationRoleOf(role)] < INVITATION_ROLE_RANK[minimum];
  return participants.participants.filter(person => person.role !== 'owner' && below(person.role)).length + participants.pendingInvitations.filter(invitation => below(invitation.role)).length;
}

export function roleOptionLabel(role: InvitationRole, dictionary: AppDictionary): string {
  return role === 'viewer' ? dictionary.sharePermissionRead : role === 'submitter' ? dictionary.sharePermissionSubmit : dictionary.sharePermissionWrite;
}

export function publicPermissionDescription(permission: PublicSharePermission, dictionary: AppDictionary): string {
  return permission === 'write' ? dictionary.sharePublicWriteDescription : permission === 'submit' ? dictionary.sharePublicSubmitDescription : dictionary.sharePublicReadDescription;
}

// ---- paths -----------------------------------------------------------------------------------------------------------------

export const sharePaths = {
  share: (collectionId: number) => `/api/v1/collections/${collectionId}/share`,
  makePrivate: (collectionId: number) => `/api/v1/collections/${collectionId}/share/private`,
  permission: (collectionId: number) => `/api/v1/collections/${collectionId}/share/permission`,
  collaboratorRole: (collectionId: number, jupleId: string) => `/api/v1/collections/${collectionId}/collaborators/${encodeURIComponent(jupleId)}/role`,
  collaborator: (collectionId: number, jupleId: string) => `/api/v1/collections/${collectionId}/collaborators/${encodeURIComponent(jupleId)}`,
  invitation: (collectionId: number, invitationId: number) => `/api/v1/collections/${collectionId}/invitations/${invitationId}`,
  invitationRole: (collectionId: number, invitationId: number) => `/api/v1/collections/${collectionId}/invitations/${invitationId}/role`,
  password: (collectionId: number) => `/api/v1/collections/${collectionId}/share-password`,
  revealPassword: (collectionId: number) => `/api/v1/collections/${collectionId}/share-password/reveal`,
} as const;

/** The body of an enable / permission change: the permission, plus the single-transaction raise only once the Owner agreed. */
export function permissionBody(permission: PublicSharePermission, raiseLowerRoles: boolean): { readonly permission: PublicSharePermission; readonly raiseLowerRoles?: true } {
  return raiseLowerRoles ? { permission, raiseLowerRoles: true } : { permission };
}

export function isPermissionMismatch(error: unknown): boolean {
  return error instanceof ApiHttpError && error.status === 409 && error.code === 'publicSharePermissionMismatch';
}

// ---- access password -------------------------------------------------------------------------------------------------------

export type SharePasswordMode = 'none' | 'legacyCommonLock' | 'perCollection';

export interface SharePasswordStatus {
  readonly mode: SharePasswordMode;
  readonly isEnabled: boolean;
  readonly updatedAtUtc: string | null;
}

/** Mirrors the server's CollectionSharePasswordPolicy: 4-64 characters, no control characters, no surrounding spaces. */
export const SHARE_PASSWORD_MIN_LENGTH = 4;
export const SHARE_PASSWORD_MAX_LENGTH = 64;

export function isValidSharePassword(value: string): boolean {
  const length = Array.from(value).length;
  return value === value.trim() && length >= SHARE_PASSWORD_MIN_LENGTH && length <= SHARE_PASSWORD_MAX_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);
}

/** The body: the password once, the same value as the confirmation (the contract has both; the Owner types it once in plain view). */
export function sharePasswordBody(password: string): { readonly password: string; readonly confirmPassword: string } {
  return { password, confirmPassword: password };
}

// ---- errors ----------------------------------------------------------------------------------------------------------------

/** Mobile getActionErrorMessage: invites, role changes, removals, cancellations. */
export function shareActionErrorMessage(error: unknown, dictionary: AppDictionary): string {
  if (error instanceof ApiHttpError) {
    if (error.status === 403 && (error.code === 'collectionLocked' || error.code === 'sharePasswordRequired')) {
      return dictionary.lockRequiredForAction;
    }
    if (error.status === 409) {
      switch (error.code) {
        case 'alreadyCollaborator':
          return dictionary.inviteAlreadyCollaborator;
        case 'invitationPending':
          return dictionary.inviteAlreadyPending;
        case 'publicShareActive':
          return dictionary.belowPublicPermission;
        case 'invitationNotPending':
          return dictionary.invitationNoLongerValid;
        case 'sharePasswordMigrationRequired':
          return dictionary.accessPasswordLegacyNotice;
      }
    }
    if (error.status === 400) {
      return dictionary.inviteSelf;
    }
    if (error.status === 429) {
      return dictionary.collaborationTooManyRequests;
    }
  }
  return dictionary.collaborationActionFallback;
}

/** Mobile getShareManagementErrorMessage: turning the public link on / off and its permission. */
export function shareManagementErrorMessage(error: unknown, dictionary: AppDictionary, attempted: PublicSharePermission | null): string {
  if (error instanceof ApiHttpError) {
    if (error.status === 403 && (error.code === 'collectionLocked' || error.code === 'sharePasswordRequired')) {
      return dictionary.lockRequiredForAction;
    }
    if (isPermissionMismatch(error) && attempted === 'write') {
      return dictionary.permissionMismatch;
    }
    if (error.status === 409 && error.code === 'sharePasswordMigrationRequired') {
      return dictionary.accessPasswordLegacyNotice;
    }
  }
  return dictionary.shareManagementFallback;
}

export function sharePasswordErrorMessage(error: unknown, dictionary: AppDictionary): string {
  if (error instanceof ApiHttpError) {
    if (error.status === 409 && error.code === 'sharePasswordUnreadable') {
      return dictionary.accessPasswordUnreadable;
    }
    if (error.status === 403 && (error.code === 'collectionLocked' || error.code === 'sharePasswordRequired')) {
      return dictionary.lockRequiredForAction;
    }
  }
  return dictionary.accessPasswordFallback;
}
