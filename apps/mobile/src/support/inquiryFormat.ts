import type { TFunction } from 'i18next';
import i18n from '../i18n';
import type { SupportInquiryStatus, SupportInquiryType } from './api/supportInquiryApi';

export const inquiryTypeLabel = (t: TFunction, type: SupportInquiryType): string => t(`inquiry.types.${type}`);

/** 접수 / 답변완료 - always spelled out, never a color alone. */
export const inquiryStatusLabel = (t: TFunction, status: SupportInquiryStatus): string =>
  t(status === 'Answered' ? 'inquiry.statusAnswered' : 'inquiry.statusPending');

/** The date and time in the app language's own conventions. */
export function formatInquiryDateTime(isoUtc: string): string {
  return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(isoUtc));
}
