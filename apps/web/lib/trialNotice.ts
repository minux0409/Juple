import type { Entitlement } from './subscription.ts';

/**
 * The quiet notice about the free period (the mobile billing/trialNoticeModel.ts, same rules). It exists ONLY while the server says the
 * paid program is live AND this account is in its trial with an end date the server sent: nothing is promised while the program is off,
 * nothing is computed from the sign-up date, and a subscribed account (status 'active') never sees it. The 7-day mark is the only rule
 * decided here. Pure - the page keeps whether it was closed.
 */
export const TRIAL_ENDING_SOON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The ending-soon notice comes back at most once a day after it was closed. */
export const TRIAL_ENDING_REMINDER_MS = DAY_MS;

export type TrialNoticeKind = 'welcome' | 'endingSoon';

export interface TrialNotice {
  readonly kind: TrialNoticeKind;
  readonly endsAtUtc: string;
}

export function describeTrialNotice(entitlement: Pick<Entitlement, 'programEnabled' | 'status' | 'trialEndsAtUtc'> | null | undefined, nowMs: number): TrialNotice | null {
  if (!entitlement?.programEnabled || entitlement.status !== 'trial' || !entitlement.trialEndsAtUtc) {
    return null;
  }
  const endsAtMs = Date.parse(entitlement.trialEndsAtUtc);
  if (!Number.isFinite(endsAtMs) || endsAtMs <= nowMs) {
    return null;
  }
  return { kind: endsAtMs - nowMs <= TRIAL_ENDING_SOON_DAYS * DAY_MS ? 'endingSoon' : 'welcome', endsAtUtc: entitlement.trialEndsAtUtc };
}

export function trialNoticeKey(notice: TrialNotice): string {
  return `juple.web.trialNotice.${notice.kind}.${notice.endsAtUtc}`;
}

/** Whether the stored close mark still holds (welcome: for good; ending soon: within the last day). No mark = shown. */
export function isTrialNoticeClosed(notice: TrialNotice, stored: string | null, nowMs: number): boolean {
  if (stored === null) {
    return false;
  }
  if (notice.kind === 'welcome') {
    return true;
  }
  const closedAt = Number(stored);
  return !Number.isFinite(closedAt) || nowMs - closedAt < TRIAL_ENDING_REMINDER_MS;
}
