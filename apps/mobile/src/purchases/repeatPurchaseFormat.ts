import type { IntervalUnit } from './api/repeatPurchasesApi';

/**
 * "30일마다" / "2주마다" / "1개월마다" - shared by the RepeatPurchase list row and detail screen so
 * both always agree on the exact same wording.
 */
export function formatIntervalDescription(intervalValue: number, intervalUnit: IntervalUnit): string {
  const unitLabel: Record<IntervalUnit, string> = {
    day: '일마다',
    week: '주마다',
    month: '개월마다',
  };
  return `${intervalValue}${unitLabel[intervalUnit]}`;
}
