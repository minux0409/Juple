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

/** What happened in the chosen Collections when a link was saved into them (see saveInboxEntryToCollections). */
export interface SavedInboxEntryWithCollections extends SavedInboxEntry {
  readonly addedCount: number;
  readonly submittedCount: number;
  readonly alreadyInCollectionCount: number;
  readonly alreadyPendingCount: number;
}

/**
 * The 링크 저장 screen's one save: the link and its chosen Collections in a single request (the server checks every
 * destination before writing anything and writes all memberships together - see SaveInboxEntryToCollectionsService).
 * An empty collectionIds is an explicit "no Collection". unlockTokens: the grant for each locked destination, by id.
 */
export async function saveInboxEntryToCollections(
  request: AuthenticatedApiRequest,
  url: string,
  clientRequestId: string,
  collectionIds: readonly number[],
  unlockTokens: Readonly<Record<number, string>>,
): Promise<SavedInboxEntryWithCollections> {
  const response = await request<SavedInboxEntryWithCollections>({
    method: 'POST',
    path: '/api/v1/inbox',
    body: { url, clientRequestId, collectionIds, unlockTokens },
  });

  if (!response.body) {
    throw new Error('Juple API returned no Inbox entry body.');
  }

  return response.body;
}
