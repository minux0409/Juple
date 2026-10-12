import { parseLockedContext } from '../../../../../lib/itemOpenGrant';
import { ItemEditView } from './ItemEditView';

type Search = { lockedBy?: string | string[]; collectionId?: string | string[] };

export default async function ItemEditPage({ params, searchParams }: { params: Promise<{ itemId: string }>; searchParams: Promise<Search> }) {
  const { itemId } = await params;
  const search = await searchParams;
  const lockedBy = parseLockedContext(typeof search.lockedBy === 'string' ? search.lockedBy : null);
  const fromCollectionId = lockedBy === null ? parseLockedContext(typeof search.collectionId === 'string' ? search.collectionId : null) : null;
  return <ItemEditView fromCollectionId={fromCollectionId} itemIdParam={itemId} key={`${itemId}-${lockedBy ?? ''}-${fromCollectionId ?? ''}`} lockedBy={lockedBy} />;
}
