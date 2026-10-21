import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { getCollections, type Collection } from '../collections/api/collectionsApi';
import { collectionShortcutService } from '../shortcuts/CollectionShortcutService';

const PAGE_LIMIT = 50;

/**
 * Keeps the Collections the user pinned as app shortcuts (see CollectionShortcutService) in line with the server: a renamed
 * one gets its new label, one that was deleted, left, revoked, locked or made read-only is removed. It never
 * publishes a Collection the user did not choose.
 *
 * Cheap by design: with nothing pinned it makes no request at all, and otherwise it pages through the account's Collections
 * (scope 'all') only until every pinned one has been seen - never one request per Collection. Best-effort: a failure leaves
 * the shortcuts exactly as they were (a flaky network must not remove the user's choices), and the next call tries again.
 * Android-only (a no-op where there is no native shortcut support).
 */
export async function reconcileCollectionShortcuts(request: AuthenticatedApiRequest): Promise<void> {
  if (!collectionShortcutService.isSupported()) {
    return;
  }

  const pinnedIds = await collectionShortcutService.getPinnedCollectionIds();
  if (pinnedIds.size === 0) {
    return;
  }

  const seen: Collection[] = [];
  const stillToFind = new Set(pinnedIds);
  let cursor: string | undefined;
  do {
    const page = await getCollections(request, { scope: 'all', limit: PAGE_LIMIT, cursor });
    for (const collection of page.items) {
      seen.push(collection);
      stillToFind.delete(collection.id);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor && stillToFind.size > 0);

  // Only a COMPLETE walk proves a pinned Collection is gone; stopping early (all found) is complete for them.
  await collectionShortcutService.applyAuthoritativeCollections(seen, pinnedIds);
}
