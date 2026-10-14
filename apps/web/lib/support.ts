import type { AppDictionary } from './appI18n.ts';
import { ApiHttpError } from './appApi.ts';

/**
 * 고객센터 > 문의하기 on the Web: the mobile app's own inquiry feature (SupportInquiryScreen / SupportInquiryDetailScreen) over the very same
 * endpoints - nothing new on the server. The owner of an inquiry is always the signed-in user (the server decides; the request carries no
 * user id) and anyone else's inquiry id is a plain 404. There is no title and no attachment (the mobile form has none): a type and the text.
 */

/** The stable codes the server stores (never localized text), in the order of the type picker - the mobile SUPPORT_INQUIRY_TYPES. */
export const SUPPORT_INQUIRY_TYPES = ['Account', 'Subscription', 'LinkSaving', 'CollectionSharing', 'Bug', 'FeatureRequest', 'Other'] as const;
export type SupportInquiryType = (typeof SUPPORT_INQUIRY_TYPES)[number];
export type SupportInquiryStatus = 'Pending' | 'Answered';

/** The server's SupportInquiryService.MaxContentLength. */
export const SUPPORT_INQUIRY_MAX_LENGTH = 4000;
export const SUPPORT_INQUIRY_PAGE_SIZE = 20;

export interface SupportInquiry {
  readonly inquiryId: number;
  readonly type: SupportInquiryType;
  readonly status: SupportInquiryStatus;
  readonly content: string;
  readonly createdAtUtc: string;
  readonly answer: string | null;
  readonly answeredAtUtc: string | null;
}

export interface SupportInquiryPage {
  readonly items: readonly SupportInquiry[];
  readonly nextCursor: string | null;
}

export const SUPPORT_INQUIRIES_PATH = '/api/v1/support/inquiries';

export function inquiryListPath(cursor: string | null, limit: number = SUPPORT_INQUIRY_PAGE_SIZE): string {
  const query = new URLSearchParams();
  if (cursor) {
    query.set('cursor', cursor);
  }
  query.set('limit', String(limit));
  return `${SUPPORT_INQUIRIES_PATH}?${query.toString()}`;
}

export function inquiryPath(inquiryId: number): string {
  return `${SUPPORT_INQUIRIES_PATH}/${inquiryId}`;
}

/** The page address of one inquiry; null for anything that is not a plain positive integer (never a path built from free text). */
export function parseInquiryId(value: string | null | undefined): number | null {
  if (!value || !/^[1-9]\d{0,17}$/.test(value)) {
    return null;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function isSupportInquiryType(value: unknown): value is SupportInquiryType {
  return typeof value === 'string' && (SUPPORT_INQUIRY_TYPES as readonly string[]).includes(value);
}

/** Only app/browser facts - never an identity, a link, a memo or a Collection name (the server also trims and caps each value). */
export function inquiryDiagnostics(locale: string | undefined): { readonly platform: string; readonly locale: string | null } {
  return { platform: 'web', locale: locale?.trim() || null };
}

export function inquiryTypeLabel(type: SupportInquiryType, dictionary: AppDictionary): string {
  switch (type) {
    case 'Account':
      return dictionary.inquiryTypeAccount;
    case 'Subscription':
      return dictionary.inquiryTypeSubscription;
    case 'LinkSaving':
      return dictionary.inquiryTypeLinkSaving;
    case 'CollectionSharing':
      return dictionary.inquiryTypeCollectionSharing;
    case 'Bug':
      return dictionary.inquiryTypeBug;
    case 'FeatureRequest':
      return dictionary.inquiryTypeFeatureRequest;
    case 'Other':
      return dictionary.inquiryTypeOther;
  }
}

/** 접수 / 답변 완료 - always spelled out, never a colour alone. */
export function inquiryStatusLabel(status: SupportInquiryStatus, dictionary: AppDictionary): string {
  return status === 'Answered' ? dictionary.inquiryStatusAnswered : dictionary.inquiryStatusPending;
}

/** A 문의 can be sent when a type is chosen and the text is not blank - the mobile rule; nothing while a send is on its way. */
export function canSubmitInquiry(type: SupportInquiryType | null, content: string, submitting: boolean): boolean {
  return !submitting && type !== null && content.trim().length > 0 && content.length <= SUPPORT_INQUIRY_MAX_LENGTH;
}

/**
 * The same request id for a retry of the same submission (the server answers a repeat with the first inquiry instead of creating another);
 * a changed type or text is a new submission.
 */
export function submissionAttempt(
  previous: { readonly id: string; readonly type: SupportInquiryType; readonly content: string } | null,
  type: SupportInquiryType,
  trimmedContent: string,
  newId: () => string,
): { readonly id: string; readonly type: SupportInquiryType; readonly content: string } {
  return previous && previous.type === type && previous.content === trimmedContent ? previous : { id: newId(), type, content: trimmedContent };
}

/** The first line(s) of an inquiry for the list row: one line of text, cut at a word-ish length. */
export function inquiryPreview(content: string, maxLength = 90): string {
  const oneLine = content.replace(/\s+/g, ' ').trim();
  return oneLine.length > maxLength ? `${oneLine.slice(0, maxLength).trimEnd()}…` : oneLine;
}

/** The date and time in the language's own conventions (mobile formatInquiryDateTime). */
export function formatInquiryDateTime(isoUtc: string, locale: string): string {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
}

/** A read of one inquiry that found nothing: someone else's id is indistinguishable from a missing one (404), by the server's design. */
export function isInquiryNotFound(error: unknown): boolean {
  return error instanceof ApiHttpError && error.status === 404;
}

/** Reads a page defensively: a malformed row is dropped rather than rendered. */
export function parseInquiryPage(raw: unknown): SupportInquiryPage {
  const body = (raw ?? {}) as { items?: unknown; nextCursor?: unknown };
  const items = Array.isArray(body.items) ? body.items.map(parseInquiry).filter((entry): entry is SupportInquiry => entry !== null) : [];
  return { items, nextCursor: typeof body.nextCursor === 'string' && body.nextCursor.length > 0 ? body.nextCursor : null };
}

export function parseInquiry(raw: unknown): SupportInquiry | null {
  const row = (raw ?? {}) as Record<string, unknown>;
  if (
    typeof row.inquiryId !== 'number' ||
    !isSupportInquiryType(row.type) ||
    (row.status !== 'Pending' && row.status !== 'Answered') ||
    typeof row.content !== 'string' ||
    typeof row.createdAtUtc !== 'string'
  ) {
    return null;
  }
  return {
    inquiryId: row.inquiryId,
    type: row.type,
    status: row.status,
    content: row.content,
    createdAtUtc: row.createdAtUtc,
    answer: typeof row.answer === 'string' ? row.answer : null,
    answeredAtUtc: typeof row.answeredAtUtc === 'string' ? row.answeredAtUtc : null,
  };
}
