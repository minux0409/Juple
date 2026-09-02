import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';
import type { ItemCategory } from '../../categories/api/categoriesApi';
import type { RepresentativeImage } from '../../images/api/imagesApi';

export interface InboxEntry {
  readonly id: number;
  readonly url: string;
  readonly title: string | null;
  readonly memo: string | null;
  readonly savedAtUtc: string;
  readonly category: ItemCategory | null;
  readonly representativeImage: RepresentativeImage | null;
}

export interface DailyInbox {
  readonly date: string;
  readonly items: readonly InboxEntry[];
}

/** POST /api/v1/inbox's create/replay response - a fixed creation-time snapshot with no Title/Memo. */
export interface SavedInboxEntry {
  readonly id: number;
  readonly url: string;
  readonly savedAtUtc: string;
}

export async function getTodayInbox(
  request: AuthenticatedApiRequest,
): Promise<DailyInbox> {
  const response = await request<DailyInbox>({
    method: 'GET',
    path: '/api/v1/inbox',
  });

  if (!response.body) {
    throw new Error('Juple API returned no Daily Inbox body.');
  }

  return response.body;
}

export async function saveInboxEntry(
  request: AuthenticatedApiRequest,
  url: string,
  clientRequestId?: string,
): Promise<SavedInboxEntry> {
  const response = await request<SavedInboxEntry>({
    method: 'POST',
    path: '/api/v1/inbox',
    body: { url, clientRequestId },
  });

  if (!response.body) {
    throw new Error('Juple API returned no Inbox entry body.');
  }

  return response.body;
}
