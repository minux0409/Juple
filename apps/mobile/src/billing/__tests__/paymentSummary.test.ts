import { addBillingPeriod, describePaymentSummary } from '../paymentSummary';

const ymd = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()];

describe('addBillingPeriod - one month or one year later, clamped at the end of a shorter month', () => {
  it.each([
    [[2026, 11, 16], 'monthly', [2026, 12, 16]],
    [[2026, 12, 16], 'monthly', [2027, 1, 16]],
    [[2026, 1, 31], 'monthly', [2026, 2, 28]],
    [[2028, 1, 31], 'monthly', [2028, 2, 29]],
    [[2026, 3, 31], 'monthly', [2026, 4, 30]],
    [[2026, 11, 16], 'yearly', [2027, 11, 16]],
    [[2028, 2, 29], 'yearly', [2029, 2, 28]],
  ] as const)('%j + %s = %j', (from, plan, expected) => {
    expect(ymd(addBillingPeriod(new Date(from[0], from[1] - 1, from[2], 12), plan))).toEqual(expected);
  });

  it('a summary is the first payment today and the renewal one period later', () => {
    const today = new Date(2026, 10, 16, 9, 30);
    expect(ymd(describePaymentSummary('monthly', today).nextRenewalDate)).toEqual([2026, 12, 16]);
    expect(ymd(describePaymentSummary('yearly', today).nextRenewalDate)).toEqual([2027, 11, 16]);
    expect(describePaymentSummary('yearly', today).firstPaymentDate).toBe(today);
  });
});
