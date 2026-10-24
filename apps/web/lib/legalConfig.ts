/**
 * The ONE place the operator's legal details enter the public legal pages (/privacy, /terms, /account-deletion).
 *
 * The operator's own details (name, representative, business registration and e-commerce report numbers, address, privacy officer,
 * effective date) are OPTIONAL and come only from runtime environment variables - the per-operator VALUES live in the deployment's
 * configuration, the fixed policy wording in lib/legalContent.ts. Nothing is invented: until a value is explicitly configured the
 * field is simply absent and the pages leave that line out (never a placeholder). The one built-in value is the confirmed contact
 * mailbox (CONFIRMED_CONTACT_EMAIL). A launch deployment requires the values it cannot go without (launch-settings-guard.bicep).
 *
 * Plain runtime variables (not NEXT_PUBLIC_), read per request like lib/storeConfig.ts, so one image serves every environment.
 */
export interface LegalOperatorConfig {
  readonly serviceName: string;
  readonly operatorName?: string;
  /** 대표자. */
  readonly representativeName?: string;
  readonly businessRegistrationNumber?: string;
  /** 통신판매업 신고번호 - shown only once one is configured. */
  readonly ecommerceRegistrationNumber?: string;
  /** 통신판매업 신고기관 (e.g. "광진구청") - shown next to the report number, and only together with it. */
  readonly ecommerceRegistrationAuthority?: string;
  readonly businessAddress?: string;
  readonly supportEmail?: string;
  readonly privacyEmail?: string;
  /** 개인정보 보호책임자: the name, an optional title (e.g. "대표"), and the mailbox to reach them (default: the privacy mailbox). */
  readonly privacyOfficerName?: string;
  readonly privacyOfficerTitle?: string;
  readonly privacyOfficerEmail?: string;
  /** The date the published terms/policy take effect; shown only when configured (YYYY-MM-DD). */
  readonly effectiveDate?: string;
}

/**
 * When the wording of the terms and the account-deletion page was last changed. The privacy policy carries its own date
 * (PRIVACY_POLICY_UPDATED), so a policy-only change never re-dates the other documents. Update together with lib/legalContent.ts.
 */
export const LEGAL_CONTENT_UPDATED = '2026-10-14';

/** When the privacy policy's wording was last changed (2026-10-19: service usage records for analytics). */
export const PRIVACY_POLICY_UPDATED = '2026-10-25';

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
  const email = (name: string, fallback: string = CONFIRMED_CONTACT_EMAIL) => {
    const value = clean(env[name]) ?? fallback;
    return EMAIL_PATTERN.test(value) ? value : fallback;
  };
  const date = clean(env.LEGAL_EFFECTIVE_DATE);
  const privacyEmail = email('LEGAL_PRIVACY_EMAIL');
  const privacyOfficerName = clean(env.LEGAL_PRIVACY_OFFICER_NAME);

  return {
    serviceName: 'Juple',
    operatorName: clean(env.LEGAL_OPERATOR_NAME),
    representativeName: clean(env.LEGAL_REPRESENTATIVE_NAME),
    businessRegistrationNumber: clean(env.LEGAL_BUSINESS_REGISTRATION_NUMBER),
    ecommerceRegistrationNumber: clean(env.LEGAL_ECOMMERCE_REGISTRATION_NUMBER),
    ecommerceRegistrationAuthority: clean(env.LEGAL_ECOMMERCE_REGISTRATION_AUTHORITY),
    businessAddress: clean(env.LEGAL_BUSINESS_ADDRESS),
    supportEmail: email('LEGAL_SUPPORT_EMAIL'),
    privacyEmail,
    privacyOfficerName,
    privacyOfficerTitle: privacyOfficerName ? clean(env.LEGAL_PRIVACY_OFFICER_TITLE) : undefined,
    privacyOfficerEmail: privacyOfficerName ? email('LEGAL_PRIVACY_OFFICER_EMAIL', privacyEmail) : undefined,
    effectiveDate: date && DATE_PATTERN.test(date) ? date : undefined,
  };
}

/** "2026-10-10" -> "2026년 10월 10일" (the pages are Korean). */
export function formatLegalDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
}
