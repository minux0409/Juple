import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/authenticatedApiClient';

/**
 * Safety (Google Play UGC policy): the Terms of Service agreement, reporting and blocking. The server decides everything - who may
 * report what, what a block stops, whether the Terms were accepted; this module only builds the requests and reads the answers.
 */

export const TERMS_REQUIRED_CODE = 'termsAcceptanceRequired';
export const USER_BLOCKED_CODE = 'userBlocked';
export const INTERACTION_NOT_ALLOWED_CODE = 'interactionNotAllowed';

export interface TermsStatus {
  readonly currentVersion: string;
  readonly acceptedVersion: string | null;
  readonly isAccepted: boolean;
}

export function parseTermsStatus(raw: unknown): TermsStatus | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as { currentVersion?: unknown; acceptedVersion?: unknown; isAccepted?: unknown };
  if (typeof value.currentVersion !== 'string' || value.currentVersion.length === 0 || typeof value.isAccepted !== 'boolean') {
    return null;
  }
  return {
    currentVersion: value.currentVersion,
    acceptedVersion: typeof value.acceptedVersion === 'string' ? value.acceptedVersion : null,
    isAccepted: value.isAccepted,
  };
}

export async function getTermsStatus(request: AuthenticatedApiRequest): Promise<TermsStatus | null> {
  const response = await request<unknown>({ method: 'GET', path: '/api/v1/users/me/terms' });
  return parseTermsStatus(response.body);
}

export async function acceptTerms(request: AuthenticatedApiRequest, version: string): Promise<TermsStatus> {
  const response = await request<unknown>({ method: 'POST', path: '/api/v1/users/me/terms-acceptance', body: { version, isAtLeast14: true } });
  const status = parseTermsStatus(response.body);
  if (!status || (status.isAccepted && status.acceptedVersion !== status.currentVersion)) {
    throw new ApiError('unavailable');
  }
  return status;
}

/** Whether a failure is the server asking for the current Terms first. */
export function isTermsRequiredError(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'forbidden' && error.code === TERMS_REQUIRED_CODE;
}

// ---- reporting ----

export const REPORT_REASONS = ['Spam', 'Harassment', 'HateOrAbuse', 'SexualOrInappropriate', 'Illegal', 'ScamOrMaliciousLink', 'IntellectualProperty', 'Other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_DETAILS_MAX_LENGTH = 1000;

export type ReportTarget =
  | { readonly type: 'User'; readonly jupleId: string }
  | { readonly type: 'Collection'; readonly collectionId: number }
  | { readonly type: 'Item'; readonly itemId: number; readonly collectionId: number }
  | { readonly type: 'Comment'; readonly commentId: number };

export function reportBody(target: ReportTarget, reason: ReportReason, details: string): Record<string, unknown> {
  const trimmed = details.trim();
  const base = { reason, ...(trimmed ? { details: trimmed } : {}) };
  switch (target.type) {
    case 'User':
      return { targetType: 'User', targetId: target.jupleId, ...base };
    case 'Collection':
      return { targetType: 'Collection', targetId: String(target.collectionId), ...base };
    case 'Item':
      return { targetType: 'Item', targetId: String(target.itemId), collectionId: target.collectionId, ...base };
    case 'Comment':
      return { targetType: 'Comment', targetId: String(target.commentId), ...base };
  }
}

/** 201 = received; 200 = this person already has an open report of the same thing. */
export async function submitReport(
  request: AuthenticatedApiRequest,
  target: ReportTarget,
  reason: ReportReason,
  details: string,
): Promise<{ readonly alreadyReported: boolean }> {
  const response = await request<{ alreadyReported?: boolean }>({ method: 'POST', path: '/api/v1/reports', body: reportBody(target, reason, details) });
  return { alreadyReported: response.body?.alreadyReported === true };
}

// ---- blocking ----

export interface BlockedUser {
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly blockedAtUtc: string;
  readonly profileImageUrl: string | null;
  readonly profileImageVersion: string | null;
}

const blockPath = (jupleId: string) => `/api/v1/users/${encodeURIComponent(jupleId)}/block`;

export async function blockUser(request: AuthenticatedApiRequest, jupleId: string): Promise<void> {
  await request<void>({ method: 'POST', path: blockPath(jupleId) });
}

export async function unblockUser(request: AuthenticatedApiRequest, jupleId: string): Promise<void> {
  await request<void>({ method: 'DELETE', path: blockPath(jupleId) });
}

export function parseBlockedUsers(raw: unknown): readonly BlockedUser[] {
  const items = raw && typeof raw === 'object' ? (raw as { items?: unknown }).items : null;
  if (!Array.isArray(items)) {
    return [];
  }
  const result: BlockedUser[] = [];
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const value = entry as Record<string, unknown>;
    if (typeof value.jupleId !== 'string' || value.jupleId.length === 0) {
      continue;
    }
    result.push({
      jupleId: value.jupleId,
      displayName: typeof value.displayName === 'string' && value.displayName.trim() ? value.displayName : null,
      blockedAtUtc: typeof value.blockedAtUtc === 'string' ? value.blockedAtUtc : '',
      profileImageUrl: typeof value.profileImageUrl === 'string' ? value.profileImageUrl : null,
      profileImageVersion: typeof value.profileImageVersion === 'string' ? value.profileImageVersion : null,
    });
  }
  return result;
}

export async function listBlockedUsers(request: AuthenticatedApiRequest): Promise<readonly BlockedUser[]> {
  const response = await request<unknown>({ method: 'GET', path: '/api/v1/users/me/blocked-users' });
  return parseBlockedUsers(response.body);
}

/** The words for an interaction the server refused because of a block - null when the failure is something else. */
export function blockedInteractionKey(error: unknown): 'safety.userBlockedByYou' | 'safety.interactionNotAllowed' | null {
  if (!(error instanceof ApiError) || error.kind !== 'forbidden') {
    return null;
  }
  if (error.code === USER_BLOCKED_CODE) {
    return 'safety.userBlockedByYou';
  }
  return error.code === INTERACTION_NOT_ALLOWED_CODE ? 'safety.interactionNotAllowed' : null;
}
