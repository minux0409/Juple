import { computeAnnualSavings, discountBadgePercent, formatMoney, planKeyForPeriod, yearlyPerMonthAmount, type PricedPlan } from '../subscriptionPricing';

const plan = (key: 'monthly' | 'yearly', priceAmount: number | null, currencyCode: string | null = 'USD'): PricedPlan => ({ key, priceAmount, currencyCode });

describe('computeAnnualSavings', () => {
  it('the US pair: 1.99 x 12 = 23.88 against 19.90 saves 3.98, 16.67% - the badge rounds that to 17', () => {
    const savings = computeAnnualSavings(plan('monthly', 1.99), plan('yearly', 19.9));

    expect(savings).not.toBeNull();
    expect(savings!.amount).toBe(3.98);
    expect(savings!.percent).toBeCloseTo(16.6667, 3);
    expect(savings!.currencyCode).toBe('USD');
    expect(discountBadgePercent(savings)).toBe(17);
  });

  it('is computed from THIS storefront: another country with a different yearly ratio gets its own number', () => {
    // A storefront whose yearly price is only 5% below twelve months.
    const shallow = computeAnnualSavings(plan('monthly', 3000, 'KRW'), plan('yearly', 34200, 'KRW'));
    // A storefront with a deeper cut.
    const deep = computeAnnualSavings(plan('monthly', 3000, 'KRW'), plan('yearly', 24000, 'KRW'));

    expect(discountBadgePercent(shallow)).toBe(5);
    expect(discountBadgePercent(deep)).toBe(33);
  });

  it('claims nothing when yearly is not cheaper than twelve months', () => {
    expect(computeAnnualSavings(plan('monthly', 1.99), plan('yearly', 23.88))).toBeNull();
    expect(computeAnnualSavings(plan('monthly', 1.99), plan('yearly', 29.99))).toBeNull();
  });

  it('claims nothing when a saving would be under one percent (rounding would invent a number)', () => {
    const tiny = computeAnnualSavings(plan('monthly', 10), plan('yearly', 119.5));

    expect(tiny).not.toBeNull();
    expect(discountBadgePercent(tiny)).toBeNull();
  });

  it.each([
    ['a missing monthly plan', null, plan('yearly', 19.9)],
    ['a missing yearly plan', plan('monthly', 1.99), null],
    ['no machine-readable monthly amount', plan('monthly', null), plan('yearly', 19.9)],
    ['no machine-readable yearly amount', plan('monthly', 1.99), plan('yearly', null)],
    ['a zero price', plan('monthly', 0), plan('yearly', 19.9)],
    ['a negative price', plan('monthly', 1.99), plan('yearly', -1)],
    ['a non-finite price', plan('monthly', Number.NaN), plan('yearly', 19.9)],
    ['different currencies', plan('monthly', 1.99, 'USD'), plan('yearly', 19.9, 'EUR')],
    ['an unknown currency', plan('monthly', 1.99, null), plan('yearly', 19.9, null)],
  ] as const)('states no saving for %s - never a guess', (_label, monthly, yearly) => {
    expect(discountBadgePercent(computeAnnualSavings(monthly as PricedPlan | null, yearly as PricedPlan | null))).toBeNull();
  });

  it('a saving of 100% or more is impossible and never shown', () => {
    expect(discountBadgePercent({ percent: 100, amount: 10, currencyCode: 'USD' })).toBeNull();
    expect(discountBadgePercent(null)).toBeNull();
  });
});

describe('yearlyPerMonthAmount', () => {
  it('is yearly / 12 to the cent, and unknown when the store gave no amount', () => {
    expect(yearlyPerMonthAmount(plan('yearly', 19.9))).toBe(1.66);
    expect(yearlyPerMonthAmount(plan('yearly', null))).toBeNull();
    expect(yearlyPerMonthAmount(null)).toBeNull();
    expect(yearlyPerMonthAmount(plan('yearly', 0))).toBeNull();
  });
});

describe('formatMoney', () => {
  it('formats in the store currency', () => {
    expect(formatMoney(3.98, 'USD', 'en-US')).toContain('3.98');
  });

  it('never throws on an unknown currency code', () => {
    expect(() => formatMoney(3.98, 'XXXX-NOT-A-CODE', 'en-US')).not.toThrow();
    expect(formatMoney(3.98, 'ZZ', 'en-US')).toContain('3.98');
  });
});

describe('planKeyForPeriod', () => {
  it('maps the store billing periods to the two plans and nothing else', () => {
    expect(planKeyForPeriod('P1M')).toBe('monthly');
    expect(planKeyForPeriod('P1Y')).toBe('yearly');
    expect(planKeyForPeriod('P12M')).toBe('yearly');
    expect(planKeyForPeriod('P1W')).toBeNull();
    expect(planKeyForPeriod('P3M')).toBeNull();
    expect(planKeyForPeriod(null)).toBeNull();
  });
});
