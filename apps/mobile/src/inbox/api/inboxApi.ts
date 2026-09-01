import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';

export interface InboxEntry {
  readonly id: number;
  readonly url: string;
  readonly savedAtUtc: string;
}

export interface DailyInbox {
  readonly date: string;
  readonly items: readonly InboxEntry[];
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
): Promise<InboxEntry> {
  const response = await request<InboxEntry>({
    method: 'POST',
    path: '/api/v1/inbox',
    body: { url, clientRequestId },
  });

  if (!response.body) {
    throw new Error('Juple API returned no Inbox entry body.');
  }

  return response.body;
}
