import type { TFunction } from 'i18next';
import type { IntervalUnit } from './api/repeatPurchasesApi';

const unitKeys: Record<IntervalUnit, string> = {
  day: 'repeatPurchase.unitDay',
  week: 'repeatPurchase.unitWeek',
  month: 'repeatPurchase.unitMonth',
};

/**
 * "30일마다" / "2주마다" / "1개월마다" (ko) or "Every 30 days" / "Every 2 weeks" / "Every 1 month"
 * (en, with real singular/plural via i18next's count-based pluralization) - shared by the
 * RepeatPurchase list row and detail screen so both always agree on the exact same wording.
 */
export function formatIntervalDescription(
  t: TFunction,
  intervalValue: number,
  intervalUnit: IntervalUnit,
): string {
  const unit = t(unitKeys[intervalUnit], { count: intervalValue });
  return t('repeatPurchase.intervalDescription', { count: intervalValue, unit });
}
