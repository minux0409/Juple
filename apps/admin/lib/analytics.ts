/**
 * 분석 - the shape of GET /api/v1/admin/analytics/overview and the pure helpers its pages use (range, chart geometry, the
 * tracking-start notice). Definitions live in docs/analytics.md; every date here is a UTC calendar day ("YYYY-MM-DD").
 */

export type AnalyticsRange = '7d' | '30d' | '90d';

export const ANALYTICS_RANGES: readonly { readonly range: AnalyticsRange; readonly days: number }[] = [
  { range: '7d', days: 7 },
  { range: '30d', days: 30 },
  { range: '90d', days: 90 },
];

export const DEFAULT_RANGE: AnalyticsRange = '30d';

export function parseRange(value: string | null | undefined): AnalyticsRange {
  return value === '7d' || value === '30d' || value === '90d' ? value : DEFAULT_RANGE;
}

export function analyticsPath(range: AnalyticsRange): string {
  return `/api/v1/admin/analytics/overview?range=${range}`;
}

export interface UserLinkStats {
  readonly userId: number;
  readonly jupleId: string;
  readonly createdAtUtc: string;
  readonly range: AnalyticsRange;
  readonly startDateUtc: string;
  readonly todayUtc: string;
  readonly generatedAtUtc: string;
  /** Links not in the trash right now. */
  readonly liveLinks: number;
  /** Saved on that UTC day(s) and still existing (trash included); permanently deleted links cannot be counted. */
  readonly savedToday: number;
  readonly saved7Days: number;
  readonly saved30Days: number;
  readonly saved90Days: number;
  readonly savedInRange: number;
  readonly series: readonly { readonly date: string; readonly linksSaved: number }[];
}

export function userLinkStatsPath(userId: number, range: AnalyticsRange): string {
  return `/api/v1/admin/users/${encodeURIComponent(String(userId))}/link-stats?range=${range}`;
}

export interface AnalyticsDay {
  readonly date: string;
  readonly signups: number;
  readonly activeUsers: number;
  readonly linksSaved: number;
  readonly collectionsCreated: number;
  /** Distinct active users per platform that day (absent on an older API). */
  readonly activeAndroid?: number;
  readonly activeIos?: number;
  readonly activeWeb?: number;
  readonly activeUnknown?: number;
}

export interface MembershipGroups {
  readonly paid: number;
  readonly gracePeriod: number;
  readonly inTrial: number;
  readonly trialEndedUnpaid: number;
}

export interface Membership {
  readonly billingProgramEnabled: boolean;
  readonly programStartAtUtc: string | null;
  readonly totalUsers: number;
  readonly newToday: number;
  readonly signedUpWithin30Days: number;
  readonly signedUpOver30Days: number;
  /** Null while the billing program does not run: trial / paid states do not exist - never shown as 0. */
  readonly groups: MembershipGroups | null;
}

export interface LinkHoldings {
  readonly totalLiveLinks: number;
  readonly usersWithLinks: number;
  readonly totalUsers: number;
  readonly maxLinksPerUser: number;
  readonly usersAtMax: number;
  readonly buckets: readonly { readonly min: number; readonly max: number | null; readonly users: number }[];
  readonly topHolders: readonly { readonly jupleId: string; readonly liveLinks: number }[];
}

export interface AnalyticsOverview {
  readonly range: AnalyticsRange;
  readonly startDateUtc: string;
  readonly todayUtc: string;
  readonly generatedAtUtc: string;
  readonly activityTrackingSince: string | null;
  readonly users: {
    readonly total: number;
    readonly newToday: number;
    readonly new7Days: number;
    readonly new30Days: number;
    readonly newInRange: number;
    readonly dau: number;
    readonly wau: number;
    readonly mau: number;
  };
  readonly links: {
    readonly totalLive: number;
    readonly savedToday: number;
    readonly saved7Days: number;
    readonly saved30Days: number;
    readonly savedInRange: number;
    readonly uniqueSaversInRange: number;
  };
  readonly collections: {
    readonly totalLive: number;
    readonly sharedLive: number;
    readonly created7Days: number;
    readonly created30Days: number;
    readonly createdInRange: number;
  };
  readonly platforms: {
    readonly activeUsersInRange: number;
    readonly items: readonly { readonly platform: string; readonly activeUsers: number }[];
  };
  readonly countries: { readonly available: boolean };
  readonly series: readonly AnalyticsDay[];
  /** Round 6 additions (absent on an older API - the pages then simply leave those sections out). */
  readonly membership?: Membership | null;
  readonly linkHoldings?: LinkHoldings | null;
  readonly platformsSinceTrackingStart?: AnalyticsOverview['platforms'] | null;
}

