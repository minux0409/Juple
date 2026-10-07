import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';

/**
 * The stable codes the Backend stores (never localized text). The app only translates them for display.
 * Order is the order of the type picker.
 */
export const SUPPORT_INQUIRY_TYPES = ['Account', 'Subscription', 'LinkSaving', 'CollectionSharing', 'Bug', 'FeatureRequest', 'Other'] as const;
export type SupportInquiryType = (typeof SUPPORT_INQUIRY_TYPES)[number];
export type SupportInquiryStatus = 'Pending' | 'Answered';

/** Mirrors the Backend's SupportInquiryService.MaxContentLength. */
export const SUPPORT_INQUIRY_MAX_LENGTH = 4000;

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

/** Only app and device facts - never an identity, a link, a memo or a Collection name (see getSupportDiagnostics). */
export interface SupportInquiryDiagnostics {
  readonly appVersion: string;
  readonly buildNumber: string;
  readonly platform: string;
  readonly osVersion: string;
  readonly deviceModel: string;
  readonly locale: string;
}

export interface CreateSupportInquiryBody {
  /** The same value for a retry of the same submission, so a flaky network never creates a duplicate. */
  readonly clientRequestId: string;
  readonly type: SupportInquiryType;
  readonly content: string;
  readonly diagnostics: SupportInquiryDiagnostics;
}

export async function createSupportInquiry(request: AuthenticatedApiRequest, body: CreateSupportInquiryBody): Promise<SupportInquiry> {
  const response = await request<SupportInquiry>({ method: 'POST', path: '/api/v1/support/inquiries', body });
  return response.body as SupportInquiry;
}

/** Newest first; pass the previous page's nextCursor for the next one. */
export async function getSupportInquiries(
  request: AuthenticatedApiRequest,
  options: { readonly cursor?: string | null; readonly limit?: number } = {},
): Promise<SupportInquiryPage> {
  const query = new URLSearchParams();
  if (options.cursor) {
    query.set('cursor', options.cursor);
  }
  if (options.limit !== undefined) {
    query.set('limit', String(options.limit));
  }
  const queryString = query.toString();
  const response = await request<SupportInquiryPage>({
    method: 'GET',
    path: `/api/v1/support/inquiries${queryString ? `?${queryString}` : ''}`,
  });
  return response.body as SupportInquiryPage;
}

export async function getSupportInquiry(request: AuthenticatedApiRequest, inquiryId: number): Promise<SupportInquiry> {
  const response = await request<SupportInquiry>({ method: 'GET', path: `/api/v1/support/inquiries/${inquiryId}` });
  return response.body as SupportInquiry;
}
