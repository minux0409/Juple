/**
 * The ONE place the operator's legal details enter the public legal pages (/privacy, /terms, /account-deletion).
 *
 * Operator name, business number, address and effective date are OPTIONAL and come only from runtime environment variables. Nothing
 * is invented: the business registration is still being processed, so until a value is explicitly configured the field is simply
 * absent and the pages leave that line out. The one confirmed value is the contact mailbox (CONFIRMED_CONTACT_EMAIL).
 *
 * Plain runtime variables (not NEXT_PUBLIC_), read per request like lib/storeConfig.ts, so one image serves every environment.
 */
export interface LegalOperatorConfig {
  readonly serviceName: string;
  readonly operatorName?: string;
  readonly businessRegistrationNumber?: string;
  readonly businessAddress?: string;
  readonly supportEmail?: string;
  readonly privacyEmail?: string;
  /** The date the published terms/policy take effect; shown only when configured (YYYY-MM-DD). */
  readonly effectiveDate?: string;
}

/** When the wording of the pages was last changed. Update it together with lib/legalContent.ts. */
export const LEGAL_CONTENT_UPDATED = '2026-10-10';

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** The confirmed public contact mailbox (support and privacy requests). `LEGAL_SUPPORT_EMAIL` / `LEGAL_PRIVACY_EMAIL` override it per environment. */
export const CONFIRMED_CONTACT_EMAIL = 'jupleinfo@gmail.com';

// A mailbox is shown (and linked) only if it looks like one; anything else is treated as not configured.
const EMAIL_PATTERN = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function readLegalOperatorConfig(env: Readonly<Record<string, string | undefined>> = process.env): LegalOperatorConfig {
  const email = (name: string) => {
    const value = clean(env[name]) ?? CONFIRMED_CONTACT_EMAIL;
    return EMAIL_PATTERN.test(value) ? value : CONFIRMED_CONTACT_EMAIL;
  };
  const date = clean(env.LEGAL_EFFECTIVE_DATE);

  return {
    serviceName: 'Juple',
    operatorName: clean(env.LEGAL_OPERATOR_NAME),
    businessRegistrationNumber: clean(env.LEGAL_BUSINESS_REGISTRATION_NUMBER),
    businessAddress: clean(env.LEGAL_BUSINESS_ADDRESS),
    supportEmail: email('LEGAL_SUPPORT_EMAIL'),
    privacyEmail: email('LEGAL_PRIVACY_EMAIL'),
    effectiveDate: date && DATE_PATTERN.test(date) ? date : undefined,
  };
}

/** "2026-10-10" -> "2026년 10월 10일" (the pages are Korean). */
export function formatLegalDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
}
