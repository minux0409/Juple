import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { getCollections, type Collection } from '../collections/api/collectionsApi';
import NativeIncomingShare from '../share/specs/NativeIncomingShare';

const PAGE_LIMIT = 50;

/**
 * Favorite categories first (Direct Share/Quick Save composer priority - see
 * ShortcutSyncManager.kt), then most-recently-updated (a Collection's updatedAtUtc bumps on
 * membership changes server-side, so this doubles as "recently used" without a separate
 * client-side tracker), then by id as a final stable tiebreaker.
 */
function rankCategories(collections: readonly Collection[]): Collection[] {
  return [...collections].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) {
      return a.isFavorite ? -1 : 1;
    }
    if (a.updatedAtUtc !== b.updatedAtUtc) {
      return a.updatedAtUtc > b.updatedAtUtc ? -1 : 1;
    }
    return b.id - a.id;
  });
}

/**
 * Mirrors the user's Collections ("카테고리") into native storage (see CategorySnapshotStore.kt)
 * so the Quick Save composer's category picker and Android's Direct Share dynamic shortcuts (see
 * ShortcutSyncManager.kt) both work even when this JS/auth isn't running. Android-only (a no-op on
 * iOS, where NativeIncomingShare is null) - walks every page rather than just the first, since a
 * category missing from the snapshot would silently never be offered as a Direct Share target.
 * Best-effort: a failure here never blocks whatever screen action triggered it (see call sites in
 * CollectionsScreen/CollectionDetailsScreen/App.tsx).
 */
export async function syncCategorySnapshotToNative(request: AuthenticatedApiRequest): Promise<void> {
  if (!NativeIncomingShare) {
    return;
  }

  const collected: Collection[] = [];
  let cursor: string | undefined;
  do {
    const page = await getCollections(request, { limit: PAGE_LIMIT, cursor });
    collected.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  const snapshot = rankCategories(collected).map(collection => ({
    id: collection.id,
    name: collection.name,
    isFavorite: collection.isFavorite,
  }));

  await NativeIncomingShare.setCategorySnapshot(JSON.stringify(snapshot));
}
