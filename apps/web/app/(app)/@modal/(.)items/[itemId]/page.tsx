import { parseLockedContext } from '../../../../../lib/itemOpenGrant';
import { parseRouteId } from '../../../../../lib/savedLinks';
import { NotAnItem } from './NotAnItem';
import { QuickDetailSheet } from '../../../items/[itemId]/QuickDetailSheet';

type Search = { lockedBy?: string | string[]; collectionId?: string | string[] };

/**
 * /items/{id} reached by a click INSIDE the app (a soft navigation): intercepted, so the current page stays and the details rise over
 * it as the Quick Detail sheet. Typed, reloaded or externally opened addresses are not intercepted and render
 * app/(app)/items/[itemId]/page.tsx - the standalone page.
 */
export default async function InterceptedItemDetails({ params, searchParams }: { params: Promise<{ itemId: string }>; searchParams: Promise<Search> }) {
  const { itemId } = await params;
  // /items/new is its own page, not a link: the dynamic segment matches it here, so the address is loaded for real (see NotAnItem).
  if (parseRouteId(itemId) === null) {
    return <NotAnItem />;
  }
  const search = await searchParams;
  const lockedBy = parseLockedContext(typeof search.lockedBy === 'string' ? search.lockedBy : null);
  const fromCollectionId = lockedBy === null ? parseLockedContext(typeof search.collectionId === 'string' ? search.collectionId : null) : null;
  return <QuickDetailSheet fromCollectionId={fromCollectionId} itemIdParam={itemId} key={`${itemId}-${lockedBy ?? ''}-${fromCollectionId ?? ''}`} lockedBy={lockedBy} />;
}
