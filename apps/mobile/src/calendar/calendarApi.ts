import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { COLLECTION_UNLOCK_HEADER } from '../collections/api/collectionsApi';

/** One local day that has links - `date` is "YYYY-MM-DD" in the caller's stored time zone. */
export interface CalendarDayCount {
  readonly date: string;
  readonly count: number;
}

/** A month of the calendar view: only the days that have links, with exact counts - never link data. */
export interface CalendarMonth {
  readonly year: number;
  readonly month: number;
  readonly days: readonly CalendarDayCount[];
}

/** The Archive: the caller's own links per day of one month (Trash excluded) - GET /api/v1/items/history/calendar. */
export async function getHistoryCalendar(request: AuthenticatedApiRequest, year: number, month: number): Promise<CalendarMonth> {
  const response = await request<CalendarMonth>({ method: 'GET', path: `/api/v1/items/history/calendar?year=${year}&month=${month}` });
  if (!response.body) {
    throw new Error('Juple API returned no calendar body.');
  }
  return response.body;
}

/** A Collection's links per day (when each was ADDED to it) of one month - same lock/share-password gate as its list. */
export async function getCollectionCalendar(
  request: AuthenticatedApiRequest,
  collectionId: number,
  year: number,
  month: number,
  unlockToken?: string | null,
): Promise<CalendarMonth> {
  const response = await request<CalendarMonth>({
    method: 'GET',
    path: `/api/v1/collections/${collectionId}/items/calendar?year=${year}&month=${month}`,
    headers: unlockToken ? { [COLLECTION_UNLOCK_HEADER]: unlockToken } : undefined,
  });
  if (!response.body) {
    throw new Error('Juple API returned no calendar body.');
  }
  return response.body;
}
