import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';

export interface ItemListEntry {
  readonly id: number;
  readonly url: string;
  readonly savedAtUtc: string;
  readonly stateChangedAtUtc: string;
}

export interface ItemPage {
  readonly items: readonly ItemListEntry[];
  readonly nextCursor: string | null;
}

export type ItemListState = 'wishlist' | 'archived';

export interface GetItemsByStateOptions {
  readonly limit?: number;
  /** Opaque value from a previous ItemPage.nextCursor; never parsed or modified. */
  readonly cursor?: string;
}

export async function getItemsByState(
  request: AuthenticatedApiRequest,
  state: ItemListState,
  options: GetItemsByStateOptions = {},
): Promise<ItemPage> {
  const query = new URLSearchParams({ state });
  if (options.limit !== undefined) {
    query.set('limit', String(options.limit));
  }
  if (options.cursor) {
    query.set('cursor', options.cursor);
  }

  const response = await request<ItemPage>({
    method: 'GET',
    path: `/api/v1/items?${query.toString()}`,
  });

  if (!response.body) {
    throw new Error('Juple API returned no Items page body.');
  }

  return response.body;
}