// ---- membership --------------------------------------------------------------------------------------------------------------

export interface ShareRow {
  readonly key: string;
  readonly value: number;
  /** Share of the base, 0..100 with one decimal (0 when the base is 0). */
  readonly percent: number;
}

export function percentOf(value: number, base: number): number {
  return base > 0 ? Math.round((value / base) * 1000) / 10 : 0;
}

/**
 * The exclusive membership groups as rows (they add up to the total), or null when the billing program does not run - then the page
 * says "결제 미운영 - 집계 불가" instead of showing any trial / paid number.
 */
export function membershipRows(membership: Membership): readonly ShareRow[] | null {
  const groups = membership.groups;
  if (!membership.billingProgramEnabled || !groups) {
    return null;
  }
  return (['paid', 'gracePeriod', 'inTrial', 'trialEndedUnpaid'] as const).map(key => ({
    key,
    value: groups[key],
    percent: percentOf(groups[key], membership.totalUsers),
  }));
}

// ---- link holdings -----------------------------------------------------------------------------------------------------------

/** "0개", "1~9개", "500개 이상". */
export function bucketLabel(bucket: { readonly min: number; readonly max: number | null }): string {
  if (bucket.max === null) {
    return `${bucket.min.toLocaleString()}개 이상`;
  }
  return bucket.min === bucket.max ? `${bucket.min.toLocaleString()}개` : `${bucket.min.toLocaleString()}~${bucket.max.toLocaleString()}개`;
}

export function holdingRows(holdings: LinkHoldings): readonly ShareRow[] {
  return holdings.buckets.map(bucket => ({ key: bucketLabel(bucket), value: bucket.users, percent: percentOf(bucket.users, holdings.totalUsers) }));
}

/** Whole days between two UTC dates ("YYYY-MM-DD"), b - a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * Whether the activity numbers cover the whole window yet. Before tracking started nothing exists (never estimated), so a window
 * reaching further back only counts the days since the start: the page says so instead of letting a small MAU look like an error.
 */
export function trackingCoverage(trackingSince: string | null, windowStart: string): { readonly kind: 'none' } | { readonly kind: 'partial'; readonly since: string } | { readonly kind: 'full' } {
  if (!trackingSince) {
    return { kind: 'none' };
  }
  return daysBetween(trackingSince, windowStart) >= 0 ? { kind: 'full' } : { kind: 'partial', since: trackingSince };
}

/** Active-user days are meaningful only from the tracking start: earlier days are "no data", not zero. */
export function activeSeries(series: readonly AnalyticsDay[], trackingSince: string | null): readonly (number | null)[] {
  return series.map(day => (trackingSince && daysBetween(trackingSince, day.date) >= 0 ? day.activeUsers : null));
}

export interface PlatformShare {
  readonly platform: string;
  readonly activeUsers: number;
  /** Share of the range's distinct active users, 0..100 (one person on two platforms is in both, so shares can add up to more). */
  readonly percent: number;
}

/** Android, iOS and Web always (0 shown as 0); "Unknown" only when there is any. */
export function platformShares(platforms: AnalyticsOverview['platforms']): readonly PlatformShare[] {
  const order = ['Android', 'Ios', 'Web', 'Unknown'];
  return order
    .map(platform => ({ platform, activeUsers: platforms.items.find(item => item.platform === platform)?.activeUsers ?? 0 }))
    .filter(item => item.platform !== 'Unknown' || item.activeUsers > 0)
    .map(item => ({
      ...item,
      percent: platforms.activeUsersInRange > 0 ? Math.round((item.activeUsers / platforms.activeUsersInRange) * 1000) / 10 : 0,
    }));
}

/** Average saves per person who saved in the range (one decimal), or null when nobody saved. */
export function savesPerSaver(saved: number, savers: number): number | null {
  return savers > 0 ? Math.round((saved / savers) * 10) / 10 : null;
}

