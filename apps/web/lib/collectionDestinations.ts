import { ApiHttpError, type AppApi } from './appApi.ts';
import { canAddItemsTo } from './collectionEditor.ts';
import { collectionContentGate, type FreshCollectionAccess } from './collectionGate.ts';
import type { CollectionsPage, CollectionSummary } from './collectionsView.ts';

/**
 * The Collections a link can be put into - the one list behind the new-link review and the link editor (mobile
 * useCategoryPickerModal): the person's own, then the ones shared with them that they may add to (never a view-only one), each
 * drained page by page. Pure over the injected api, so it is unit-tested without a browser.
 */

const PAGE_LIMIT = 50;

async function drain(api: AppApi, scope: 'owned' | 'shared'): Promise<readonly CollectionSummary[]> {
  let all: readonly CollectionSummary[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ scope, limit: String(PAGE_LIMIT) });
    if (cursor) {
      query.set('cursor', cursor);
    }
    const page: CollectionsPage = await api<CollectionsPage>({ path: `/api/v1/collections?${query.toString()}` });
    all = [...all, ...page.items];
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

export async function loadDestinations(api: AppApi): Promise<readonly CollectionSummary[]> {
  const owned = await drain(api, 'owned');
  const ownedIds = new Set(owned.map(collection => collection.id));
  const shared = (await drain(api, 'shared')).filter(collection => !ownedIds.has(collection.id) && canAddItemsTo(collection));
  return [...owned, ...shared];
}

/**
 * A Collection's lock / share-password state and the caller's role are MUTABLE (the Owner can switch the password on or off from
 * another device at any moment), so a card in a list loaded minutes ago is only a snapshot: at the moment of the tap the Collection
 * is read again (GET /api/v1/collections/{id} - the card's own metadata, no content, no grant needed) and THAT state wins, in both
 * directions (mobile freshCollectionAccess.ts).
 */
export async function resolveFreshCollectionAccess(api: AppApi, cached: CollectionSummary): Promise<FreshCollectionAccess> {
  try {
    const fresh = await api<CollectionSummary & { readonly isSharePasswordProtected?: boolean }>({ path: `/api/v1/collections/${cached.id}` });
    if (!canAddItemsTo(fresh)) {
      return { status: 'unavailable' };
    }
    return { status: 'ok', collection: fresh, gate: collectionContentGate(fresh) };
  } catch (caught) {
    if (caught instanceof ApiHttpError && caught.status === 404) {
      return { status: 'unavailable' };
    }
    // A lost session must reach the app (it signs out); anything else keeps the cached card - the server judges the real action.
    if (caught instanceof Error && caught.name === 'AuthExpiredError') {
      throw caught;
    }
    return { status: 'unknown' };
  }
}

/** Replaces the cached card of a list with the fresh one (same position); a missing one stays missing. */
export function withFreshCollection(list: readonly CollectionSummary[], fresh: CollectionSummary): readonly CollectionSummary[] {
  return list.map(entry => (entry.id === fresh.id ? { ...entry, ...fresh } : entry));
}
