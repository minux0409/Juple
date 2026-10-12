import { SharedItemView } from './SharedItemView';

export default async function SharedCollectionItemPage({ params }: { params: Promise<{ collectionId: string; itemId: string }> }) {
  const { collectionId, itemId } = await params;
  return <SharedItemView collectionIdParam={collectionId} itemIdParam={itemId} key={`${collectionId}/${itemId}`} />;
}