// ---- bar chart geometry (pure; the SVG component only draws it) ------------------------------------------------------------

export interface ChartBar {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly value: number | null;
  readonly label: string;
}

export interface ChartLayout {
  readonly bars: readonly ChartBar[];
  /** The y-axis maximum: a "nice" number at or above the largest value (at least 1). */
  readonly max: number;
  readonly ticks: readonly { readonly value: number; readonly y: number }[];
}

/** 1, 2, 5 x 10^n - the smallest at or above the value. */
export function niceMax(value: number): number {
  if (value <= 1) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (step * magnitude >= value) {
      return step * magnitude;
    }
  }
  return 10 * magnitude;
}

/** Bars in a width x height plot area. A null value (no data) gets no bar; 0 gets a 0-height bar. */
export function layoutBars(values: readonly (number | null)[], labels: readonly string[], width: number, height: number): ChartLayout {
  const max = niceMax(Math.max(0, ...values.map(value => value ?? 0)));
  const slot = values.length > 0 ? width / values.length : width;
  const gap = Math.min(4, slot * 0.2);
  const bars = values.map((value, index) => {
    const barHeight = value === null ? 0 : (value / max) * height;
    return { x: index * slot + gap / 2, y: height - barHeight, width: Math.max(1, slot - gap), height: barHeight, value, label: labels[index] ?? '' };
  });
  // Counts: the middle grid line only when it is a whole number (no "2.5 users").
  const tickValues = Number.isInteger(max / 2) && max > 1 ? [0, max / 2, max] : [0, max];
  const ticks = tickValues.map(value => ({ value, y: height - (value / max) * height }));
  return { bars, max, ticks };
}

/**
 * Which bars get a date label: about 8 evenly spaced, always the last (today), and never one so close to the last that the two
 * labels would overlap.
 */
export function labelIndexes(count: number, target = 8): readonly number[] {
  if (count <= 0) {
    return [];
  }
  const every = Math.max(1, Math.ceil(count / target));
  const indexes: number[] = [];
  for (let index = 0; index < count - 1; index += every) {
    if (count - 1 - index >= Math.ceil(every / 2) + 1 || every === 1) {
      indexes.push(index);
    }
  }
  return [...indexes, count - 1];
}

/** "10/19" from "2026-10-19" - a UTC calendar day shown without converting it to any time zone. */
export function shortDay(date: string): string {
  const [, month, day] = date.split('-');
  return month && day ? `${Number(month)}/${Number(day)}` : date;
}

// ---- exact values on charts (no tooltip needed) ----------------------------------------------------------------------------------

/** The unit written next to every count: people ("명") or links / collections ("개"). */
export type ChartUnit = '명' | '개';

export const NO_DATA_TEXT = '데이터 없음';

/** "12명", "0개" - or "데이터 없음" for a missing value. 0 is a real zero and is always written as one. */
export function formatValue(value: number | null, unit: ChartUnit): string {
  return value === null ? NO_DATA_TEXT : `${value.toLocaleString()}${unit}`;
}

export interface ChartDataRow {
  readonly label: string;
  readonly text: string;
  /** True for a missing value (not the same as 0). */
  readonly noData: boolean;
}

/** Every value of a chart as text - the data list shown under it, so each number is readable without any tooltip. */
export function chartDataRows(labels: readonly string[], values: readonly (number | null)[], unit: ChartUnit): readonly ChartDataRow[] {
  return values.map((value, index) => ({ label: labels[index] ?? '', text: formatValue(value, unit), noData: value === null }));
}

/**
 * Whether a number can be written above EVERY bar without touching its neighbour: the slot must be wider than the longest value
 * (about 5.5 units per character at the chart's 9px label size). When not (e.g. 90 days, or 6-digit counts) the labels are left out
 * and the data list carries all values instead - nothing is ever drawn overlapping.
 */
export function valueLabelsFit(values: readonly (number | null)[], plotWidth: number): boolean {
  if (values.length === 0) {
    return true;
  }
  const longest = Math.max(1, ...values.map(value => (value === null ? 1 : value.toLocaleString().length)));
  return plotWidth / values.length >= longest * 5.5 + 2;
}
