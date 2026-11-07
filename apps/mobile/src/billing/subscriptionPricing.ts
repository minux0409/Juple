/**
 * Price facts of the two membership plans, computed ONLY from what the store reports for THIS storefront. Nothing here knows a price:
 * the US$1.99 / US$19.90 pair is a business reference on the Backend, never a number the app shows or compares against. The yearly
 * discount is therefore recomputed per country from that country's own monthly x 12 versus its own yearly price - and when the
 * numbers do not show a real saving, no discount is claimed at all.
 */
export type PlanKey = 'monthly' | 'yearly';

export interface PricedPlan {
  readonly key: PlanKey;
  /** The price in currency units (e.g. 19.9), as the store reports it; null when the store gave no machine-readable amount. */
  readonly priceAmount: number | null;
  readonly currencyCode: string | null;
}

export interface AnnualSavings {
  /** The exact saving of yearly versus twelve monthly payments, 0 < percent < 100 (e.g. 16.666...). */
  readonly percent: number;
  /** The difference in currency units (monthly x 12 - yearly). */
  readonly amount: number;
  readonly currencyCode: string;
}

/** A discount smaller than this (in percent) is not worth a badge: it would read as noise, and rounding would claim nothing real. */
const MIN_BADGE_PERCENT = 1;

/** The saving of the yearly plan against twelve monthly payments, or null when it cannot be stated truthfully. */
export function computeAnnualSavings(monthly: PricedPlan | null, yearly: PricedPlan | null): AnnualSavings | null {
  if (!monthly || !yearly) {
    return null;
  }
  const { priceAmount: monthlyAmount, currencyCode: monthlyCurrency } = monthly;
  const { priceAmount: yearlyAmount, currencyCode: yearlyCurrency } = yearly;
  if (
    monthlyAmount === null ||
    yearlyAmount === null ||
    !Number.isFinite(monthlyAmount) ||
    !Number.isFinite(yearlyAmount) ||
    monthlyAmount <= 0 ||
    yearlyAmount <= 0 ||
    !monthlyCurrency ||
    monthlyCurrency !== yearlyCurrency
  ) {
    return null;
  }
  const twelveMonths = monthlyAmount * 12;
  const amount = roundMoney(twelveMonths - yearlyAmount);
  if (amount <= 0) {
    return null;
  }
  return { percent: (amount / twelveMonths) * 100, amount, currencyCode: monthlyCurrency };
}

/**
 * The whole-number percent for the "about N% off" badge - the real local discount rounded, or null when there is nothing to claim
 * (no saving, or a saving under one percent). It is never a fixed number: the US pair gives 17 because 16.67 rounds to 17, while a
 * country whose yearly price is not 10/12 of twelve months gets its own figure (or no badge).
 */
export function discountBadgePercent(savings: AnnualSavings | null): number | null {
  if (!savings || savings.percent < MIN_BADGE_PERCENT) {
    return null;
  }
  const rounded = Math.round(savings.percent);
  return rounded >= 1 && rounded <= 99 ? rounded : null;
}

/** Money in the person's own locale and the store's currency; falls back to a plain "amount CODE" where Intl is unavailable. */
export function formatMoney(amount: number, currencyCode: string, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}`;
  }
}

/** The monthly-equivalent price of the yearly plan (yearly / 12): shown as secondary text, never as the price charged. */
export function yearlyPerMonthAmount(yearly: PricedPlan | null): number | null {
  if (!yearly || yearly.priceAmount === null || !Number.isFinite(yearly.priceAmount) || yearly.priceAmount <= 0) {
    return null;
  }
  return roundMoney(yearly.priceAmount / 12);
}

/** Store amounts are decimal prices; two decimals keep a saving like 3.98 exact without binary float noise (zero-decimal currencies are whole numbers anyway). */
function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** ISO-8601 recurring period -> plan, for stores that report the period (Google Play: "P1M" / "P1Y"). */
export function planKeyForPeriod(period: string | null | undefined): PlanKey | null {
  if (period === 'P1M') {
    return 'monthly';
  }
  if (period === 'P1Y' || period === 'P12M') {
    return 'yearly';
  }
  return null;
}
