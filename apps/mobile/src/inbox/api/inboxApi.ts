import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';

/** POST /api/v1/inbox's create/replay response - a fixed creation-time snapshot with no Title/Memo. */
export interface SavedInboxEntry {
  readonly id: number;
  readonly url: string;
  readonly savedAtUtc: string;
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
