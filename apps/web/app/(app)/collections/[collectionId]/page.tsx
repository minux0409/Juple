import { CollectionDetailsView } from './CollectionDetailsView';

export default async function CollectionDetailsPage({ params }: { params: Promise<{ collectionId: string }> }) {
  const { collectionId } = await params;
  return <CollectionDetailsView collectionIdParam={collectionId} key={collectionId} />;
}
