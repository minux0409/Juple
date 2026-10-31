import { ApiHttpError } from './appApi.ts';
import type { AppDictionary } from './appI18n.ts';

/**
 * Safety on the Web: Terms of Service acceptance, reporting and blocking - the mobile app's flows on the SAME endpoints, the SAME reason
 * list and the SAME texts (apps/mobile/src/safety). The server decides everything (who may report what, what a block stops); this file
 * only builds requests and reads answers. Plain text only: nothing here is ever rendered as markup.
 */

export const TERMS_REQUIRED_CODE = 'termsAcceptanceRequired';
export const USER_BLOCKED_CODE = 'userBlocked';
export const INTERACTION_NOT_ALLOWED_CODE = 'interactionNotAllowed';

export const TERMS_ACCEPTANCE_PATH = '/api/v1/users/me/terms-acceptance';
export const REPORTS_PATH = '/api/v1/reports';
export const BLOCKED_USERS_PATH = '/api/v1/users/me/blocked-users';

/** The Terms the server asks for (from the bootstrap) and whether this person accepted them. */
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
  return { currentVersion: value.currentVersion, acceptedVersion: typeof value.acceptedVersion === 'string' ? value.acceptedVersion : null, isAccepted: value.isAccepted };
}

/** Whether an API failure is the server saying "accept the current Terms first". */
export function isTermsRequired(error: unknown): boolean {
  return error instanceof ApiHttpError && error.status === 403 && error.code === TERMS_REQUIRED_CODE;
}

// ---- reporting ----

/** The server's reasons, in the order they are shown. The values are the API's names - the words come from the dictionary. */
export const REPORT_REASONS = ['Spam', 'SexualOrInappropriate', 'Harassment', 'IntellectualProperty', 'Other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_DETAILS_MAX_LENGTH = 1000;

/** What can be reported. A person is named by their Juple ID, everything else by its id; a link is reported through a Collection that holds it. */
export type ReportTarget =
  | { readonly type: 'User'; readonly jupleId: string }
  | { readonly type: 'Collection'; readonly collectionId: number }
  | { readonly type: 'Item'; readonly itemId: number; readonly collectionId: number }
  | { readonly type: 'Comment'; readonly commentId: number }
  // A public link seen by someone who is not a member: the link is all they hold, and it stands for its Collection.
  | { readonly type: 'PublicShare'; readonly publicId: string };

export function reportPath(target: ReportTarget): string {
  return target.type === 'PublicShare' ? `/api/v1/public-shares/${encodeURIComponent(target.publicId)}/reports` : REPORTS_PATH;
}

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
    case 'PublicShare':
      return base;
  }
}

export function reportReasonLabel(reason: ReportReason, dictionary: AppDictionary): string {
  switch (reason) {
    case 'Spam':
      return dictionary.safetyReasonSpam;
    case 'Harassment':
      return dictionary.safetyReasonHarassment;
    case 'SexualOrInappropriate':
      return dictionary.safetyReasonSexualOrInappropriate;
    case 'IntellectualProperty':
      return dictionary.safetyReasonIntellectualProperty;
    case 'Other':
      return dictionary.safetyReasonOther;
  }
}

/** 201 = received, 200 = this person already has an open report of the same thing. */
export function parseReportReceipt(raw: unknown): { readonly alreadyReported: boolean } {
  return { alreadyReported: typeof raw === 'object' && raw !== null && (raw as { alreadyReported?: unknown }).alreadyReported === true };
}

/** A failed report is only ever "could not send": ids, visibility and blocks are never explained to the reporter. */
export function reportErrorMessage(dictionary: AppDictionary): string {
  return dictionary.safetyReportFailed;
}

// ---- blocking ----

export interface BlockedUser {
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly blockedAtUtc: string;
  readonly profileImageUrl: string | null;
  /** Collections I am a member of that this person owns: out of my lists because of the block, still mine to open or leave. */
  readonly hiddenCollections: readonly { readonly id: number; readonly name: string }[];
}

function parseHiddenCollections(raw: unknown): BlockedUser['hiddenCollections'] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap(entry => {
    const value = (entry ?? {}) as { id?: unknown; name?: unknown };
    return typeof value.id === 'number' && typeof value.name === 'string' ? [{ id: value.id, name: value.name }] : [];
  });
}

export function blockPath(jupleId: string): string {
  return `/api/v1/users/${encodeURIComponent(jupleId)}/block`;
}

export function parseBlockedUsers(raw: unknown): readonly BlockedUser[] {
  const items = typeof raw === 'object' && raw !== null ? (raw as { items?: unknown }).items : null;
  if (!Array.isArray(items)) {
    return [];
  }
  const result: BlockedUser[] = [];
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const value = entry as { jupleId?: unknown; displayName?: unknown; blockedAtUtc?: unknown; profileImageUrl?: unknown; hiddenCollections?: unknown };
    if (typeof value.jupleId !== 'string' || value.jupleId.length === 0) {
      continue;
    }
    result.push({
      jupleId: value.jupleId,
      displayName: typeof value.displayName === 'string' && value.displayName.trim() ? value.displayName : null,
      blockedAtUtc: typeof value.blockedAtUtc === 'string' ? value.blockedAtUtc : '',
      profileImageUrl: typeof value.profileImageUrl === 'string' ? value.profileImageUrl : null,
      hiddenCollections: parseHiddenCollections(value.hiddenCollections),
    });
  }
  return result;
}

/** The message for an interaction the server refused because of a block (null when the failure is something else). */
export function blockedInteractionMessage(error: unknown, dictionary: AppDictionary): string | null {
  if (!(error instanceof ApiHttpError) || error.status !== 403) {
    return null;
  }
  if (error.code === USER_BLOCKED_CODE) {
    return dictionary.safetyUserBlockedByYou;
  }
  return error.code === INTERACTION_NOT_ALLOWED_CODE ? dictionary.safetyInteractionNotAllowed : null;
}
