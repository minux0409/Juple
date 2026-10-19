import { AdminForbiddenError, AuthExpiredError, ApiHttpError, ApiNetworkError } from './adminApi.ts';
import { strings } from './strings.ts';

// ---- API shapes (the JSON of /api/v1/admin/*, camelCase) ------------------------------------------------------------------------

export type AdminRole = 'Owner' | 'Admin';

export interface AdminMe {
  readonly userId: number;
  readonly role: AdminRole;
}

export interface DashboardSummary {
  readonly todayStartUtc: string;
  readonly generatedAtUtc: string;
  readonly totalUsers: number;
  readonly newUsersToday: number;
  readonly newUsersLast7Days: number;
  readonly totalLinks: number;
  readonly linksSavedToday: number;
  readonly totalCollections: number;
  readonly sharedCollections: number;
  readonly openInquiries: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface AdminUserRow {
  readonly userId: number;
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly createdAtUtc: string;
  readonly preferredLocale: string;
  readonly termsAccepted: boolean;
  readonly linkCount: number;
  readonly collectionCount: number;
}

export type InquiryStatus = 'Pending' | 'InProgress' | 'Answered';

export interface InquiryPerson {
  readonly userId: number;
  readonly jupleId: string;
  readonly displayName: string | null;
}

export interface InquiryRow {
  readonly inquiryId: number;
  readonly status: string;
  readonly type: string;
  readonly user: InquiryPerson | null;
  readonly contentPreview: string;
  readonly platform: string | null;
  readonly createdAtUtc: string;
  readonly updatedAtUtc: string | null;
  readonly answeredAtUtc: string | null;
}

export interface InquiryDetail {
  readonly inquiryId: number;
  readonly status: string;
  readonly type: string;
  readonly user: InquiryPerson | null;
  readonly content: string;
  readonly answer: string | null;
  readonly createdAtUtc: string;
  readonly updatedAtUtc: string | null;
  readonly answeredAtUtc: string | null;
  readonly diagnostics: {
    readonly appVersion: string | null;
    readonly buildNumber: string | null;
    readonly platform: string | null;
    readonly osVersion: string | null;
    readonly deviceModel: string | null;
    readonly locale: string | null;
  };
  readonly history: readonly {
    readonly adminUserId: number;
    readonly adminJupleId: string | null;
    readonly action: string;
    readonly detail: string | null;
    readonly createdAtUtc: string;
  }[];
}

export interface AppVersionPolicy {
  readonly platform: string;
  readonly enabled: boolean;
  readonly latestBuild: number;
  readonly minimumSupportedBuild: number;
  readonly storeUrl: string | null;
}

export interface AppVersionResponse {
  readonly android: AppVersionPolicy;
  readonly ios: AppVersionPolicy;
}

export interface SystemResponse {
  readonly environment: string;
  readonly apiVersion: string | null;
  readonly serverTimeUtc: string;
}

// ---- paths -------------------------------------------------------------------------------------------------------------------

/** The admin's own local midnight, as an instant - "today" on the dashboard is the operator's day, not the server's. */
export function localTodayStartUtc(now: Date): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

function query(values: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const adminPaths = {
  me: '/api/v1/admin/me',
  dashboard: (todayStartUtc: string) => `/api/v1/admin/dashboard/summary${query({ todayStartUtc })}`,
  users: (jupleId: string | null, cursor: string | null) => `/api/v1/admin/users${query({ jupleId, cursor })}`,
  inquiries: (status: InquiryStatus | null, cursor: string | null) => `/api/v1/admin/support/inquiries${query({ status, cursor })}`,
  inquiry: (id: number) => `/api/v1/admin/support/inquiries/${encodeURIComponent(String(id))}`,
  inquiryStatus: (id: number) => `/api/v1/admin/support/inquiries/${encodeURIComponent(String(id))}/status`,
  inquiryAnswer: (id: number) => `/api/v1/admin/support/inquiries/${encodeURIComponent(String(id))}/answer`,
  appVersion: '/api/v1/admin/operations/app-version',
  system: '/api/v1/admin/operations/system',
} as const;

// ---- inquiries ---------------------------------------------------------------------------------------------------------------

/** The list filter tabs: 전체 / 접수 / 처리중 / 답변완료. */
export const INQUIRY_FILTERS: readonly { readonly status: InquiryStatus | null; readonly label: string }[] = [
  { status: null, label: strings.filterAll },
  { status: 'Pending', label: strings.statusPending },
  { status: 'InProgress', label: strings.statusInProgress },
  { status: 'Answered', label: strings.statusAnswered },
];

export function parseInquiryFilter(value: string | null): InquiryStatus | null {
  return value === 'Pending' || value === 'InProgress' || value === 'Answered' ? value : null;
}

export function inquiryStatusLabel(status: string): string {
  switch (status) {
    case 'Pending':
      return strings.statusPending;
    case 'InProgress':
      return strings.statusInProgress;
    case 'Answered':
      return strings.statusAnswered;
    default:
      return status;
  }
}

const INQUIRY_TYPE_LABELS: Readonly<Record<string, string>> = {
  Account: '계정',
  Subscription: '구독',
  LinkSaving: '링크 저장',
  CollectionSharing: '컬렉션 공유',
  Bug: '오류 신고',
  FeatureRequest: '기능 제안',
  Other: '기타',
};

export function inquiryTypeLabel(type: string): string {
  return INQUIRY_TYPE_LABELS[type] ?? type;
}

/** The status the admin may set by hand: 접수 <-> 처리중 while unanswered. 답변완료 comes only from an answer; it never goes back. */
export function manualStatusTargets(status: string): readonly InquiryStatus[] {
  switch (status) {
    case 'Pending':
      return ['InProgress'];
    case 'InProgress':
      return ['Pending'];
    default:
      return [];
  }
}

export const MAX_ANSWER_LENGTH = 8000;

/** Mirrors the API's answer rule (trimmed, 1..8000); the API stays the authority. */
export function validateAnswer(text: string): 'empty' | 'tooLong' | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return 'empty';
  }
  return trimmed.length > MAX_ANSWER_LENGTH ? 'tooLong' : null;
}

const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  'support.inquiry.status_changed': '상태 변경',
  'support.inquiry.answered': '답변 저장',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

// ---- display -----------------------------------------------------------------------------------------------------------------

/** "@K7MP-4Q8N" - how the apps show a Juple ID. */
export function displayJupleId(code: string): string {
  return code.length === 8 ? `@${code.slice(0, 4)}-${code.slice(4)}` : `@${code}`;
}

/** An instant in the browser's own locale and time zone (nothing is hard-coded). */
export function formatInstant(value: string | null | undefined, locale?: string): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatCount(value: number, locale?: string): string {
  return value.toLocaleString(locale);
}

/** One message per failure kind - never the raw error, which could carry request details. */
export function failureMessage(error: unknown): string {
  if (error instanceof AdminForbiddenError) {
    return strings.forbidden;
  }
  if (error instanceof AuthExpiredError) {
    return strings.sessionExpired;
  }
  if (error instanceof ApiNetworkError) {
    return strings.networkError;
  }
  if (error instanceof ApiHttpError) {
    if (error.status === 404) {
      return strings.notFound;
    }
    if (error.status === 400 && error.validationMessage) {
      return `${strings.invalidRequest} (${error.validationMessage})`;
    }
    return `${strings.serverError} (${error.status})`;
  }
  return strings.unknownError;
}
