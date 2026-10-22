export type Period = { from: string; through: string };
export const workspaceBase = '/api/v1/admin/workspace';
export const seoulToday = (now = new Date()) => new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
export function daysEnding(through: string, count: number): Period {
  return { from: new Date(Date.parse(`${through}T00:00:00Z`) - (count - 1) * 86400_000).toISOString().slice(0, 10), through };
}
export function validatePeriod(period: Period, today = seoulToday()): string | null {
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  if (!valid(period.from) || !valid(period.through)) return '올바른 시작일과 종료일을 입력하세요.';
  if (period.from < '2000-01-01' || period.from > period.through || period.through > today) return '오늘까지의 날짜를 순서대로 선택하세요.';
  if ((Date.parse(period.through) - Date.parse(period.from)) / 86400_000 >= 366) return '최대 366일까지 조회할 수 있습니다.';
  return null;
}
export function periodQuery(period: Period) { return new URLSearchParams(period).toString(); }
export function selectedPeriod(query: URLSearchParams, today = seoulToday()): Period {
  const value = { from: query.get('from') ?? '', through: query.get('through') ?? '' };
  return validatePeriod(value, today) ? daysEnding(today, 7) : value;
}
export interface Coverage { metric: string; available: boolean; explanation: string }
export interface WorkspaceDay {
  date: string; signups: number; survivingAccountsToDate: number; linksSaved: number; linkSavers: number;
  survivingSavedLinksToDate: number; collectionsCreated: number; activeUsers: number | null;
  sharedLinkAddEvents: number; shareEvents: number; commentEvents: number;
}
export interface WorkspaceOverview {
  period: Period; timeZone: string; generatedAtUtc: string; totalUsers: number; newUsers: number; liveLinks: number;
  savedLinks: number; uniqueSavers: number; activeUsers: number | null; dau: number | null; wau: number | null; mau: number | null;
  currentCollections: number; sharedCollections: number; openInquiries: number;
  activityTrackingSince: string | null; series: WorkspaceDay[]; coverage: Coverage[];
  platforms: { platform: string; activeUsers: number }[];
  recentUsers: { jupleId: string; lastSeenAtUtc: string }[]; domains: { domain: string; links: number }[];
}
export interface WorkspaceOperations {
  push: { date: string; platform: string; status: string; deliveries: number; averageCreationToAttemptMs: number | null }[];
  events: { atUtc: string; kind: string; status: string; attempts: number }[]; coverage: Coverage[];
  telemetry: { available: boolean; status: string; days: { date: string; requests: number; errors5xx: number; unauthorized: number }[] } | null;
}
export interface WorkspaceRevenue {
  billingProgramEnabled: boolean; amountsAvailable: boolean; explanation: string;
  currentPurchaseStates: { platform: string; state: string; purchases: number }[];
}
