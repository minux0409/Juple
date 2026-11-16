import type { PlanKey } from './subscriptionPricing';

/**
 * The calendar date one billing period after `from` - one month or one year - in the device's own calendar, clamped to the last day of a
 * shorter month: 31 January + 1 month = 28 (29) February, 29 February + 1 year = 28 February. This is how the stores renew, so it is the
 * honest estimate of the next renewal; the exact terms are always the store's own purchase sheet.
 */
export function addBillingPeriod(from: Date, plan: PlanKey): Date {
  const months = plan === 'yearly' ? 12 : 1;
  const year = from.getFullYear();
  const month = from.getMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = month % 12;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  return new Date(targetYear, targetMonth, Math.min(from.getDate(), lastDay), from.getHours(), from.getMinutes(), from.getSeconds());
}

/**
 * What a person who subscribes NOW would be charged and when, for a person who holds no subscription: the first payment is today (the
 * store charges at purchase - Juple's own free month is not a store trial and does not move it) and the next renewal is one period later.
 * Never used for an existing subscriber: their dates are the ones the store and the server reported.
 */
export interface PaymentSummary {
  readonly plan: PlanKey;
  readonly firstPaymentDate: Date;
  readonly nextRenewalDate: Date;
}

export function describePaymentSummary(plan: PlanKey, today: Date): PaymentSummary {
  return { plan, firstPaymentDate: today, nextRenewalDate: addBillingPeriod(today, plan) };
}
