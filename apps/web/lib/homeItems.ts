/**
 * Home (오늘 저장한 링크) for the signed-in Web app - the same API and the same rules as the mobile Home (DailyInboxScreen):
 * GET /api/v1/items/history with fromUtc = the start of TODAY in the viewer's own time zone, newest saved first. Each row is the
 * shared saved-link model (savedLinks.ts).
 */

/** One page of today's links - the mobile Home's own page size. */
export const HOME_PAGE_SIZE = 50;

/** Midnight of `now`'s local day, as a UTC instant - the browser's own time zone, never a hardcoded one. */
export function todayWindowStartUtc(now: Date): string {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return start.toISOString();
}

export function homeHistoryPath(now: Date): string {
  const query = new URLSearchParams({ limit: String(HOME_PAGE_SIZE), fromUtc: todayWindowStartUtc(now) });
  return `/api/v1/items/history?${query.toString()}`;
}

/** The header's count: GET /api/v1/items/history/count for the same window (mobile getItemHistoryCount). */
export function homeCountPath(now: Date): string {
  return `/api/v1/items/history/count?${new URLSearchParams({ fromUtc: todayWindowStartUtc(now) }).toString()}`;
}
