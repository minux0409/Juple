import { CloneCollectionView } from './CloneCollectionView';

export default async function CloneCollectionPage({ params }: { params: Promise<{ collectionId: string }> }) {
  const { collectionId } = await params;
  return <CloneCollectionView collectionIdParam={collectionId} key={collectionId} />;
}
