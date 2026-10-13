import { parseRouteId } from '../../../../../../../lib/savedLinks';
import { SharedItemQuickContent } from '../../../../../collections/[collectionId]/items/[itemId]/SharedItemContent';
import { QuickSheetFrame } from '../../../../../items/[itemId]/QuickDetailSheet';
import { NotAnItem } from '../../../../(.)items/[itemId]/NotAnItem';

/**
 * Another member's link in a Collection (/collections/{id}/items/{itemId}) reached by a click INSIDE the app: intercepted, so the
 * Collection stays and the link's details rise over it as the same Quick Detail sheet as the person's own links. Typed, reloaded or
 * externally opened addresses are not intercepted and render the standalone page (collections/[collectionId]/items/[itemId]).
 *
 * The address stays the Collection's: another member's link is only ever read IN its Collection (its lock / share password first),
 * never as /items/{id}, which is the person's own Items only.
 */
export default async function InterceptedSharedItem({ params }: { params: Promise<{ collectionId: string; itemId: string }> }) {
  const { collectionId, itemId } = await params;
  if (parseRouteId(collectionId) === null || parseRouteId(itemId) === null) {
    return <NotAnItem />;
  }
  return (
    <QuickSheetFrame key={`${collectionId}/${itemId}`}>
      <SharedItemQuickContent collectionIdParam={collectionId} itemIdParam={itemId} />
    </QuickSheetFrame>
  );
}
